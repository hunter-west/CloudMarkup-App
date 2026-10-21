import {
  type UsabilityEvent,
  useUsabilityEvents,
} from "../instrumentation/usability-events.js";
import { useNotifications } from "../notifications/notification-context.js";
import type { ExperienceMode } from "./mode-preference.js";
import { useModePreference } from "./mode-preference-context.js";

const modes: readonly ExperienceMode[] = ["guided", "professional"];

export function ModeSwitch({
  surface = "shell",
}: {
  readonly surface?: Extract<
    UsabilityEvent,
    { readonly type: "mode_changed" }
  >["surface"];
} = {}) {
  const { mode, setMode } = useModePreference();
  const usabilityEvents = useUsabilityEvents();
  const { addNotification } = useNotifications();

  function selectMode(nextMode: ExperienceMode) {
    if (nextMode === mode) {
      return;
    }

    usabilityEvents.record({
      from: mode,
      surface,
      to: nextMode,
      type: "mode_changed",
    });
    setMode(nextMode);
    addNotification({
      kind: "info",
      title: `${capitalize(nextMode)} presentation enabled`,
      message: "Architecture data and editing capabilities did not change.",
      toast: false,
    });
  }

  return (
    <fieldset className="mode-switch">
      <legend>Experience mode</legend>
      <div className="mode-switch__options">
        {modes.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            className="mode-switch__option"
            onClick={() => {
              selectMode(option);
            }}
          >
            {capitalize(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function capitalize(value: ExperienceMode): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
