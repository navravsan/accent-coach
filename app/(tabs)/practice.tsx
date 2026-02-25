import React, { useState, useEffect, useRef, useCallback } from "react";
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
  FadeIn,
} from "react-native-reanimated";
import Colors from "@/constants/colors";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { fetch } from "expo/fetch";
import {
  getMispronouncedWords,
  getTopPracticeWords,
  getAverageScore,
  updateWordScore,
  clearAllWords,
  clearLastSessionWords,
  type MispronouncedWord,
} from "@/lib/accent-storage";
import { useFocusEffect } from "expo-router";

function getScoreColor(score: number): string {
  if (score >= 85) return Colors.dark.success;
  if (score >= 50) return Colors.dark.warning;
  return Colors.dark.error;
}

function getScoreBgColor(score: number): string {
  if (score >= 85) return Colors.dark.successDim;
  if (score >= 50) return Colors.dark.warningDim;
  return Colors.dark.errorDim;
}

interface PracticeWord extends MispronouncedWord {
  avgScore: number;
}

interface PracticeFeedback {
  score: number;
  feedback: string;
  recordingUri?: string;
}

function HighlightedWord({ word, problemPart, style }: { word: string; problemPart?: string; style: any }) {
  if (!problemPart || problemPart.length === 0) {
    return <Text style={style}>{word}</Text>;
  }
  const lower = word.toLowerCase();
  const partLower = problemPart.toLowerCase();
  const idx = lower.indexOf(partLower);
  if (idx === -1) {
    return <Text style={style}>{word}</Text>;
  }
  const before = word.slice(0, idx);
  const match = word.slice(idx, idx + problemPart.length);
  const after = word.slice(idx + problemPart.length);
  return (
    <Text style={style}>
      {before}
      <Text style={{ color: Colors.dark.error, textDecorationLine: "underline" }}>{match}</Text>
      {after}
    </Text>
  );
}

function PracticeWordCard({
  item,
  onPlayCorrect,
  onPlayOriginal,
  onPlayRecording,
  onRecord,
  isPlayingCorrect,
  isPlayingOriginal,
  isPlayingRecording,
  isRecording,
  latestFeedback,
}: {
  item: PracticeWord;
  onPlayCorrect: () => void;
  onPlayOriginal: () => void;
  onPlayRecording: () => void;
  onRecord: () => void;
  isPlayingCorrect: boolean;
  isPlayingOriginal: boolean;
  isPlayingRecording: boolean;
  isRecording: boolean;
  latestFeedback: PracticeFeedback | null;
}) {
  const pulseScale = useSharedValue(1);

  useEffect(() => {
    if (isRecording) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    } else {
      cancelAnimation(pulseScale);
      pulseScale.value = withTiming(1, { duration: 150 });
    }
  }, [isRecording]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const avgScore = item.avgScore;
  const timesWrong = item.scores.length;
  const tip = item.tips.length > 0 ? item.tips[item.tips.length - 1] : null;

  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.topRow}>
        <View style={cardStyles.wordInfo}>
          <HighlightedWord
            word={item.word}
            problemPart={item.problemPart}
            style={cardStyles.wordText}
          />
          {item.phonetic ? (
            <Text style={cardStyles.phoneticText}>{item.phonetic}</Text>
          ) : null}
          <View style={cardStyles.metaRow}>
            <View style={[cardStyles.scorePill, { backgroundColor: getScoreBgColor(avgScore) }]}>
              <Text style={[cardStyles.scoreValue, { color: getScoreColor(avgScore) }]}>
                {avgScore}%
              </Text>
            </View>
            <Text style={cardStyles.freqText}>
              {timesWrong}x
            </Text>
          </View>
        </View>

        <View style={cardStyles.actions}>
          <Pressable
            style={({ pressed }) => [cardStyles.actionBtn, pressed && { opacity: 0.7 }]}
            onPress={onPlayCorrect}
            disabled={isPlayingCorrect}
          >
            {isPlayingCorrect ? (
              <ActivityIndicator size="small" color={Colors.dark.accent} />
            ) : (
              <Ionicons name="volume-high" size={22} color={Colors.dark.accent} />
            )}
          </Pressable>

          {item.userAudio ? (
            <Pressable
              style={({ pressed }) => [cardStyles.actionBtn, pressed && { opacity: 0.7 }]}
              onPress={onPlayOriginal}
              disabled={isPlayingOriginal}
            >
              {isPlayingOriginal ? (
                <ActivityIndicator size="small" color={Colors.dark.warning} />
              ) : (
                <Ionicons name="ear-outline" size={22} color={Colors.dark.warning} />
              )}
            </Pressable>
          ) : null}

          <Animated.View style={pulseStyle}>
            <Pressable
              style={({ pressed }) => [
                cardStyles.actionBtn,
                isRecording && cardStyles.recordingBtn,
                pressed && { opacity: 0.7 },
              ]}
              onPress={onRecord}
            >
              <Ionicons
                name={isRecording ? "stop" : "mic"}
                size={22}
                color={isRecording ? "#fff" : Colors.dark.accentLight}
              />
            </Pressable>
          </Animated.View>
        </View>
      </View>

      {tip && (
        <View style={cardStyles.tipRow}>
          <MaterialCommunityIcons name="lightbulb-outline" size={14} color={Colors.dark.warning} />
          <Text style={cardStyles.tipText}>{tip}</Text>
        </View>
      )}

      {latestFeedback && (
        <View style={cardStyles.feedbackContainer}>
          <View style={cardStyles.feedbackScoreRow}>
            <View style={[cardStyles.feedbackScorePill, { backgroundColor: getScoreBgColor(latestFeedback.score) }]}>
              <Text style={[cardStyles.feedbackScoreText, { color: getScoreColor(latestFeedback.score) }]}>
                Practice: {latestFeedback.score}%
              </Text>
            </View>
            {latestFeedback.recordingUri && (
              <Pressable
                style={({ pressed }) => [cardStyles.playMyRecBtn, pressed && { opacity: 0.7 }]}
                onPress={onPlayRecording}
                disabled={isPlayingRecording}
              >
                {isPlayingRecording ? (
                  <ActivityIndicator size="small" color={Colors.dark.textSecondary} />
                ) : (
                  <>
                    <Ionicons name="ear-outline" size={14} color={Colors.dark.textSecondary} />
                    <Text style={cardStyles.playMyRecText}>My recording</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
          {latestFeedback.feedback ? (
            <Text style={cardStyles.feedbackMessage}>{latestFeedback.feedback}</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

export default function PracticeScreen() {
  const insets = useSafeAreaInsets();
  const [practiceWords, setPracticeWords] = useState<PracticeWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingWord, setPlayingWord] = useState<string | null>(null);
  const [playingOriginal, setPlayingOriginal] = useState<string | null>(null);
  const [playingRecording, setPlayingRecording] = useState<string | null>(null);
  const [recordingWord, setRecordingWord] = useState<string | null>(null);
  const [feedbacks, setFeedbacks] = useState<Record<string, PracticeFeedback>>({});
  const [permission, setPermission] = useState<boolean | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const webTopInset = Platform.OS === "web" ? 67 : 0;

  useFocusEffect(
    useCallback(() => {
      loadWords();
      checkPermission();
    }, [])
  );

  const checkPermission = async () => {
    const { status } = await Audio.getPermissionsAsync();
    setPermission(status === "granted");
  };

  const requestPermission = async () => {
    const { status } = await Audio.requestPermissionsAsync();
    setPermission(status === "granted");
  };

  const loadWords = async () => {
    setLoading(true);
    const allWords = await getMispronouncedWords();
    const top = getTopPracticeWords(allWords, 20);
    const withAvg = top.map((w) => ({
      ...w,
      avgScore: getAverageScore(w),
    }));
    withAvg.sort((a, b) => a.avgScore - b.avgScore);
    setPracticeWords(withAvg);
    setLoading(false);
  };

  const playWord = async (word: string) => {
    try {
      setPlayingWord(word);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      const baseUrl = getApiUrl();
      const url = new URL("/api/tts", baseUrl);
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word }),
      });

      if (!response.ok) throw new Error("TTS failed");
      const data = await response.json();

      let audioUri: string;
      if (Platform.OS === "web") {
        const byteChars = atob(data.audio);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteNumbers[i] = byteChars.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: "audio/wav" });
        audioUri = URL.createObjectURL(blob);
      } else {
        audioUri = FileSystem.documentDirectory + `tts_${Date.now()}.wav`;
        await FileSystem.writeAsStringAsync(audioUri, data.audio, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const { sound } = await Audio.Sound.createAsync({ uri: audioUri });
      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingWord(null);
          sound.unloadAsync();
        }
      });

      await sound.playAsync();
    } catch (err) {
      console.error("TTS error:", err);
      setPlayingWord(null);
      Alert.alert("Error", "Could not play pronunciation.");
    }
  };

  const playOriginalAudio = async (word: PracticeWord) => {
    if (!word.userAudio) return;

    try {
      setPlayingOriginal(word.word);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      let audioUri: string;
      if (Platform.OS === "web") {
        const byteChars = atob(word.userAudio);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteNumbers[i] = byteChars.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: "audio/wav" });
        audioUri = URL.createObjectURL(blob);
      } else {
        audioUri = FileSystem.documentDirectory + `original_${Date.now()}.wav`;
        await FileSystem.writeAsStringAsync(audioUri, word.userAudio, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const { sound } = await Audio.Sound.createAsync({ uri: audioUri });
      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingOriginal(null);
          sound.unloadAsync();
        }
      });

      await sound.playAsync();
    } catch (err) {
      console.error("Error playing original audio:", err);
      setPlayingOriginal(null);
    }
  };

  const startWordRecording = async (word: string) => {
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

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      setRecordingWord(word);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      console.error("Failed to start word recording:", err);
      Alert.alert("Error", "Could not start recording.");
    }
  };

  const playUserRecording = async (word: string) => {
    const fb = feedbacks[word.toLowerCase()];
    if (!fb?.recordingUri) return;

    try {
      setPlayingRecording(word);
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const { sound } = await Audio.Sound.createAsync({ uri: fb.recordingUri });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingRecording(null);
          sound.unloadAsync();
        }
      });
      await sound.playAsync();
    } catch (err) {
      console.error("Error playing recording:", err);
      setPlayingRecording(null);
    }
  };

  const stopWordRecording = async (word: string) => {
    try {
      const recording = recordingRef.current;
      if (!recording) return;

      setRecordingWord(null);

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;

      if (!uri) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      let base64: string;
      if (Platform.OS === "web") {
        const resp = await globalThis.fetch(uri);
        const blob = await resp.blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      const response = await apiRequest("POST", "/api/assess-word", {
        audio: base64,
        targetWord: word,
      });
      const data = await response.json();

      await updateWordScore(word, data.score);

      setFeedbacks((prev) => ({
        ...prev,
        [word.toLowerCase()]: {
          score: data.score,
          feedback: data.feedback || "",
          recordingUri: uri,
        },
      }));

      await loadWords();
      Haptics.notificationAsync(
        data.score >= 80
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning
      );
    } catch (err) {
      console.error("Failed to assess word:", err);
      Alert.alert("Error", "Could not assess pronunciation.");
    }
  };

  const handleRecord = (word: string) => {
    if (recordingWord === word) {
      stopWordRecording(word);
    } else {
      startWordRecording(word);
    }
  };

  const doClearAll = async () => {
    try {
      await clearAllWords();
      setFeedbacks({});
      setPracticeWords([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error("Clear all error:", err);
    }
  };

  const doClearLastSession = async () => {
    try {
      await clearLastSessionWords();
      setFeedbacks({});
      await loadWords();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error("Clear last session error:", err);
    }
  };

  const handleClearAll = () => {
    if (Platform.OS === "web") {
      if (window.confirm("This will remove all practice words. This cannot be undone.")) {
        doClearAll();
      }
    } else {
      Alert.alert(
        "Clear All Words",
        "This will remove all practice words. This cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Clear All", style: "destructive", onPress: doClearAll },
        ]
      );
    }
  };

  const handleClearLastSession = () => {
    if (Platform.OS === "web") {
      if (window.confirm("This will remove all words from your most recent recording session.")) {
        doClearLastSession();
      }
    } else {
      Alert.alert(
        "Clear Last Session",
        "This will remove all words from your most recent recording session.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Clear", style: "destructive", onPress: doClearLastSession },
        ]
      );
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
        <ActivityIndicator size="large" color={Colors.dark.accent} style={{ marginTop: 100 }} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Practice</Text>
        <Pressable onPress={loadWords} hitSlop={12}>
          <Ionicons name="refresh" size={24} color={Colors.dark.textSecondary} />
        </Pressable>
      </View>

      {practiceWords.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons name="microphone-message" size={56} color={Colors.dark.textMuted} />
          <Text style={styles.emptyTitle}>No words to practice yet</Text>
          <Text style={styles.emptyText}>
            Use Talk Mode to record yourself speaking. Words that need improvement will appear here.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 80 + (Platform.OS === "web" ? 34 : 0) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.clearRow}>
            <Pressable
              style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.7 }]}
              onPress={handleClearAll}
            >
              <Ionicons name="trash-outline" size={15} color={Colors.dark.error} />
              <Text style={styles.clearBtnText}>Clear All</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.7 }]}
              onPress={handleClearLastSession}
            >
              <Ionicons name="close-circle-outline" size={15} color={Colors.dark.warning} />
              <Text style={[styles.clearBtnText, { color: Colors.dark.warning }]}>Clear Last Session</Text>
            </Pressable>
          </View>

          <Text style={styles.subtitle}>
            Top {practiceWords.length} words to improve
          </Text>
          <Text style={styles.instructions}>
            Tap the speaker to hear correct pronunciation, the ear to hear how you said it, then the mic to practice
          </Text>

          {practiceWords.map((word, index) => (
            <Animated.View key={word.word} entering={FadeIn.delay(index * 50)}>
              <PracticeWordCard
                item={word}
                onPlayCorrect={() => playWord(word.word)}
                onPlayOriginal={() => playOriginalAudio(word)}
                onPlayRecording={() => playUserRecording(word.word)}
                onRecord={() => handleRecord(word.word)}
                isPlayingCorrect={playingWord === word.word}
                isPlayingOriginal={playingOriginal === word.word}
                isPlayingRecording={playingRecording === word.word}
                isRecording={recordingWord === word.word}
                latestFeedback={feedbacks[word.word.toLowerCase()] || null}
              />
            </Animated.View>
          ))}
        </ScrollView>
      )}
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
  subtitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: Colors.dark.textSecondary,
    marginBottom: 4,
  },
  instructions: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.dark.textMuted,
    marginBottom: 20,
    lineHeight: 18,
  },
  scrollView: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 48,
    gap: 12,
  },
  clearRow: {
    flexDirection: "row" as const,
    justifyContent: "flex-end" as const,
    alignItems: "center" as const,
    gap: 12,
    marginBottom: 16,
  },
  clearBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: Colors.dark.surface,
  },
  clearBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.dark.error,
  },
  emptyTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: Colors.dark.text,
    textAlign: "center" as const,
    marginTop: 8,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.dark.textSecondary,
    textAlign: "center" as const,
    lineHeight: 22,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  topRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  wordInfo: {
    flex: 1,
    gap: 6,
  },
  wordText: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: Colors.dark.text,
    textTransform: "capitalize" as const,
  },
  metaRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
  },
  scorePill: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  scoreValue: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  freqText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.dark.textMuted,
  },
  actions: {
    flexDirection: "row" as const,
    gap: 10,
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.dark.surfaceLight,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  recordingBtn: {
    backgroundColor: Colors.dark.error,
  },
  phoneticText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.textMuted,
    marginTop: 2,
    fontStyle: "italic" as const,
  },
  tipRow: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  tipText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.dark.textSecondary,
    flex: 1,
    lineHeight: 18,
  },
  feedbackContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
    gap: 8,
  },
  feedbackScoreRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  feedbackScorePill: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  feedbackScoreText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  playMyRecBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.dark.surfaceLight,
  },
  playMyRecText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  feedbackMessage: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
});
