import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import Colors from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";
import {
  addMispronouncedWords,
  addSession,
} from "@/lib/accent-storage";

const DURATION_OPTIONS = [1, 2, 3];
const CHUNK_INTERVAL_SECS = 20;

interface WordResult {
  word: string;
  score: number;
  tip: string;
  problemPart?: string;
  count?: number;
}

interface AnalysisResult {
  overallScore: number;
  transcript: string;
  words: WordResult[];
}

type ScreenState = "idle" | "recording" | "analyzing" | "results";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getScoreColor(score: number): string {
  if (score >= 85) return Colors.dark.success;
  if (score >= 50) return Colors.dark.warning;
  return Colors.dark.error;
}

function HighlightedWord({ word, problemPart }: { word: string; problemPart?: string }) {
  if (!problemPart || problemPart.length === 0) {
    return <Text style={styles.wordRowText}>{word}</Text>;
  }
  const lower = word.toLowerCase();
  const partLower = problemPart.toLowerCase();
  const idx = lower.indexOf(partLower);
  if (idx === -1) {
    return <Text style={styles.wordRowText}>{word}</Text>;
  }
  const before = word.slice(0, idx);
  const match = word.slice(idx, idx + problemPart.length);
  const after = word.slice(idx + problemPart.length);
  return (
    <Text style={styles.wordRowText}>
      {before}
      <Text style={styles.wordProblemPart}>{match}</Text>
      {after}
    </Text>
  );
}

function WordScoreRow({ item, showHighlight }: { item: WordResult; showHighlight?: boolean }) {
  const color = getScoreColor(item.score);
  return (
    <View style={styles.wordRow}>
      {showHighlight ? (
        <HighlightedWord word={item.word} problemPart={item.problemPart} />
      ) : (
        <Text style={styles.wordRowText}>{item.word}</Text>
      )}
      <View style={styles.wordRowRight}>
        <Text style={[styles.wordRowScore, { color }]}>{item.score}%</Text>
        {item.count && item.count > 1 && (
          <Text style={styles.wordRowCount}>({item.count})</Text>
        )}
      </View>
    </View>
  );
}

export default function TalkScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ScreenState>("idle");
  const [selectedMinutes, setSelectedMinutes] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [permission, setPermission] = useState<boolean | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzeTotal, setAnalyzeTotal] = useState(1);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkResultsRef = useRef<{ transcript: string; words: WordResult[] }[]>([]);
  const chunkPendingRef = useRef<Promise<void>[]>([]);
  const elapsedRef = useRef(0);
  const stoppingRef = useRef(false);

  const pulseScale = useSharedValue(1);
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);

  const webTopInset = Platform.OS === "web" ? 67 : 0;

  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    const { status } = await Audio.getPermissionsAsync();
    setPermission(status === "granted");
  };

  const requestPermission = async () => {
    const { status } = await Audio.requestPermissionsAsync();
    setPermission(status === "granted");
  };

  const getAudioBase64 = async (uri: string): Promise<string> => {
    if (Platform.OS === "web") {
      const resp = await globalThis.fetch(uri);
      const blob = await resp.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } else {
      return FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
  };

  const sendChunk = async () => {
    if (stoppingRef.current) return;
    const recording = recordingRef.current;
    if (!recording) return;

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;

      if (uri) {
        const chunkPromise = (async () => {
          try {
            const base64 = await getAudioBase64(uri);
            const response = await apiRequest("POST", "/api/analyze-chunk", { audio: base64 });
            const data = await response.json();
            if (data.words && data.words.length > 0) {
              chunkResultsRef.current.push({
                transcript: data.transcript || "",
                words: data.words,
              });
            }
          } catch (err) {
            console.error("Chunk analysis error:", err);
          }
          setAnalyzeProgress((p) => p + 1);
        })();
        chunkPendingRef.current.push(chunkPromise);
      }

      if (!stoppingRef.current) {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
        const { recording: newRec } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        recordingRef.current = newRec;
      }
    } catch (err) {
      console.error("Chunk rotation error:", err);
    }
  };

  const startRecording = async () => {
    try {
      if (!permission) {
        const { status } = await Audio.requestPermissionsAsync();
        setPermission(status === "granted");
        if (status !== "granted") return;
      }

      if (recordingRef.current) {
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch (_) {}
        recordingRef.current = null;
      }

      chunkResultsRef.current = [];
      chunkPendingRef.current = [];
      stoppingRef.current = false;
      elapsedRef.current = 0;
      setAnalyzeProgress(0);
      setAnalyzeTotal(1);

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;

      setState("recording");
      setElapsed(0);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
      ringScale.value = withRepeat(
        withSequence(
          withTiming(1.8, { duration: 1500, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 0 })
        ),
        -1
      );
      ringOpacity.value = withRepeat(
        withSequence(
          withTiming(0.4, { duration: 0 }),
          withTiming(0, { duration: 1500, easing: Easing.out(Easing.ease) })
        ),
        -1
      );

      const maxSecs = selectedMinutes * 60;
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
        if (elapsedRef.current >= maxSecs) {
          stopRecording();
        }
      }, 1000);

      chunkTimerRef.current = setInterval(() => {
        sendChunk();
      }, CHUNK_INTERVAL_SECS * 1000);
    } catch (err) {
      console.error("Failed to start recording:", err);
      Alert.alert("Error", "Could not start recording. Please check microphone permissions.");
    }
  };

  const stopRecording = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    try {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (chunkTimerRef.current) {
        clearInterval(chunkTimerRef.current);
        chunkTimerRef.current = null;
      }

      cancelAnimation(pulseScale);
      cancelAnimation(ringScale);
      cancelAnimation(ringOpacity);
      pulseScale.value = withTiming(1, { duration: 200 });
      ringOpacity.value = withTiming(0, { duration: 200 });

      const recording = recordingRef.current;
      if (!recording) {
        setState("idle");
        return;
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;

      if (uri) {
        const lastChunk = (async () => {
          try {
            const base64 = await getAudioBase64(uri);
            const response = await apiRequest("POST", "/api/analyze-chunk", { audio: base64 });
            const data = await response.json();
            if (data.words && data.words.length > 0) {
              chunkResultsRef.current.push({
                transcript: data.transcript || "",
                words: data.words,
              });
            }
          } catch (err) {
            console.error("Last chunk error:", err);
          }
          setAnalyzeProgress((p) => p + 1);
        })();
        chunkPendingRef.current.push(lastChunk);
      }

      const totalChunks = chunkPendingRef.current.length;
      setAnalyzeTotal(totalChunks);
      setState("analyzing");

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      await Promise.all(chunkPendingRef.current);

      const allTranscripts: string[] = [];
      const allWords: WordResult[] = [];
      for (const chunk of chunkResultsRef.current) {
        if (chunk.transcript) allTranscripts.push(chunk.transcript);
        allWords.push(...chunk.words);
      }

      const fullTranscript = allTranscripts.join(" ");

      let overallScore = 70;
      if (allWords.length > 0) {
        const total = allWords.reduce((sum, w) => sum + (w.score || 0), 0);
        overallScore = Math.round(total / allWords.length);
      }

      const analysisResult: AnalysisResult = {
        overallScore,
        transcript: fullTranscript,
        words: allWords,
      };

      setResult(analysisResult);
      setState("results");

      if (allWords.length > 0) {
        await addMispronouncedWords(allWords);
        await addSession({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          date: Date.now(),
          overallScore,
          wordCount: allWords.length,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error("Failed to stop/analyze recording:", err);
      setState("idle");
      Alert.alert("Error", "Failed to analyze your speech. Please try again.");
    }
  }, []);

  const resetToIdle = () => {
    setState("idle");
    setResult(null);
    setElapsed(0);
    setAnalyzeProgress(0);
    setAnalyzeTotal(1);
    stoppingRef.current = false;
  };

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  const maxDuration = selectedMinutes * 60;
  const remaining = maxDuration - elapsed;

  if (permission === null) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
        <ActivityIndicator color={Colors.dark.accent} size="large" />
      </View>
    );
  }

  if (permission === false) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
        <View style={styles.permissionContainer}>
          <Ionicons name="mic-off" size={48} color={Colors.dark.textMuted} />
          <Text style={styles.permissionTitle}>Microphone Access Required</Text>
          <Text style={styles.permissionText}>
            To analyze your accent, we need access to your microphone.
          </Text>
          <Pressable style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Allow Microphone</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state === "results" && result) {
    const wordMap = new Map<string, WordResult>();
    const countMap = new Map<string, number>();
    for (const w of result.words) {
      const key = w.word.toLowerCase();
      const existing = wordMap.get(key);
      const count = (countMap.get(key) || 0) + 1;
      countMap.set(key, count);
      if (existing) {
        const prevTotal = existing.score * (count - 1);
        existing.score = Math.round((prevTotal + w.score) / count);
        if (w.problemPart && !existing.problemPart) {
          existing.problemPart = w.problemPart;
        }
        if (w.tip && !existing.tip) {
          existing.tip = w.tip;
        }
      } else {
        wordMap.set(key, { ...w });
      }
    }
    const dedupedWords = Array.from(wordMap.values()).map((w) => ({
      ...w,
      count: countMap.get(w.word.toLowerCase()) || 1,
    }));
    const sortedWords = dedupedWords.sort((a, b) => a.score - b.score);
    const redWords = sortedWords.filter((w) => w.score < 50);
    const yellowWords = sortedWords.filter((w) => w.score >= 50 && w.score < 85);
    const greenWords = sortedWords.filter((w) => w.score >= 85);

    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Results</Text>
          <Pressable onPress={resetToIdle} hitSlop={12}>
            <Ionicons name="close" size={28} color={Colors.dark.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.resultsContent,
            { paddingBottom: 100 + Math.max(insets.bottom, 16) + (Platform.OS === "web" ? 34 : 0) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.scoreCircleContainer}>
            <View style={[styles.scoreCircle, { borderColor: getScoreColor(result.overallScore) }]}>
              <Text style={[styles.scoreCircleNumber, { color: getScoreColor(result.overallScore) }]}>
                {result.overallScore}
              </Text>
              <Text style={[styles.scoreCirclePercent, { color: getScoreColor(result.overallScore) }]}>%</Text>
            </View>
            <Text style={styles.scoreLabel}>Overall Accent Score</Text>
          </View>

          <View style={styles.transcriptBox}>
            <Text style={styles.sectionLabel}>What you said</Text>
            <Text style={styles.transcriptText}>{result.transcript}</Text>
          </View>

          {redWords.length > 0 && (
            <View style={styles.wordsSection}>
              <View style={styles.sectionHeader}>
                <Ionicons name="alert-circle" size={18} color={Colors.dark.error} />
                <Text style={[styles.sectionLabel, { color: Colors.dark.error }]}>
                  Needs Work ({redWords.length})
                </Text>
              </View>
              <View style={styles.wordsList}>
                {redWords.map((w, i) => (
                  <WordScoreRow key={`${w.word}-${i}`} item={w} showHighlight />
                ))}
              </View>
            </View>
          )}

          {yellowWords.length > 0 && (
            <View style={styles.wordsSection}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color={Colors.dark.warning} />
                <Text style={[styles.sectionLabel, { color: Colors.dark.warning }]}>
                  Improving ({yellowWords.length})
                </Text>
              </View>
              <View style={styles.wordsList}>
                {yellowWords.map((w, i) => (
                  <WordScoreRow key={`${w.word}-${i}`} item={w} showHighlight />
                ))}
              </View>
            </View>
          )}

          {greenWords.length > 0 && (
            <View style={styles.wordsSection}>
              <View style={styles.sectionHeader}>
                <Ionicons name="checkmark-circle-outline" size={18} color={Colors.dark.success} />
                <Text style={[styles.sectionLabel, { color: Colors.dark.success }]}>
                  Good ({greenWords.length})
                </Text>
              </View>
              <View style={styles.wordsList}>
                {greenWords.map((w, i) => (
                  <WordScoreRow key={`${w.word}-${i}`} item={w} />
                ))}
              </View>
            </View>
          )}
          <View style={styles.tryAgainContainer}>
            <Pressable
              style={({ pressed }) => [styles.tryAgainButton, pressed && { opacity: 0.85 }]}
              onPress={resetToIdle}
            >
              <Ionicons name="refresh" size={20} color="#fff" />
              <Text style={styles.tryAgainText}>Try Again</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Talk Mode</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.centerContent}>
        {state === "analyzing" ? (
          <View style={styles.analyzingContainer}>
            <View style={styles.progressCircleOuter}>
              <Text style={styles.progressPercent}>
                {analyzeTotal > 0 ? Math.round((analyzeProgress / analyzeTotal) * 100) : 0}%
              </Text>
            </View>
            <View style={styles.progressBarContainer}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${analyzeTotal > 0 ? Math.min((analyzeProgress / analyzeTotal) * 100, 100) : 0}%` as any },
                ]}
              />
            </View>
            <Text style={styles.analyzingText}>Analyzing your accent...</Text>
            <Text style={styles.analyzingSubtext}>
              {analyzeProgress < analyzeTotal
                ? `Processing chunk ${analyzeProgress + 1} of ${analyzeTotal}`
                : "Finalizing results..."}
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.timerText}>
              {state === "recording" ? formatTime(remaining) : formatTime(selectedMinutes * 60)}
            </Text>
            <Text style={styles.timerLabel}>
              {state === "recording" ? "Recording..." : "Tap to start speaking"}
            </Text>

            {state === "idle" && (
              <View style={styles.durationPicker}>
                {DURATION_OPTIONS.map((min) => (
                  <Pressable
                    key={min}
                    style={[
                      styles.durationOption,
                      selectedMinutes === min && styles.durationOptionActive,
                    ]}
                    onPress={() => {
                      setSelectedMinutes(min);
                      Haptics.selectionAsync();
                    }}
                  >
                    <Text
                      style={[
                        styles.durationOptionText,
                        selectedMinutes === min && styles.durationOptionTextActive,
                      ]}
                    >
                      {min}m
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <View style={styles.micButtonContainer}>
              <Animated.View style={[styles.pulseRing, ringStyle]} />
              <Animated.View style={pulseStyle}>
                <Pressable
                  style={[
                    styles.micButton,
                    state === "recording" && styles.micButtonRecording,
                  ]}
                  onPress={state === "recording" ? stopRecording : startRecording}
                >
                  <Ionicons
                    name={state === "recording" ? "stop" : "mic"}
                    size={40}
                    color="#fff"
                  />
                </Pressable>
              </Animated.View>
            </View>

            <Text style={styles.hintText}>
              {state === "recording"
                ? "Speak naturally about any topic"
                : "Choose duration, then tap to record"}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  headerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: Colors.dark.text,
  },
  centerContent: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 24,
  },
  timerText: {
    fontFamily: "Inter_700Bold",
    fontSize: 56,
    color: Colors.dark.text,
    letterSpacing: 2,
  },
  timerLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    color: Colors.dark.textSecondary,
    marginTop: 8,
    marginBottom: 24,
  },
  durationPicker: {
    flexDirection: "row" as const,
    gap: 10,
    marginBottom: 32,
  },
  durationOption: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.dark.surface,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    borderWidth: 2,
    borderColor: "transparent",
  },
  durationOptionActive: {
    borderColor: Colors.dark.accent,
    backgroundColor: Colors.dark.accentDim,
  },
  durationOptionText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.dark.textMuted,
  },
  durationOptionTextActive: {
    color: Colors.dark.accent,
  },
  micButtonContainer: {
    width: 140,
    height: 140,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  pulseRing: {
    position: "absolute" as const,
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: Colors.dark.accent,
  },
  micButton: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.dark.accent,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  micButtonRecording: {
    backgroundColor: Colors.dark.error,
  },
  hintText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.textMuted,
    marginTop: 40,
    textAlign: "center" as const,
  },
  analyzingContainer: {
    alignItems: "center" as const,
    gap: 16,
    paddingHorizontal: 32,
  },
  progressCircleOuter: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: Colors.dark.accent,
    backgroundColor: Colors.dark.surface,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    marginBottom: 8,
  },
  progressPercent: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    color: Colors.dark.accent,
  },
  progressBarContainer: {
    width: "100%" as const,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.dark.surface,
    overflow: "hidden" as const,
  },
  progressBarFill: {
    height: "100%" as const,
    borderRadius: 3,
    backgroundColor: Colors.dark.accent,
  },
  analyzingText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 20,
    color: Colors.dark.text,
    marginTop: 4,
  },
  analyzingSubtext: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.textMuted,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 40,
    gap: 12,
  },
  permissionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: Colors.dark.text,
    textAlign: "center" as const,
    marginTop: 8,
  },
  permissionText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.dark.textSecondary,
    textAlign: "center" as const,
    lineHeight: 22,
  },
  permissionButton: {
    marginTop: 16,
    backgroundColor: Colors.dark.accent,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  permissionButtonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: "#fff",
  },
  scrollView: {
    flex: 1,
  },
  resultsContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  scoreCircleContainer: {
    alignItems: "center" as const,
    marginBottom: 28,
  },
  scoreCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    backgroundColor: Colors.dark.surface,
    flexDirection: "row" as const,
  },
  scoreCircleNumber: {
    fontFamily: "Inter_700Bold",
    fontSize: 44,
  },
  scoreCirclePercent: {
    fontFamily: "Inter_500Medium",
    fontSize: 18,
    marginTop: 12,
  },
  scoreLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginTop: 12,
  },
  transcriptBox: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  transcriptText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.dark.text,
    lineHeight: 24,
    marginTop: 8,
  },
  wordsSection: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 12,
  },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  wordsList: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    overflow: "hidden" as const,
  },
  wordRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  wordRowText: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    color: Colors.dark.text,
    textTransform: "capitalize" as const,
  },
  wordRowRight: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  wordRowScore: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  wordRowCount: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.dark.textMuted,
  },
  wordProblemPart: {
    color: Colors.dark.error,
    fontFamily: "Inter_700Bold",
    textDecorationLine: "underline" as const,
  },
  tryAgainContainer: {
    paddingTop: 16,
    paddingBottom: 24,
  },
  tryAgainButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: Colors.dark.accent,
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
  },
  tryAgainText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: "#fff",
  },
});
