import { useEffect, useId } from "react";
import { Moon, Sun } from "lucide-react";
import { Button, FormField, Select } from "@cloudmarkup/ui";
import {
  applyDocumentTheme,
  useThemePreference,
  type ThemePreference,
} from "./theme-preference.js";

export function ThemePreferenceSync() {
  const { resolvedTheme } = useThemePreference();
  useEffect(() => {
    applyDocumentTheme();
  }, [resolvedTheme]);
  return null;
}
export function ThemeSwitch({
  settings = false,
}: {
  readonly settings?: boolean;
}) {
  const theme = useThemePreference();
  const appearanceId = useId();
  if (settings)
    return (
      <FormField
        label="Appearance"
        htmlFor={appearanceId}
        description="Choose a theme for this browser, or follow your system setting."
      >
        <Select
          id={appearanceId}
          value={theme.preference}
          onChange={(event) => {
            theme.setPreference(event.currentTarget.value as ThemePreference);
          }}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </Select>
      </FormField>
    );
  const dark = theme.resolvedTheme === "dark";
  return (
    <Button
      size="compact"
      variant="quiet"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        theme.setPreference(dark ? "light" : "dark");
      }}
    >
      {dark ? (
        <Sun size={18} aria-hidden="true" />
      ) : (
        <Moon size={18} aria-hidden="true" />
      )}
    </Button>
  );
}
