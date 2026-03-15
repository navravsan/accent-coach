import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { getApiUrl } from "@/lib/query-client";
import { clearLocalData } from "@/lib/accent-storage";

const TOKEN_KEY = "accent_auth_token";

export interface AuthUser {
  id: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<string>;
  register: (email: string, password: string) => Promise<string>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function storeToken(token: string) {
  if (Platform.OS === "web") {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
}

async function getStoredToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function deleteStoredToken() {
  if (Platform.OS === "web") {
    localStorage.removeItem(TOKEN_KEY);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const baseUrl = getApiUrl();
  const url = new URL(path, baseUrl);
  const res = await globalThis.fetch(url.toString(), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return res;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await getStoredToken();
        if (stored) {
          const res = await apiFetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${stored}` },
          });
          if (res.ok) {
            const data = await res.json();
            setUser(data.user);
            setToken(stored);
          } else {
            await deleteStoredToken();
          }
        }
      } catch {}
      setIsLoading(false);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<string> => {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    await storeToken(data.token);
    setToken(data.token);
    setUser(data.user);
    return data.token;
  }, []);

  const register = useCallback(async (email: string, password: string): Promise<string> => {
    const res = await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");
    await storeToken(data.token);
    setToken(data.token);
    setUser(data.user);
    return data.token;
  }, []);

  const logout = useCallback(async () => {
    await deleteStoredToken();
    await clearLocalData();
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
