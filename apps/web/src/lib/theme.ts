import { useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const KEY = "jotbox-theme";
const EVENT = "jotbox-theme-change";

export function getTheme(): ThemeChoice {
  const stored = localStorage.getItem(KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "light";
}

export function applyTheme(theme: ThemeChoice) {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && systemDark);
  document.documentElement.classList.toggle("dark", dark);
}

export function applyStoredTheme() {
  applyTheme(getTheme());
}

export function setTheme(theme: ThemeChoice) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
  window.dispatchEvent(new Event(EVENT));
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme);
  useEffect(() => {
    const sync = () => {
      const next = getTheme();
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener(EVENT, sync);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      media.removeEventListener("change", sync);
    };
  }, []);
  return theme;
}

export function useIsDark() {
  const [dark, setDark] = useState(() => {
    const stored = getTheme();
    return stored === "dark" || (stored === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const compute = () => {
      const stored = getTheme();
      setDark(stored === "dark" || (stored === "system" && media.matches));
    };
    window.addEventListener(EVENT, compute);
    media.addEventListener("change", compute);
    compute();
    return () => {
      window.removeEventListener(EVENT, compute);
      media.removeEventListener("change", compute);
    };
  }, []);

  return dark;
}
