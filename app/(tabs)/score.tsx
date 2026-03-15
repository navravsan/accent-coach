import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Platform,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path, Circle, G, Text as SvgText, Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { useFocusEffect } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { getSessions, type SessionRecord } from "@/lib/accent-storage";
import { useAuth } from "@/contexts/AuthContext";
import { getCloudSessions } from "@/lib/cloud-sync";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface ChartPoint {
  score: number;
  xLabel: string;
  isCurrent: boolean;
}

function buildChartData(sessions: SessionRecord[]): ChartPoint[] {
  if (sessions.length < 2) return [];
  const sorted = [...sessions].sort((a, b) => a.date - b.date);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const dayMap = new Map<number, SessionRecord[]>();
  for (const s of sorted) {
    const d = new Date(s.date);
    d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key)!.push(s);
  }

  const points: ChartPoint[] = [];
  const sortedDays = Array.from(dayMap.keys()).sort((a, b) => a - b);

  for (const dayKey of sortedDays) {
    const daySessions = dayMap.get(dayKey)!;
    const isToday = dayKey === todayMs;

    if (isToday) {
      daySessions.forEach((s, idx) => {
        points.push({ score: s.overallScore, xLabel: `${idx + 1}`, isCurrent: false });
      });
    } else {
      const avg = Math.round(
        daySessions.reduce((sum, s) => sum + s.overallScore, 0) / daySessions.length
      );
      const d = new Date(daySessions[0].date);
      points.push({
        score: avg,
        xLabel: `${MONTHS[d.getMonth()]} ${d.getDate()}`,
        isCurrent: false,
      });
    }
  }

  if (points.length > 0) points[points.length - 1].isCurrent = true;
  if (points.length > 10) return points.slice(points.length - 10);
  return points;
}

function getScoreColor(score: number): string {
  if (score >= 85) return Colors.dark.success;
  if (score >= 50) return Colors.dark.warning;
  return Colors.dark.error;
}

function ScoreChart({ sessions }: { sessions: SessionRecord[] }) {
  const data = buildChartData(sessions);
  if (data.length < 2) return null;

  const screenW = Dimensions.get("window").width;
  const chartW = screenW - 64;
  const svgH = 160;
  const labelH = 28;
  const padTop = 32;
  const padBottom = 12;
  const padLeft = 8;
  const padRight = 8;

  const innerW = chartW - padLeft - padRight;
  const innerH = svgH - padTop - padBottom;

  const minScore = Math.max(0, Math.min(...data.map(p => p.score)) - 15);
  const maxScore = Math.min(100, Math.max(...data.map(p => p.score)) + 10);

  const getX = (i: number) => padLeft + (i / (data.length - 1)) * innerW;
  const getY = (s: number) => padTop + innerH - ((s - minScore) / (maxScore - minScore)) * innerH;

  const pathD = data.reduce((acc, p, i) => {
    const x = getX(i);
    const y = getY(p.score);
    return acc + (i === 0 ? `M${x},${y}` : ` L${x},${y}`);
  }, "");

  const fillD = pathD + ` L${getX(data.length - 1)},${svgH} L${getX(0)},${svgH} Z`;

  return (
    <Svg width={chartW} height={svgH + labelH}>
      <Defs>
        <LinearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={Colors.dark.accent} stopOpacity={0.25} />
          <Stop offset="1" stopColor={Colors.dark.accent} stopOpacity={0} />
        </LinearGradient>
      </Defs>

      <Path d={fillD} fill="url(#grad)" />
      <Path
        d={pathD}
        stroke={Colors.dark.accent}
        strokeWidth={2.5}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {data.map((p, i) => {
        const x = getX(i);
        const y = getY(p.score);
        const r = p.isCurrent ? 7 : 4;
        const col = p.isCurrent ? Colors.dark.accent : Colors.dark.textSecondary;
        return (
          <G key={i}>
            {p.isCurrent && (
              <Circle cx={x} cy={y} r={14} fill={Colors.dark.accent} opacity={0.18} />
            )}
            <Circle cx={x} cy={y} r={r} fill={col} />
            {p.isCurrent && (
              <SvgText x={x} y={y - 18} fontSize={13} fontWeight="bold" textAnchor="middle" fill={Colors.dark.accent}>
                {p.score}%
              </SvgText>
            )}
            {p.xLabel ? (
              <SvgText x={x} y={svgH + 16} fontSize={10} textAnchor="middle" fill={Colors.dark.textMuted}>
                {p.xLabel}
              </SvgText>
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: string; color?: string }) {
  return (
    <View style={stat.card}>
      <MaterialCommunityIcons name={icon as any} size={22} color={color || Colors.dark.accent} />
      <Text style={stat.value}>{value}</Text>
      <Text style={stat.label}>{label}</Text>
    </View>
  );
}

function SessionRow({ session, index }: { session: SessionRecord; index: number }) {
  const d = new Date(session.date);
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const color = getScoreColor(session.overallScore);

  return (
    <View style={hist.row}>
      <View style={hist.indexDot}>
        <Text style={hist.indexText}>{index + 1}</Text>
      </View>
      <View style={hist.rowInfo}>
        <Text style={hist.rowDate}>{label} · {time}</Text>
        {session.wordCount !== undefined && (
          <Text style={hist.rowMeta}>{session.wordCount} words analyzed</Text>
        )}
      </View>
      <View style={[hist.scorePill, { backgroundColor: color + "22" }]}>
        <Text style={[hist.scoreText, { color }]}>{session.overallScore}%</Text>
      </View>
    </View>
  );
}

export default function ScoreScreen() {
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const webTopInset = Platform.OS === "web" ? 67 : 0;

  useFocusEffect(
    useCallback(() => {
      loadSessions();
    }, [user, token])
  );

  const loadSessions = async () => {
    setLoading(true);
    try {
      let all: SessionRecord[] = await getSessions();
      if (user && token) {
        try {
          const cloud = await getCloudSessions(token);
          if (cloud && cloud.length > 0) {
            const localIds = new Set(all.map(s => s.date));
            const merged = [...all, ...cloud.filter((c: SessionRecord) => !localIds.has(c.date))];
            merged.sort((a, b) => b.date - a.date);
            all = merged;
          }
        } catch {}
      }
      all.sort((a, b) => b.date - a.date);
      setSessions(all);
    } catch {}
    setLoading(false);
  };

  const sorted = [...sessions].sort((a, b) => a.date - b.date);
  const recent = sessions.slice(0, 20);
  const totalSessions = sessions.length;
  const avgScore = totalSessions > 0
    ? Math.round(sessions.reduce((s, r) => s + r.overallScore, 0) / totalSessions)
    : 0;
  const bestScore = totalSessions > 0 ? Math.max(...sessions.map(s => s.overallScore)) : 0;

  const trend = sorted.length >= 2
    ? sorted[sorted.length - 1].overallScore - sorted[0].overallScore
    : 0;

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
        <ActivityIndicator size="large" color={Colors.dark.accent} style={{ marginTop: 100 }} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 16) + 80 + (Platform.OS === "web" ? 34 : 0) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.header}>Score</Text>

        {totalSessions === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons name="chart-line" size={56} color={Colors.dark.textMuted} />
            <Text style={styles.emptyTitle}>No sessions yet</Text>
            <Text style={styles.emptyText}>
              Use Talk Mode to record yourself speaking. Your progress will appear here after your first session.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.statsRow}>
              <StatCard icon="calendar-check" label="Sessions" value={`${totalSessions}`} />
              <StatCard icon="chart-arc" label="Average" value={`${avgScore}%`} color={getScoreColor(avgScore)} />
              <StatCard icon="trophy" label="Best" value={`${bestScore}%`} color={Colors.dark.success} />
              <StatCard
                icon={trend >= 0 ? "trending-up" : "trending-down"}
                label="Trend"
                value={`${trend >= 0 ? "+" : ""}${trend}%`}
                color={trend >= 0 ? Colors.dark.success : Colors.dark.error}
              />
            </View>

            {buildChartData(sessions).length >= 2 ? (
              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>Progress over time</Text>
                <ScoreChart sessions={sessions} />
              </View>
            ) : (
              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>Progress over time</Text>
                <Text style={styles.chartHint}>Complete 2 or more sessions to see your progress chart.</Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>Recent Sessions</Text>
            {recent.map((s, i) => (
              <SessionRow key={s.date} session={s} index={i} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  header: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    color: Colors.dark.text,
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: "row" as const,
    gap: 10,
    marginBottom: 16,
  },
  chartCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  chartTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginBottom: 12,
  },
  chartHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.textMuted,
    textAlign: "center" as const,
    paddingVertical: 24,
  },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: Colors.dark.textSecondary,
    marginBottom: 12,
  },
  emptyContainer: {
    alignItems: "center" as const,
    paddingTop: 80,
    gap: 12,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    color: Colors.dark.textSecondary,
    textAlign: "center" as const,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.textMuted,
    textAlign: "center" as const,
    lineHeight: 20,
  },
});

const stat = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.dark.surface,
    borderRadius: 14,
    padding: 12,
    alignItems: "center" as const,
    gap: 4,
  },
  value: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: Colors.dark.text,
  },
  label: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.dark.textMuted,
  },
});

const hist = StyleSheet.create({
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  indexDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.dark.surfaceLight,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  indexText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: Colors.dark.textMuted,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowDate: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.dark.text,
  },
  rowMeta: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.dark.textMuted,
  },
  scorePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  scoreText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
  },
});
