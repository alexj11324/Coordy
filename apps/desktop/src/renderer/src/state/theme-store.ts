import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "coordy.theme";

function readPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  return "system";
}

function systemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function resolvedTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") return systemDark() ? "dark" : "light";
  return preference;
}

export function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolvedTheme(preference) === "dark");
}

type ThemeState = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

export const useThemeStore = create<ThemeState>((set) => ({
  preference: readPreference(),
  setPreference: (preference) => {
    window.localStorage.setItem(STORAGE_KEY, preference);
    applyTheme(preference);
    set({ preference });
  },
}));
