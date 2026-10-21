import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UsabilityEventsProvider } from "./UsabilityEventsProvider.js";
import {
  MAX_LOCAL_USABILITY_EVENTS,
  useUsabilityEvents,
  createLocalUsabilityEventsAdapter,
  type UsabilityEvent,
} from "./usability-events.js";

const representativeEvents = [
  {
    surface: "first-use",
    type: "walkthrough_started",
    walkthrough: "notes-api",
  },
  {
    surface: "help",
    type: "walkthrough_completed",
    walkthrough: "notes-api",
  },
  {
    from: "guided",
    surface: "shell",
    to: "professional",
    type: "mode_changed",
  },
  {
    surface: "issues",
    target: "draft",
    type: "validation_fix_accepted",
  },
  {
    artifact: "diagram",
    surface: "workspace",
    type: "export_entry_point_opened",
  },
] as const satisfies readonly UsabilityEvent[];

function RecordingProbe({
  events,
}: {
  readonly events: readonly UsabilityEvent[];
}) {
  const usabilityEvents = useUsabilityEvents();

  return (
    <button
      type="button"
      onClick={() => {
        events.forEach((event) => {
          usabilityEvents.record(event);
        });
      }}
    >
      Record usability events
    </button>
  );
}

describe("UsabilityEventsProvider", () => {
  it("is safely inert when no provider is mounted", () => {
    render(<RecordingProbe events={representativeEvents} />);

    expect(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Record usability events" }),
      );
    }).not.toThrow();
  });

  it("discards unexpected runtime properties before retaining a local event", () => {
    const adapter = createLocalUsabilityEventsAdapter();
    const eventWithPrivateFields = {
      actorId: "must-not-be-retained",
      from: "guided",
      note: "free text must not cross the boundary",
      surface: "shell",
      to: "professional",
      type: "mode_changed",
    } as const;

    adapter.record(eventWithPrivateFields);

    expect(adapter.read()).toEqual([
      {
        from: "guided",
        surface: "shell",
        to: "professional",
        type: "mode_changed",
      },
    ]);
    expect(adapter.read()[0]).not.toHaveProperty("actorId");
    expect(adapter.read()[0]).not.toHaveProperty("note");
  });

  it("drops runtime events with invalid coarse enum values", () => {
    const adapter = createLocalUsabilityEventsAdapter();
    const invalidEvent = {
      from: "guided",
      surface: "user-entered free text",
      to: "professional",
      type: "mode_changed",
    } as unknown as UsabilityEvent;

    adapter.record(invalidEvent);

    expect(adapter.read()).toEqual([]);
  });

  it("bounds the local adapter and drops the oldest events", () => {
    const adapter = createLocalUsabilityEventsAdapter();
    const firstEvent: UsabilityEvent = {
      from: "guided",
      surface: "onboarding",
      to: "professional",
      type: "mode_changed",
    };
    adapter.record(firstEvent);

    for (let index = 0; index < MAX_LOCAL_USABILITY_EVENTS; index += 1) {
      adapter.record({
        from: "professional",
        surface: "settings",
        to: "guided",
        type: "mode_changed",
      });
    }

    expect(adapter.read()).toHaveLength(MAX_LOCAL_USABILITY_EVENTS);
    expect(adapter.read()).not.toContainEqual(firstEvent);

    adapter.clear();
    expect(adapter.read()).toEqual([]);
  });

  it("contains adapter failures so instrumentation cannot break a workflow", () => {
    const record = vi.fn(() => {
      throw new Error("local adapter failure");
    });
    render(
      <UsabilityEventsProvider adapter={{ record }}>
        <RecordingProbe events={[representativeEvents[0]]} />
      </UsabilityEventsProvider>,
    );

    expect(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Record usability events" }),
      );
    }).not.toThrow();
    expect(record).toHaveBeenCalledWith(representativeEvents[0]);
  });

  it("sanitizes runtime payloads before calling an injected adapter", () => {
    const record = vi.fn();
    const eventWithPrivateFields = {
      actorId: "must-not-reach-the-adapter",
      from: "guided",
      note: "must-not-reach-the-adapter",
      surface: "onboarding",
      to: "professional",
      type: "mode_changed",
    } as const;
    render(
      <UsabilityEventsProvider adapter={{ record }}>
        <RecordingProbe events={[eventWithPrivateFields]} />
      </UsabilityEventsProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Record usability events" }),
    );

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      from: "guided",
      surface: "onboarding",
      to: "professional",
      type: "mode_changed",
    });
  });
});
