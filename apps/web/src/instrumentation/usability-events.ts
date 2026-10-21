import { createContext, useContext } from "react";

export const MAX_LOCAL_USABILITY_EVENTS = 64;

export type UsabilityEvent =
  | {
      readonly type: "walkthrough_started";
      readonly walkthrough: "notes-api";
      readonly surface: "first-use" | "help";
    }
  | {
      readonly type: "walkthrough_completed";
      readonly walkthrough: "notes-api";
      readonly surface: "first-use" | "help";
    }
  | {
      readonly type: "mode_changed";
      readonly from: "guided" | "professional";
      readonly to: "guided" | "professional";
      readonly surface: "onboarding" | "settings" | "shell" | "walkthrough";
    }
  | {
      readonly type: "validation_fix_accepted";
      readonly target: "compilation" | "draft";
      readonly surface: "issues";
    }
  | {
      readonly type: "export_entry_point_opened";
      readonly artifact: "code" | "diagram";
      readonly surface: "walkthrough" | "workspace";
    };

/**
 * Internal, best-effort event boundary. Implementations must not infer product
 * state from these events or make a user workflow depend on recording them.
 */
export interface UsabilityEventsAdapter {
  record(event: UsabilityEvent): void;
}

export interface LocalUsabilityEventsAdapter extends UsabilityEventsAdapter {
  clear(): void;
  read(): readonly UsabilityEvent[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExperienceMode(value: unknown): value is "guided" | "professional" {
  return value === "guided" || value === "professional";
}

/**
 * Rebuilds one runtime event from the closed coarse vocabulary. Unknown fields
 * are discarded and missing or invalid enum values fail closed to no event.
 */
export function sanitizeUsabilityEvent(value: unknown): UsabilityEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  switch (value["type"]) {
    case "walkthrough_started":
    case "walkthrough_completed": {
      const surface = value["surface"];
      if (
        value["walkthrough"] !== "notes-api" ||
        (surface !== "first-use" && surface !== "help")
      ) {
        return null;
      }
      return Object.freeze({
        surface,
        type: value["type"],
        walkthrough: "notes-api",
      });
    }
    case "mode_changed": {
      const from = value["from"];
      const surface = value["surface"];
      const to = value["to"];
      if (
        !isExperienceMode(from) ||
        !isExperienceMode(to) ||
        (surface !== "onboarding" &&
          surface !== "settings" &&
          surface !== "shell" &&
          surface !== "walkthrough")
      ) {
        return null;
      }
      return Object.freeze({ from, surface, to, type: "mode_changed" });
    }
    case "validation_fix_accepted": {
      const target = value["target"];
      if (
        value["surface"] !== "issues" ||
        (target !== "compilation" && target !== "draft")
      ) {
        return null;
      }
      return Object.freeze({
        surface: "issues",
        target,
        type: "validation_fix_accepted",
      });
    }
    case "export_entry_point_opened": {
      const artifact = value["artifact"];
      const surface = value["surface"];
      if (
        (artifact !== "code" && artifact !== "diagram") ||
        (surface !== "walkthrough" && surface !== "workspace")
      ) {
        return null;
      }
      return Object.freeze({
        artifact,
        surface,
        type: "export_entry_point_opened",
      });
    }
    default:
      return null;
  }
}

export const NOOP_USABILITY_EVENTS_ADAPTER: UsabilityEventsAdapter =
  Object.freeze({
    record(event: UsabilityEvent) {
      void event;
      // Product analytics are intentionally not connected.
    },
  });

export const UsabilityEventsContext = createContext<UsabilityEventsAdapter>(
  NOOP_USABILITY_EVENTS_ADAPTER,
);

/** Safe outside a provider: the returned recorder is a no-op. */
export function useUsabilityEvents(): UsabilityEventsAdapter {
  return useContext(UsabilityEventsContext);
}

/**
 * Bounded process-local recorder for tests and local inspection. It performs no
 * persistence or transmission and drops the oldest event at capacity.
 */
export function createLocalUsabilityEventsAdapter(): LocalUsabilityEventsAdapter {
  let events: readonly UsabilityEvent[] = [];

  return Object.freeze({
    clear() {
      events = [];
    },
    read() {
      return Object.freeze([...events]);
    },
    record(event: UsabilityEvent) {
      const recordedEvent = sanitizeUsabilityEvent(event);
      if (recordedEvent === null) {
        return;
      }
      events = Object.freeze(
        [...events, recordedEvent].slice(-MAX_LOCAL_USABILITY_EVENTS),
      );
    },
  });
}
