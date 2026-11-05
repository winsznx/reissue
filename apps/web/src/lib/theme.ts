"use client";

import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "reissue-theme";
const CHANGE_EVENT = "reissue-theme-change";

/** Runs before first paint (inlined in the document head) so the page never flashes the wrong theme. */
export const THEME_BOOT_SCRIPT = `(() => {
  try {
    const pref = localStorage.getItem("${THEME_STORAGE_KEY}") || "system";
    const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (error) {
    document.documentElement.dataset.theme = "light";
  }
})();`;

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function apply(preference: ThemePreference): void {
  const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    if (readPreference() === "system") apply("system");
    onChange();
  };
  media.addEventListener("change", onSystem);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    media.removeEventListener("change", onSystem);
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch (error) {
    console.warn("Theme preference could not be saved", error);
  }
  apply(preference);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readPreference, () => "system");
}
