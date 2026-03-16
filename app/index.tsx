import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Dimensions,
} from "react-native";
import { router } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const { width, height } = Dimensions.get("window");

function Orb({
  size,
  color,
  delay,
  x,
  y,
}: {
  size: number;
  color: string;
  delay: number;
  x: number;
  y: number;
}) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.8);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.18, { duration: 2800, easing: Easing.inOut(Easing.sine) }),
          withTiming(0.07, { duration: 2800, easing: Easing.inOut(Easing.sine) })
        ),
        -1,
        true
      )
    );
    scale.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1.1, { duration: 3200, easing: Easing.inOut(Easing.sine) }),
          withTiming(0.85, { duration: 3200, easing: Easing.inOut(Easing.sine) })
        ),
        -1,
        true
      )
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          left: x - size / 2,
          top: y - size / 2,
        },
        style,
      ]}
    />
  );
}

export default function IntroScreen() {
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  const titleOpacity = useSharedValue(0);
  const titleY = useSharedValue(24);
  const subtitleOpacity = useSharedValue(0);
  const subtitleY = useSharedValue(16);
  const btnOpacity = useSharedValue(0);
  const btnY = useSharedValue(16);
  const btnScale = useSharedValue(1);

  useEffect(() => {
    titleOpacity.value = withDelay(200, withTiming(1, { duration: 700 }));
    titleY.value = withDelay(200, withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) }));

    subtitleOpacity.value = withDelay(600, withTiming(1, { duration: 600 }));
    subtitleY.value = withDelay(600, withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) }));

    btnOpacity.value = withDelay(1000, withTiming(1, { duration: 600 }));
    btnY.value = withDelay(1000, withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) }));
  }, []);

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleY.value }],
  }));

  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
    transform: [{ translateY: subtitleY.value }],
  }));

  const btnContainerStyle = useAnimatedStyle(() => ({
    opacity: btnOpacity.value,
    transform: [{ translateY: btnY.value }],
  }));

  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: btnScale.value }],
  }));

  const handleEnter = () => {
    btnScale.value = withSequence(
      withTiming(0.95, { duration: 80 }),
      withTiming(1, { duration: 80 })
    );
    setTimeout(() => {
      router.replace("/(tabs)");
    }, 120);
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + webTopInset,
          paddingBottom: insets.bottom + webBottomInset,
        },
      ]}
    >
      {/* Ambient orbs */}
      <Orb size={320} color={Colors.dark.accent} delay={0} x={width * 0.15} y={height * 0.25} />
      <Orb size={260} color="#7c5cbf" delay={800} x={width * 0.85} y={height * 0.38} />
      <Orb size={200} color={Colors.dark.accent} delay={400} x={width * 0.5} y={height * 0.72} />

      <View style={styles.content}>
        {/* Brand mark */}
        <Animated.View style={[styles.brandMark, titleStyle]}>
          <Text style={styles.logoAccent}>Go</Text>
          <Text style={styles.logoMain}>Accent</Text>
          <Text style={styles.logoDot}>.Pro</Text>
        </Animated.View>

        {/* Tagline */}
        <Animated.Text style={[styles.tagline, subtitleStyle]}>
          Train your California accent.{"\n"}Sound like a native.
        </Animated.Text>

        {/* Decorative line */}
        <Animated.View style={[styles.dividerRow, subtitleStyle]}>
          <View style={styles.dividerLine} />
          <View style={styles.dividerDot} />
          <View style={styles.dividerLine} />
        </Animated.View>

        {/* Feature pills */}
        <Animated.View style={[styles.pillsRow, subtitleStyle]}>
          {["AI Scoring", "Word Practice", "Progress Tracking"].map((f) => (
            <View key={f} style={styles.pill}>
              <Text style={styles.pillText}>{f}</Text>
            </View>
          ))}
        </Animated.View>
      </View>

      {/* CTA */}
      <Animated.View style={[styles.ctaContainer, btnContainerStyle]}>
        <Pressable onPress={handleEnter}>
          <Animated.View style={[styles.enterBtn, btnStyle]}>
            <Text style={styles.enterText}>Enter</Text>
            <Text style={styles.enterArrow}>→</Text>
          </Animated.View>
        </Pressable>
        <Text style={styles.ctaHint}>No account needed to start</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  brandMark: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 24,
  },
  logoAccent: {
    fontFamily: "Inter_700Bold",
    fontSize: 52,
    color: Colors.dark.accent,
    letterSpacing: -1,
  },
  logoMain: {
    fontFamily: "Inter_700Bold",
    fontSize: 52,
    color: Colors.dark.text,
    letterSpacing: -1,
  },
  logoDot: {
    fontFamily: "Inter_400Regular",
    fontSize: 28,
    color: Colors.dark.textSecondary,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  tagline: {
    fontFamily: "Inter_400Regular",
    fontSize: 18,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 28,
    marginBottom: 36,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 28,
    width: "60%",
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.dark.border,
  },
  dividerDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.dark.accent,
    opacity: 0.6,
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  pill: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  pillText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.dark.textMuted,
  },
  ctaContainer: {
    paddingHorizontal: 32,
    paddingBottom: 24,
    alignItems: "center",
    gap: 12,
  },
  enterBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: Colors.dark.accent,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 56,
    width: width - 64,
  },
  enterText: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: "#fff",
    letterSpacing: 0.3,
  },
  enterArrow: {
    fontSize: 18,
    color: "#fff",
    opacity: 0.85,
  },
  ctaHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.dark.textMuted,
  },
});
