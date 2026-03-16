import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Dimensions,
  Animated,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const { width, height } = Dimensions.get("window");

export default function IntroScreen() {
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  const titleAnim = useRef(new Animated.Value(0)).current;
  const subtitleAnim = useRef(new Animated.Value(0)).current;
  const btnAnim = useRef(new Animated.Value(0)).current;
  const btnScale = useRef(new Animated.Value(1)).current;

  // Orb pulse
  const orbAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(orbAnim, { toValue: 1, duration: 3000, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(orbAnim, { toValue: 0, duration: 3000, useNativeDriver: Platform.OS !== "web" }),
      ])
    ).start();

    Animated.stagger(350, [
      Animated.timing(titleAnim, { toValue: 1, duration: 650, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(subtitleAnim, { toValue: 1, duration: 600, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(btnAnim, { toValue: 1, duration: 600, useNativeDriver: Platform.OS !== "web" }),
    ]).start();
  }, []);

  const handleEnter = () => {
    Animated.sequence([
      Animated.timing(btnScale, { toValue: 0.95, duration: 80, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(btnScale, { toValue: 1, duration: 80, useNativeDriver: Platform.OS !== "web" }),
    ]).start(() => {
      router.replace("/(tabs)");
    });
  };

  const orb1Opacity = orbAnim.interpolate({ inputRange: [0, 1], outputRange: [0.07, 0.18] });
  const orb2Opacity = orbAnim.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.06] });
  const orb3Opacity = orbAnim.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.14] });

  const titleTranslate = titleAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });
  const subtitleTranslate = subtitleAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const btnTranslate = btnAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

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
      <Animated.View style={[styles.orb, styles.orb1, { opacity: orb1Opacity }]} />
      <Animated.View style={[styles.orb, styles.orb2, { opacity: orb2Opacity }]} />
      <Animated.View style={[styles.orb, styles.orb3, { opacity: orb3Opacity }]} />

      {/* Main content */}
      <View style={styles.content}>
        <Animated.View
          style={[
            styles.brandMark,
            { opacity: titleAnim, transform: [{ translateY: titleTranslate }] },
          ]}
        >
          <Text style={styles.logoAccent}>Go</Text>
          <Text style={styles.logoMain}>Accent</Text>
          <Text style={styles.logoDot}>.Pro</Text>
        </Animated.View>

        <Animated.Text
          style={[
            styles.tagline,
            { opacity: subtitleAnim, transform: [{ translateY: subtitleTranslate }] },
          ]}
        >
          Sound like a native.
        </Animated.Text>
      </View>

      {/* CTA */}
      <Animated.View
        style={[
          styles.ctaContainer,
          { opacity: btnAnim, transform: [{ translateY: btnTranslate }] },
        ]}
      >
        <Pressable onPress={handleEnter}>
          <Animated.View style={[styles.enterBtn, { transform: [{ scale: btnScale }] }]}>
            <Text style={styles.enterText}>Enter</Text>
            <Text style={styles.enterArrow}>→</Text>
          </Animated.View>
        </Pressable>
        <Text style={styles.ctaHint}>No account needed to start</Text>
      </Animated.View>
    </View>
  );
}

const ORB_1 = 340;
const ORB_2 = 280;
const ORB_3 = 220;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  orb: {
    position: "absolute",
    borderRadius: 9999,
  },
  orb1: {
    width: ORB_1,
    height: ORB_1,
    backgroundColor: Colors.dark.accent,
    left: -ORB_1 * 0.3,
    top: height * 0.15,
  },
  orb2: {
    width: ORB_2,
    height: ORB_2,
    backgroundColor: "#7c5cbf",
    right: -ORB_2 * 0.2,
    top: height * 0.32,
  },
  orb3: {
    width: ORB_3,
    height: ORB_3,
    backgroundColor: Colors.dark.accent,
    left: width * 0.25,
    bottom: height * 0.22,
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
