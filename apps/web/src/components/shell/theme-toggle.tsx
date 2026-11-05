"use client";

import type { ReactNode } from "react";

import { setThemePreference, useThemePreference, type ThemePreference } from "@/lib/theme";

import { MonitorIcon, MoonIcon, SunIcon } from "../icons";
import { cx } from "../ui";

const OPTIONS: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: "system", label: "Match system", icon: <MonitorIcon size={14} /> },
  { value: "light", label: "Light", icon: <SunIcon size={14} /> },
  { value: "dark", label: "Dark", icon: <MoonIcon size={14} /> },
];

export function ThemeToggle() {
  const preference = useThemePreference();
  return (
    <div role="radiogroup" aria-label="Color theme" className="inline-flex rounded-[8px] border border-line bg-surface p-0.5">
      {OPTIONS.map((option) => {
        const active = option.value === preference;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.label}
            onClick={() => setThemePreference(option.value)}
            className={cx("grid size-7 place-items-center rounded-[6px] transition-colors duration-150", active ? "bg-sunken text-ink" : "text-ink-2 hover:text-ink")}
          >
            {option.icon}
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
