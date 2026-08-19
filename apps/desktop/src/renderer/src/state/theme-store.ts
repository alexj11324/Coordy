import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";

export const FONT_SIZE_OPTIONS = [
  { px: 14, label: "小" },
  { px: 16, label: "标准" },
  { px: 18, label: "中" },
  { px: 20, label: "大" },
  { px: 22, label: "特大" },
] as const;

export const DEFAULT_FONT_SIZE_PX = 18;
export const FONT_SIZE_VALUES = FONT_SIZE_OPTIONS.map((item) => item.px);

const THEME_KEY = "coordy.theme";
const FONT_KEY = "coordy.font-size";

function readPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  return "system";
}

function readFontSize(): number {
  if (typeof window === "undefined") return DEFAULT_FONT_SIZE_PX;
  const saved = Number(window.localStorage.getItem(FONT_KEY));
  if (FONT_SIZE_VALUES.includes(saved as (typeof FONT_SIZE_VALUES)[number])) return saved;
  return DEFAULT_FONT_SIZE_PX;
}

function systemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function resolvedTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") return systemDark() ? "dark" : "light";
  return preference;
}

export function applyTheme(preference: ThemePreference) {
  document.documentElement.classList.toggle("dark", resolvedTheme(preference) === "dark");
}

export function applyFontSize(px: number) {
  document.documentElement.style.fontSize = `${px}px`;
}

export function applyAppearance(preference: ThemePreference, fontSizePx: number) {
  applyTheme(preference);
  applyFontSize(fontSizePx);
}

export function nextFontSize(current: number, direction: 1 | -1): number {
  const index = FONT_SIZE_VALUES.indexOf(current as (typeof FONT_SIZE_VALUES)[number]);
  const at = index < 0 ? FONT_SIZE_VALUES.indexOf(DEFAULT_FONT_SIZE_PX) : index;
  return FONT_SIZE_VALUES[Math.min(FONT_SIZE_VALUES.length - 1, Math.max(0, at + direction))]!;
}

type ThemeState = {
  preference: ThemePreference;
  fontSizePx: number;
  setPreference: (preference: ThemePreference) => void;
  setFontSizePx: (px: number) => void;
  bumpFontSize: (direction: 1 | -1) => void;
  resetFontSize: () => void;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: readPreference(),
  fontSizePx: readFontSize(),
  setPreference: (preference) => {
    window.localStorage.setItem(THEME_KEY, preference);
    applyTheme(preference);
    set({ preference });
  },
  setFontSizePx: (px) => {
    const fontSizePx = FONT_SIZE_VALUES.includes(px as (typeof FONT_SIZE_VALUES)[number])
      ? px
      : DEFAULT_FONT_SIZE_PX;
    window.localStorage.setItem(FONT_KEY, String(fontSizePx));
    applyFontSize(fontSizePx);
    set({ fontSizePx });
  },
  bumpFontSize: (direction) => {
    get().setFontSizePx(nextFontSize(get().fontSizePx, direction));
  },
  resetFontSize: () => get().setFontSizePx(DEFAULT_FONT_SIZE_PX),
}));
