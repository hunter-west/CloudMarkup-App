import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  EXPERIENCE_PREFERENCE_MAX_SERIALIZED_LENGTH,
  EXPERIENCE_PREFERENCE_SCHEMA_VERSION,
  getExperiencePreferenceStorageKey,
  type ExperiencePreferenceStorage,
  normalizeDefaultRegion,
} from "./experience-preference.js";
import { ExperiencePreferenceProvider } from "./ExperiencePreferenceProvider.js";
import { useExperiencePreference } from "./experience-preference-context.js";

function PreferenceProbe() {
  const preference = useExperiencePreference();

  return (
    <div>
      <output data-testid="preference">
        {JSON.stringify({
          contextualTeachingEnabled: preference.contextualTeachingEnabled,
          defaultRegion: preference.defaultRegion,
          firstUseStatus: preference.firstUseStatus,
          notesApiWalkthrough: preference.notesApiWalkthrough,
          preferredProvider: preference.preferredProvider,
          startChoice: preference.startChoice,
          storageStatus: preference.storageStatus,
        })}
      </output>
      <button
        onClick={() => {
          preference.completeFirstUse({
            contextualTeachingEnabled: false,
            defaultRegion: "  us-east-1  ",
            preferredProvider: "aws",
            startChoice: "template",
          });
        }}
        type="button"
      >
        Complete first use
      </button>
      <button
        onClick={() => {
          preference.skipFirstUse();
        }}
        type="button"
      >
        Skip first use
      </button>
      <button
        onClick={() => {
          preference.restartFirstUse();
        }}
        type="button"
      >
        Restart first use
      </button>
      <button
        onClick={() => {
          preference.setContextualTeachingEnabled(false);
        }}
        type="button"
      >
        Disable teaching
      </button>
      <button
        onClick={() => {
          preference.setWalkthroughStatus("dismissed");
        }}
        type="button"
      >
        Dismiss walkthrough
      </button>
      <button
        onClick={() => {
          preference.setWalkthroughStatus("completed");
        }}
        type="button"
      >
        Complete walkthrough
      </button>
      <button
        onClick={() => {
          preference.restartWalkthrough();
        }}
        type="button"
      >
        Restart walkthrough
      </button>
    </div>
  );
}

function renderPreference(
  options: {
    readonly actorId?: string;
    readonly storage?: ExperiencePreferenceStorage | null;
  } = {},
) {
  return render(
    <ExperiencePreferenceProvider
      {...(options.actorId === undefined ? {} : { actorId: options.actorId })}
      {...(options.storage === undefined ? {} : { storage: options.storage })}
    >
      <PreferenceProbe />
    </ExperiencePreferenceProvider>,
  );
}

function readProbe() {
  return JSON.parse(screen.getByTestId("preference").textContent) as Record<
    string,
    unknown
  >;
}

describe("ExperiencePreferenceProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses the public provider-neutral Region identifier contract", () => {
    expect(normalizeDefaultRegion("  eastus  ")).toBe("eastus");
    expect(normalizeDefaultRegion("us-west-2")).toBe("us-west-2");
    expect(normalizeDefaultRegion("US-WEST-2")).toBeNull();
    expect(normalizeDefaultRegion("a".repeat(64))).toBeNull();
  });

  it("normalizes, persists, versions, and restores completed first use", () => {
    const actorId = "returning-actor";
    const firstRender = renderPreference({ actorId });
    fireEvent.click(screen.getByRole("button", { name: "Complete first use" }));

    expect(readProbe()).toMatchObject({
      contextualTeachingEnabled: false,
      defaultRegion: "us-east-1",
      firstUseStatus: "completed",
      startChoice: "template",
      storageStatus: "available",
    });
    const stored = window.localStorage.getItem(
      getExperiencePreferenceStorageKey(actorId),
    );
    expect(stored).not.toBeNull();
    expect(stored?.length).toBeLessThanOrEqual(
      EXPERIENCE_PREFERENCE_MAX_SERIALIZED_LENGTH,
    );
    expect(JSON.parse(stored ?? "{}")).toMatchObject({
      defaultRegion: "us-east-1",
      firstUseStatus: "completed",
      schemaVersion: EXPERIENCE_PREFERENCE_SCHEMA_VERSION,
      startChoice: "template",
    });

    firstRender.unmount();
    renderPreference({ actorId });
    expect(readProbe()).toMatchObject({
      defaultRegion: "us-east-1",
      firstUseStatus: "completed",
      startChoice: "template",
      storageStatus: "available",
    });
  });

  it("persists skip and restart without replacing choices", () => {
    renderPreference();
    fireEvent.click(screen.getByRole("button", { name: "Complete first use" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip first use" }));
    expect(readProbe()).toMatchObject({
      firstUseStatus: "skipped",
      startChoice: "template",
    });

    fireEvent.click(screen.getByRole("button", { name: "Restart first use" }));
    expect(readProbe()).toMatchObject({
      contextualTeachingEnabled: false,
      defaultRegion: "us-east-1",
      firstUseStatus: "pending",
      startChoice: "template",
    });
  });

  it("persists teaching and walkthrough lifecycle independently", () => {
    renderPreference();
    fireEvent.click(screen.getByRole("button", { name: "Disable teaching" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss walkthrough" }),
    );
    expect(readProbe()).toMatchObject({
      contextualTeachingEnabled: false,
      firstUseStatus: "pending",
      notesApiWalkthrough: "dismissed",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Complete walkthrough" }),
    );
    expect(readProbe()).toMatchObject({ notesApiWalkthrough: "completed" });

    fireEvent.click(
      screen.getByRole("button", { name: "Restart walkthrough" }),
    );
    expect(readProbe()).toMatchObject({
      contextualTeachingEnabled: false,
      notesApiWalkthrough: "not-started",
    });
  });

  it.each([
    ["malformed JSON", "{"],
    [
      "future schema",
      JSON.stringify({
        contextualTeachingEnabled: true,
        defaultRegion: null,
        firstUseStatus: "completed",
        notesApiWalkthrough: "completed",
        preferredProvider: "aws",
        schemaVersion: 2,
        startChoice: "blank",
      }),
    ],
    [
      "unknown fields",
      JSON.stringify({
        contextualTeachingEnabled: true,
        defaultRegion: null,
        firstUseStatus: "completed",
        notesApiWalkthrough: "completed",
        preferredProvider: "aws",
        schemaVersion: 1,
        startChoice: "blank",
        transmittedAnalyticsId: "not-allowed",
      }),
    ],
    [
      "oversize input",
      "x".repeat(EXPERIENCE_PREFERENCE_MAX_SERIALIZED_LENGTH + 1),
    ],
  ])("fails closed for %s", (_label, serialized) => {
    window.localStorage.setItem(
      getExperiencePreferenceStorageKey(),
      serialized,
    );
    renderPreference();

    expect(readProbe()).toMatchObject({
      defaultRegion: null,
      firstUseStatus: "pending",
      notesApiWalkthrough: "not-started",
      storageStatus: "read-failed",
    });
  });

  it("fails closed for a non-canonical Region on restore", () => {
    window.localStorage.setItem(
      getExperiencePreferenceStorageKey(),
      JSON.stringify({
        contextualTeachingEnabled: true,
        defaultRegion: "US-EAST-1",
        firstUseStatus: "completed",
        notesApiWalkthrough: "not-started",
        preferredProvider: "aws",
        schemaVersion: 1,
        startChoice: "blank",
      }),
    );
    renderPreference();

    expect(readProbe()).toMatchObject({
      defaultRegion: null,
      firstUseStatus: "pending",
      storageStatus: "read-failed",
    });
  });

  it("keeps the selected session usable after a write failure", () => {
    const writeFailureStorage: ExperiencePreferenceStorage = {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    renderPreference({ storage: writeFailureStorage });
    fireEvent.click(screen.getByRole("button", { name: "Complete first use" }));

    expect(readProbe()).toMatchObject({
      defaultRegion: "us-east-1",
      firstUseStatus: "completed",
      startChoice: "template",
      storageStatus: "write-failed",
    });
  });

  it("falls back safely when storage cannot be read", () => {
    const readFailureStorage: ExperiencePreferenceStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        // A later explicit preference change may retry persistence.
      },
    };
    renderPreference({ storage: readFailureStorage });

    expect(readProbe()).toMatchObject({
      firstUseStatus: "pending",
      storageStatus: "read-failed",
    });
  });

  it("rejects access outside its provider", () => {
    expect(() => render(<PreferenceProbe />)).toThrow(
      new Error(
        "useExperiencePreference must be used within an ExperiencePreferenceProvider.",
      ),
    );
  });
});
