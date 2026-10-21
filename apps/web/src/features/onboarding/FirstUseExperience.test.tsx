import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createLocalUsabilityEventsAdapter,
  type LocalUsabilityEventsAdapter,
} from "../../instrumentation/usability-events.js";
import { UsabilityEventsProvider } from "../../instrumentation/UsabilityEventsProvider.js";
import {
  NotificationProvider,
  useNotifications,
} from "../../notifications/index.js";
import {
  ExperiencePreferenceProvider,
  ModePreferenceProvider,
  getExperiencePreferenceStorageKey,
  type ModePreferenceStorage,
  getModePreferenceStorageKey,
  useModePreference,
  type ExperiencePreferenceStorage,
} from "../../preferences/index.js";
import { RouterProvider, useAppLocation } from "../../routing/index.js";
import { FirstUseExperience } from "./FirstUseExperience.js";

class MemoryStorage implements ExperiencePreferenceStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function StateProbe() {
  const location = useAppLocation();
  const { mode } = useModePreference();
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <output data-testid="mode">{mode}</output>
    </>
  );
}

function ExternalModeControl() {
  const { setMode } = useModePreference();
  return (
    <button
      onClick={() => {
        setMode("professional");
      }}
      type="button"
    >
      Set external Professional mode
    </button>
  );
}

function NotificationProbe() {
  const { history } = useNotifications();
  return (
    <output data-testid="notifications">
      {history
        .map(
          (notification) =>
            `${notification.title}: ${notification.message ?? ""}`,
        )
        .join("|")}
    </output>
  );
}

interface RenderFirstUseOptions {
  readonly actorId?: string;
  readonly adapter?: LocalUsabilityEventsAdapter;
  readonly experienceStorage?: ExperiencePreferenceStorage;
  readonly modeStorage?: ModePreferenceStorage;
}

function renderFirstUse({
  adapter = createLocalUsabilityEventsAdapter(),
  actorId = "first-use-test-actor",
  experienceStorage = new MemoryStorage(),
  modeStorage = new MemoryStorage(),
}: RenderFirstUseOptions = {}) {
  render(
    <RouterProvider>
      <NotificationProvider>
        <ModePreferenceProvider actorId={actorId} storage={modeStorage}>
          <ExperiencePreferenceProvider
            actorId={actorId}
            storage={experienceStorage}
          >
            <UsabilityEventsProvider adapter={adapter}>
              <FirstUseExperience />
              <ExternalModeControl />
              <StateProbe />
            </UsabilityEventsProvider>
          </ExperiencePreferenceProvider>
        </ModePreferenceProvider>
        <NotificationProbe />
      </NotificationProvider>
    </RouterProvider>,
  );
  return { actorId, adapter, experienceStorage, modeStorage };
}

describe("FirstUseExperience", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/organizations/local-org/projects");
  });

  it("starts with lightweight safe choices and can be skipped", () => {
    const { actorId, experienceStorage } = renderFirstUse();

    expect(screen.getByRole("radio", { name: /Guided/u })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Start with a blank canvas/u }),
    ).toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Not now" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Preferred cloud provider" }),
    ).not.toBeVisible();
    fireEvent.click(screen.getByText("Optional defaults and teaching"));
    expect(
      screen.getByRole("combobox", { name: "Preferred cloud provider" }),
    ).toHaveValue("aws");
    expect(
      screen.getByRole("checkbox", { name: /Show the editor tour/u }),
    ).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Skip and explore" }));

    expect(
      screen.queryByTestId("first-use-experience"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/organizations/local-org/projects",
    );
    expect(
      experienceStorage.getItem(getExperiencePreferenceStorageKey(actorId)),
    ).toContain('"firstUseStatus":"skipped"');
  });

  it("keeps both assistance modes in one shared choice surface", () => {
    renderFirstUse();

    const experienceGroup = screen.getByRole("group", {
      name: "Experience preference",
    });
    const projectStartGroup = screen.getByRole("group", {
      name: "Project start",
    });
    const blankStart = within(projectStartGroup).getByRole("radio", {
      name: "Start with a blank canvas",
    });
    fireEvent.click(screen.getByText("Optional defaults and teaching"));
    const region = screen.getByRole("textbox", {
      name: /^Default Region, when known/u,
    });

    fireEvent.change(region, { target: { value: "us-west-2" } });
    fireEvent.click(
      within(experienceGroup).getByRole("radio", { name: "Professional" }),
    );

    expect(
      within(experienceGroup).getByRole("radio", { name: "Guided" }),
    ).toBeVisible();
    expect(
      within(experienceGroup).getByRole("radio", { name: "Professional" }),
    ).toBeChecked();
    expect(blankStart).toBeChecked();
    expect(region).toHaveValue("us-west-2");
    expect(region).toBeVisible();
    expect(
      screen.getByText("Optional defaults and teaching").closest("details"),
    ).toHaveAttribute("open");
  });

  it("persists Professional, Region, template, and teaching choices before navigation", () => {
    const adapter = createLocalUsabilityEventsAdapter();
    const { actorId, experienceStorage, modeStorage } = renderFirstUse({
      adapter,
    });

    fireEvent.click(screen.getByRole("radio", { name: /Professional/u }));
    fireEvent.click(screen.getByText("Optional defaults and teaching"));
    fireEvent.change(screen.getByRole("textbox", { name: /Default Region/u }), {
      target: { value: "us-east-1" },
    });
    fireEvent.click(
      screen.getByRole("radio", { name: /Start from a template/u }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Show the editor tour/u }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start local experience" }),
    );

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/organizations/local-org/projects/field-notes/editor?start=template",
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("professional");
    expect(modeStorage.getItem(getModePreferenceStorageKey(actorId))).toBe(
      "professional",
    );
    const stored = experienceStorage.getItem(
      getExperiencePreferenceStorageKey(actorId),
    );
    expect(stored).toContain('"defaultRegion":"us-east-1"');
    expect(stored).toContain('"startChoice":"template"');
    expect(stored).toContain('"contextualTeachingEnabled":false');
    expect(adapter.read()).toContainEqual({
      from: "guided",
      surface: "onboarding",
      to: "professional",
      type: "mode_changed",
    });
  });

  it.each([
    ["Describe with AI", "/organizations/local-org/projects/new?start=prompt"],
    [
      "Start with a blank canvas",
      "/organizations/local-org/projects/field-notes/editor?start=blank",
    ],
  ])("routes %s through its bounded local start", (choice, destination) => {
    renderFirstUse();
    fireEvent.click(
      screen.getByRole("radio", { name: new RegExp(choice, "u") }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start local experience" }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(destination);
  });

  it("tracks a mode change made by the live shell before submission", () => {
    renderFirstUse();

    expect(screen.getByRole("radio", { name: /Guided/u })).toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Set external Professional mode" }),
    );
    expect(screen.getByRole("radio", { name: /Professional/u })).toBeChecked();

    fireEvent.click(
      screen.getByRole("button", { name: "Start local experience" }),
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("professional");
  });

  it("reopens optional defaults and focuses an invalid Region without navigation", async () => {
    const { actorId, experienceStorage } = renderFirstUse();
    fireEvent.click(screen.getByText("Optional defaults and teaching"));
    fireEvent.change(screen.getByRole("textbox", { name: /Default Region/u }), {
      target: { value: "US-EAST-1" },
    });
    fireEvent.click(screen.getByText("Optional defaults and teaching"));
    expect(
      screen.getByText("Optional defaults and teaching").closest("details"),
    ).not.toHaveAttribute("open");
    fireEvent.click(
      screen.getByRole("button", { name: "Start local experience" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a lowercase provider Region identifier",
    );
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: /Default Region/u }),
      ).toHaveFocus();
    });
    expect(screen.getByTestId("first-use-experience")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/organizations/local-org/projects",
    );
    expect(
      experienceStorage.getItem(getExperiencePreferenceStorageKey(actorId)),
    ).toBeNull();
  });

  it.each(["Start local experience", "Skip and explore"])(
    "surfaces an observable warning when %s cannot persist preferences",
    (action) => {
      const experienceStorage: ExperiencePreferenceStorage = {
        getItem() {
          return null;
        },
        setItem() {
          throw new Error("blocked");
        },
      };
      renderFirstUse({ experienceStorage });

      fireEvent.click(screen.getByRole("button", { name: action }));

      expect(
        screen.queryByTestId("first-use-experience"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("notifications")).toHaveTextContent(
        "Preferences not saved",
      );
      expect(screen.getByTestId("notifications")).toHaveTextContent(
        "choices may reappear after reload",
      );
    },
  );
});
