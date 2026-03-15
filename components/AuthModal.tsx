import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";

interface AuthModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: () => void;
}

export default function AuthModal({ visible, onDismiss, onSuccess }: AuthModalProps) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) {
      setEmail("");
      setPassword("");
      setError("");
      setMode("register");
    }
  }, [visible]);

  const handleSubmit = async () => {
    setError("");
    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }
    if (!password.trim()) {
      setError("Please enter your password.");
      return;
    }
    if (mode === "register" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "register") {
        await register(email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "padding"}
      >
        <Pressable style={styles.backdrop} onPress={onDismiss} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Ionicons name="mic" size={28} color={Colors.dark.accent} />
            <Text style={styles.headerTitle}>Create login & see accent score</Text>
            <Text style={styles.headerSub}>Track your pronunciation progress over time</Text>
          </View>

          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, mode === "register" && styles.tabActive]}
              onPress={() => { setMode("register"); setError(""); }}
            >
              <Text style={[styles.tabText, mode === "register" && styles.tabTextActive]}>
                Create Account
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, mode === "login" && styles.tabActive]}
              onPress={() => { setMode("login"); setError(""); }}
            >
              <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>
                Log In
              </Text>
            </Pressable>
          </View>

          <View style={styles.form}>
            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={18} color={Colors.dark.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={Colors.dark.textMuted}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(""); }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                autoComplete="email"
              />
            </View>

            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.dark.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder={mode === "register" ? "Password (min 6 chars)" : "Password"}
                placeholderTextColor={Colors.dark.textMuted}
                value={password}
                onChangeText={(t) => { setPassword(t); setError(""); }}
                secureTextEntry
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />
            </View>

            {error ? (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color={Colors.dark.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.submitBtn, loading && { opacity: 0.7 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>
                  {mode === "register" ? "Create Account" : "Log In"}
                </Text>
              )}
            </Pressable>
          </View>

          <Pressable style={styles.skipBtn} onPress={onDismiss}>
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: Colors.dark.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.dark.border,
    alignSelf: "center",
    marginBottom: 20,
  },
  header: {
    alignItems: "center",
    marginBottom: 20,
    gap: 6,
  },
  headerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: Colors.dark.text,
    textAlign: "center",
    marginTop: 4,
  },
  headerSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.dark.textMuted,
    textAlign: "center",
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: Colors.dark.background,
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: Colors.dark.accent,
  },
  tabText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.dark.textMuted,
  },
  tabTextActive: {
    color: "#fff",
  },
  form: {
    gap: 10,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    paddingHorizontal: 14,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 48,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.dark.text,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.dark.error,
    flex: 1,
  },
  submitBtn: {
    backgroundColor: Colors.dark.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  submitBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#fff",
  },
  skipBtn: {
    alignItems: "center",
    paddingVertical: 16,
  },
  skipText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.dark.textMuted,
  },
});
