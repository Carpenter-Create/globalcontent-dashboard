"use client";

import { APPEARANCE } from "@/lib/appearance";
import { THEME_PREFERENCES, applyDocumentThemePreference } from "@/lib/theme";
import { useThemePreference } from "@/components/theme-toggle";

// Quiet radios. Selecting writes the existing gc-theme key and applies
// .dark the same way the previous header toggle did. Auto is the same key.

export function AppearanceForm() {
  const preference = useThemePreference();

  return (
    <div
      role="radiogroup"
      aria-label={APPEARANCE.title}
      data-appearance-form=""
      className="flex flex-col gap-[var(--space-3)]"
    >
      {THEME_PREFERENCES.map((value) => (
        <label key={value} className="flex items-center gap-[var(--space-2)] t-body text-ink">
          <input
            type="radio"
            name="appearance"
            value={value}
            checked={preference === value}
            onChange={() => {
              applyDocumentThemePreference(value);
            }}
          />
          {APPEARANCE[value]}
        </label>
      ))}
    </div>
  );
}
