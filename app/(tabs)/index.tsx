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
import { apiRequest, getApiUrl } from "@/lib/query-client";
import {
  addMispronouncedWords,
  addSession,
} from "@/lib/accent-storage";
import { useAuth } from "@/contexts/AuthContext";
import AuthModal from "@/components/AuthModal";
import { syncLocalDataToCloud, saveSessionToCloud, saveWordsToCloud, getCloudSessions } from "@/lib/cloud-sync";

interface WordResult {
  word: string;
  score: number;
  tip: string;
  problemPart?: string;
  phonetic?: string;
  userAudio?: string;
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
  const { user, token } = useAuth();
  const [state, setState] = useState<ScreenState>("idle");
  const selectedMinutes = 1;
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [permission, setPermission] = useState<boolean | null>(null);
  const [article, setArticle] = useState<{ title: string; body: string } | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleExpanded, setArticleExpanded] = useState(false);
  const articleRef = useRef<{ title: string; body: string } | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [lastSessionScore, setLastSessionScore] = useState<number | null>(null);
  const pendingResultRef = useRef<AnalysisResult | null>(null);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isTtsLoading, setIsTtsLoading] = useState(false);
  const speakerSoundRef = useRef<Audio.Sound | null>(null);
  const ttsCache = useRef<{ text: string; audio: string } | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const stoppingRef = useRef(false);

  const pulseScale = useSharedValue(1);
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);

  const webTopInset = Platform.OS === "web" ? 67 : 0;

  useEffect(() => {
    articleRef.current = article;
  }, [article]);

  useEffect(() => {
    checkPermission();
    fetchArticle();
    return () => {
      if (speakerSoundRef.current) {
        speakerSoundRef.current.stopAsync().catch(() => {});
        speakerSoundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (user && token) {
      getCloudSessions(token).then((sessions) => {
        if (sessions.length > 0) {
          const sorted = [...sessions].sort((a: any, b: any) => b.date - a.date);
          setLastSessionScore(sorted[0].overallScore);
        }
      });
      syncLocalDataToCloud(token).catch(() => {});
    } else {
      setLastSessionScore(null);
    }
  }, [user, token]);

  const checkPermission = async () => {
    const { status } = await Audio.getPermissionsAsync();
    setPermission(status === "granted");
  };

  const requestPermission = async () => {
    const { status } = await Audio.requestPermissionsAsync();
    setPermission(status === "granted");
  };

  const fetchArticle = async () => {
    try {
      setArticleLoading(true);
      setArticleExpanded(false);
      const baseUrl = getApiUrl();
      const url = new URL("/api/reading-article", baseUrl);
      const resp = await globalThis.fetch(url.toString());
      if (resp.ok) {
        const data = await resp.json();
        setArticle({ title: data.title, body: data.body });
      }
    } catch (err) {
      console.error("Failed to fetch article:", err);
    } finally {
      setArticleLoading(false);
    }
  };

  const prefetchTts = useCallback(async (articleData: { title: string; body: string }) => {
    const text = `${articleData.title}. ${articleData.body}`;
    if (ttsCache.current?.text === text) return;
    try {
      const response = await apiRequest("POST", "/api/tts", { word: text }, { timeoutMs: 120000 });
      const data = await response.json();
      if (data.audio) {
        ttsCache.current = { text, audio: data.audio };
      }
    } catch (err) {
      console.error("TTS prefetch error:", err);
    }
  }, []);

  useEffect(() => {
    if (article) {
      prefetchTts(article);
    }
  }, [article, prefetchTts]);

  const stopSpeaking = useCallback(async () => {
    if (speakerSoundRef.current) {
      try {
        await speakerSoundRef.current.stopAsync();
        await speakerSoundRef.current.unloadAsync();
      } catch {}
      speakerSoundRef.current = null;
    }
    setIsSpeaking(false);
    setIsTtsLoading(false);
  }, []);

  const speakArticle = useCallback(async () => {
    if (isSpeaking || isTtsLoading) {
      await stopSpeaking();
      return;
    }
    if (!article) return;

    try {
      setIsTtsLoading(true);

      const text = `${article.title}. ${article.body}`;
      let audioBase64: string | null = null;

      if (ttsCache.current?.text === text) {
        audioBase64 = ttsCache.current.audio;
      } else {
        const response = await apiRequest("POST", "/api/tts", { word: text }, { timeoutMs: 120000 });
        const data = await response.json();
        audioBase64 = data.audio || null;
        if (audioBase64) {
          ttsCache.current = { text, audio: audioBase64 };
        }
      }

      if (!audioBase64) {
        setIsTtsLoading(false);
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      let uri: string;
      if (Platform.OS === "web") {
        uri = `data:audio/wav;base64,${audioBase64}`;
      } else {
        const filePath = `${FileSystem.cacheDirectory}article_tts.wav`;
        await FileSystem.writeAsStringAsync(filePath, audioBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        uri = filePath;
      }

      const { sound } = await Audio.Sound.createAsync({ uri });
      speakerSoundRef.current = sound;
      setIsSpeaking(true);
      setIsTtsLoading(false);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setIsSpeaking(false);
          sound.unloadAsync();
          speakerSoundRef.current = null;
        }
      });
      await sound.playAsync();
    } catch (err) {
      console.error("TTS error:", err);
      setIsSpeaking(false);
      setIsTtsLoading(false);
    }
  }, [article, isSpeaking, isTtsLoading, stopSpeaking]);

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

      stoppingRef.current = false;
      elapsedRef.current = 0;

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

      setState("analyzing");

      if (!user) {
        setShowAuthModal(true);
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      if (!uri) {
        setState("idle");
        setShowAuthModal(false);
        return;
      }

      const base64 = await getAudioBase64(uri);
      const currentArticle = articleRef.current;
      const articleText = currentArticle ? `${currentArticle.title}\n${currentArticle.body}` : "";

      const response = await apiRequest("POST", "/api/analyze-speech", {
        audio: base64,
        referenceText: articleText,
      }, { timeoutMs: 120000 });
      const data = await response.json();

      const analysisResult: AnalysisResult = {
        overallScore: data.overallScore || 0,
        transcript: data.transcript || "",
        words: data.words || [],
      };

      pendingResultRef.current = analysisResult;
      setShowAuthModal(false);
      setResult(analysisResult);
      setState("results");

      if (analysisResult.words.length > 0) {
        const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        const sessionDate = Date.now();
        await addMispronouncedWords(analysisResult.words);
        await addSession({
          id: sessionId,
          date: sessionDate,
          overallScore: analysisResult.overallScore,
          wordCount: analysisResult.words.length,
        });

        const currentToken = token;
        if (currentToken) {
          saveWordsToCloud(currentToken, analysisResult.words.map(w => ({
            word: w.word,
            scores: [w.score],
            lastSeen: sessionDate,
            tips: w.tip ? [w.tip] : [],
            problemPart: w.problemPart,
            phonetic: w.phonetic,
          }))).catch(() => {});
          saveSessionToCloud(currentToken, {
            id: sessionId,
            date: sessionDate,
            overallScore: analysisResult.overallScore,
            wordCount: analysisResult.words.length,
          }).then(() => {
            setLastSessionScore(analysisResult.overallScore);
          }).catch(() => {});
        }
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

  const handleAuthSuccess = useCallback(() => {
    setShowAuthModal(false);
    if (token) {
      syncLocalDataToCloud(token).catch(() => {});
    }
  }, [token]);

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
    const excellentWords = sortedWords.filter((w) => w.score >= 95).sort((a, b) => b.score - a.score);

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

          {excellentWords.length > 0 && (
            <View style={styles.wordsSection}>
              <View style={styles.sectionHeader}>
                <Ionicons name="checkmark-circle" size={18} color={Colors.dark.success} />
                <Text style={[styles.sectionLabel, { color: Colors.dark.success }]}>
                  Excellent ({excellentWords.length})
                </Text>
              </View>
              <View style={styles.excellentWordsList}>
                {excellentWords.map((w, i) => (
                  <View key={`${w.word}-${i}`} style={styles.excellentWordPill}>
                    <Text style={styles.excellentWordText}>{w.word}</Text>
                    <Text style={styles.excellentWordScore}>{w.score}%</Text>
                  </View>
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
      <AuthModal
        visible={showAuthModal}
        onDismiss={() => setShowAuthModal(false)}
        onSuccess={handleAuthSuccess}
        scorePreview={state === "analyzing" ? undefined : result?.overallScore}
      />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Talk Mode</Text>
        {user ? (
          <View style={styles.userBadge}>
            <Ionicons name="person-circle-outline" size={20} color={Colors.dark.accent} />
          </View>
        ) : (
          <Pressable onPress={() => setShowAuthModal(true)} hitSlop={12}>
            <Text style={styles.signInLink}>Sign In</Text>
          </Pressable>
        )}
      </View>

      {state === "analyzing" ? (
        <View style={styles.centerContent}>
          <View style={styles.analyzingContainer}>
            <ActivityIndicator size="large" color={Colors.dark.accent} />
            <Text style={styles.analyzingText}>Analyzing accent</Text>
            <Text style={styles.analyzingSubtext}>
              Score is loading
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.mainContent}>
          <View style={styles.controlsSection}>
            <Text style={styles.timerText}>
              {state === "recording" ? formatTime(remaining) : formatTime(selectedMinutes * 60)}
            </Text>

            {state === "idle" && (
              <Text style={styles.timerLabel}>Tap to start speaking</Text>
            )}

            {state === "recording" && (
              <View style={styles.recordingTimerBar}>
                <View style={styles.recordingTimerBarFill}>
                  <View
                    style={[
                      styles.recordingTimerBarProgress,
                      { width: `${Math.min((elapsed / maxDuration) * 100, 100)}%` as any },
                    ]}
                  />
                </View>
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
                  disabled={isSpeaking}
                >
                  <Ionicons
                    name={state === "recording" ? "stop" : "mic"}
                    size={36}
                    color="#fff"
                  />
                </Pressable>
              </Animated.View>
            </View>

            {state === "recording" && (
              <Text style={styles.hintTextRecording}>
                Read the article below aloud, or speak freely
              </Text>
            )}
          </View>

          <ScrollView
            style={styles.articleScrollArea}
            contentContainerStyle={[
              styles.articleScrollContent,
              { paddingBottom: Math.max(insets.bottom, 16) + (Platform.OS === "web" ? 34 : 0) + 16 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {state === "idle" && user && lastSessionScore !== null && (
              <View style={styles.returningBanner}>
                <View style={styles.returningBannerLeft}>
                  <Ionicons name="trending-up" size={20} color={Colors.dark.success} />
                  <View>
                    <Text style={styles.returningBannerTitle}>Welcome back!</Text>
                    <Text style={styles.returningBannerSub}>Last score: {lastSessionScore}% — beat it today!</Text>
                  </View>
                </View>
                <View style={[styles.returningScoreBadge, { backgroundColor: lastSessionScore >= 85 ? Colors.dark.successDim : lastSessionScore >= 50 ? Colors.dark.warningDim : Colors.dark.errorDim }]}>
                  <Text style={[styles.returningScoreText, { color: lastSessionScore >= 85 ? Colors.dark.success : lastSessionScore >= 50 ? Colors.dark.warning : Colors.dark.error }]}>{lastSessionScore}%</Text>
                </View>
              </View>
            )}

            {state === "idle" && (
              <View style={styles.articleSection}>
                <View style={styles.articleHeader}>
                  <View style={styles.articleHeaderLeft}>
                    <Ionicons name="book-outline" size={16} color={Colors.dark.accent} />
                    <Text style={styles.articleHeaderLabel}>Reading Practice</Text>
                  </View>
                  <View style={styles.articleHeaderRight}>
                    <Pressable
                      onPress={speakArticle}
                      hitSlop={12}
                      disabled={!article}
                      style={({ pressed }) => [
                        styles.speakerButton,
                        (isSpeaking || isTtsLoading) && styles.speakerButtonActive,
                        !article && { opacity: 0.3 },
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      {isTtsLoading && !isSpeaking ? (
                        <ActivityIndicator size="small" color={Colors.dark.accent} />
                      ) : (
                        <Ionicons
                          name={(isSpeaking || isTtsLoading) ? "stop" : "volume-high"}
                          size={18}
                          color={(isSpeaking || isTtsLoading) ? "#fff" : Colors.dark.accent}
                        />
                      )}
                    </Pressable>
                    <Pressable
                      onPress={fetchArticle}
                      hitSlop={12}
                      style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                    >
                      {articleLoading ? (
                        <ActivityIndicator size="small" color={Colors.dark.textMuted} />
                      ) : (
                        <Ionicons name="refresh" size={18} color={Colors.dark.textMuted} />
                      )}
                    </Pressable>
                  </View>
                </View>

                {article ? (
                  <Pressable
                    onPress={() => setArticleExpanded(!articleExpanded)}
                    style={styles.articleCard}
                  >
                    <Text style={styles.articleTitle}>{article.title}</Text>
                    <Text
                      style={styles.articleBody}
                      numberOfLines={articleExpanded ? undefined : 6}
                    >
                      {article.body}
                    </Text>
                    <Text style={styles.articleExpandHint}>
                      {articleExpanded ? "Tap to collapse" : "Tap to read full article"}
                    </Text>
                  </Pressable>
                ) : articleLoading ? (
                  <View style={styles.articleCard}>
                    <ActivityIndicator size="small" color={Colors.dark.accent} />
                    <Text style={styles.articleLoadingText}>Loading article...</Text>
                  </View>
                ) : null}
              </View>
            )}

            {state === "recording" && article && (
              <View style={styles.articleSection}>
                <View style={styles.articleCard}>
                  <Text style={styles.articleTitle}>{article.title}</Text>
                  <Text style={styles.articleBody}>{article.body}</Text>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
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
  userBadge: {
    width: 28,
    height: 28,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  signInLink: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.dark.accent,
  },
  returningBanner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  returningBannerLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    flex: 1,
  },
  returningBannerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.dark.text,
  },
  returningBannerSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.dark.textMuted,
    marginTop: 2,
  },
  returningScoreBadge: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  returningScoreText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  centerContent: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 24,
  },
  mainContent: {
    flex: 1,
  },
  controlsSection: {
    alignItems: "center" as const,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
  },
  articleScrollArea: {
    flex: 1,
    maxHeight: "75%" as any,
  },
  articleScrollContent: {
    paddingHorizontal: 24,
  },
  timerText: {
    fontFamily: "Inter_700Bold",
    fontSize: 48,
    color: Colors.dark.text,
    letterSpacing: 2,
  },
  timerLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    color: Colors.dark.textSecondary,
    marginTop: 4,
    marginBottom: 12,
  },
  recordingTimerBar: {
    width: "80%" as any,
    marginTop: 6,
    marginBottom: 8,
  },
  recordingTimerBarFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.dark.surface,
    overflow: "hidden" as const,
  },
  recordingTimerBarProgress: {
    height: "100%" as any,
    borderRadius: 2,
    backgroundColor: Colors.dark.error,
  },
  hintTextRecording: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.dark.textMuted,
    marginTop: 6,
    textAlign: "center" as const,
  },
  articleHeaderRight: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  speakerButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.dark.accent,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    backgroundColor: "transparent",
  },
  speakerButtonActive: {
    backgroundColor: Colors.dark.accent,
    borderColor: Colors.dark.accent,
  },
  micButtonContainer: {
    width: 110,
    height: 110,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  pulseRing: {
    position: "absolute" as const,
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: Colors.dark.accent,
  },
  micButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.dark.accent,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  micButtonRecording: {
    backgroundColor: Colors.dark.error,
  },
  hintText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.dark.textMuted,
    marginTop: 12,
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
  excellentWordsList: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  excellentWordPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    backgroundColor: Colors.dark.successDim,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  excellentWordText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.dark.success,
    textTransform: "capitalize" as const,
  },
  excellentWordScore: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.dark.success,
    opacity: 0.7,
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
  articleSection: {
    marginTop: 28,
  },
  articleHeader: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginBottom: 12,
  },
  articleHeaderLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  articleHeaderLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.dark.accent,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  articleCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  articleTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    color: Colors.dark.text,
    lineHeight: 24,
  },
  articleBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.dark.textSecondary,
    lineHeight: 24,
  },
  articleExpandHint: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.dark.accent,
    textAlign: "center" as const,
    marginTop: 4,
  },
  articleLoadingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.textMuted,
    textAlign: "center" as const,
  },
});
