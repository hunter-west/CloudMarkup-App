import { Button, Disclosure } from "@cloudmarkup/ui";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";

import { useUsabilityEvents } from "../../instrumentation/usability-events.js";
import { useNotifications } from "../../notifications/index.js";
import {
  normalizeDefaultRegion,
  useExperiencePreference,
  useModePreference,
  type ExperiencePreferenceStorageStatus,
  type ProjectStartChoice,
} from "../../preferences/index.js";
import { useNavigate } from "../../routing/index.js";
import "./onboarding.css";

const organizationRoot = "/organizations/local-org";

const startChoices = [
  {
    description:
      "Open a local description form. No model request or credits are used.",
    id: "prompt",
    label: "Describe with AI",
  },
  {
    description: "Open the local notes API learning fixture.",
    id: "template",
    label: "Start from a template",
  },
  {
    description: "Open an empty AWS Architecture Document.",
    id: "blank",
    label: "Start with a blank canvas",
  },
] as const satisfies readonly {
  readonly description: string;
  readonly id: ProjectStartChoice;
  readonly label: string;
}[];

function destinationForStartChoice(choice: ProjectStartChoice): string {
  if (choice === "prompt") {
    return `${organizationRoot}/projects/new?start=prompt`;
  }
  return `${organizationRoot}/projects/field-notes/editor?start=${choice}`;
}

export function FirstUseExperience() {
  const preference = useExperiencePreference();
  const { mode, setMode } = useModePreference();
  const usabilityEvents = useUsabilityEvents();
  const navigate = useNavigate();
  const { addNotification } = useNotifications();
  const [defaultRegion, setDefaultRegion] = useState(
    preference.defaultRegion ?? "",
  );
  const [startChoice, setStartChoice] = useState<ProjectStartChoice>(
    preference.startChoice,
  );
  const [contextualTeachingEnabled, setContextualTeachingEnabled] = useState(
    preference.contextualTeachingEnabled,
  );
  const [regionError, setRegionError] = useState<string | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const regionInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (regionError !== null && preferencesOpen) {
      regionInput.current?.focus();
    }
  }, [preferencesOpen, regionError]);

  if (preference.firstUseStatus !== "pending") {
    return null;
  }

  function notifyPreferenceStorageFailure(
    storageStatus: ExperiencePreferenceStorageStatus,
  ) {
    if (storageStatus === "available") {
      return;
    }
    addNotification({
      kind: "warning",
      message:
        "The selected experience continues for this session, but local preference storage is unavailable and these choices may reappear after reload.",
      title: "Preferences not saved",
    });
  }

  function skipFirstUse() {
    notifyPreferenceStorageFailure(preference.skipFirstUse());
  }
  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedRegion = normalizeDefaultRegion(defaultRegion);
    if (defaultRegion.trim().length > 0 && normalizedRegion === null) {
      setPreferencesOpen(true);
      setRegionError(
        "Enter a lowercase provider Region identifier using letters, digits, and hyphens (up to 63 characters).",
      );
      return;
    }
    setRegionError(null);
    const storageStatus = preference.completeFirstUse({
      contextualTeachingEnabled,
      defaultRegion: normalizedRegion,
      preferredProvider: "aws",
      startChoice,
    });
    notifyPreferenceStorageFailure(storageStatus);
    navigate(destinationForStartChoice(startChoice));
  }

  return (
    <section
      aria-labelledby="first-use-title"
      className="first-use-card"
      data-testid="first-use-experience"
    >
      <div className="first-use-card__intro">
        <div>
          <p className="status-label">First-use setup · local only</p>
          <h2 id="first-use-title">How would you like to begin?</h2>
          <p>
            Choose a starting point. Preferences can be changed later without
            changing an architecture.
          </p>
        </div>
        <Button
          onClick={skipFirstUse}
          size="compact"
          type="button"
          variant="quiet"
        >
          Skip and explore
        </Button>
      </div>

      <form className="first-use-form" onSubmit={handleSubmit}>
        <fieldset className="first-use-form__group">
          <legend>Experience preference</legend>
          <div className="first-use-form__choices">
            {(["guided", "professional"] as const).map((option) => (
              <label className="first-use-choice" key={option}>
                <input
                  checked={mode === option}
                  aria-label={option === "guided" ? "Guided" : "Professional"}
                  name="experience-mode"
                  onChange={() => {
                    if (option === mode) {
                      return;
                    }
                    setMode(option);
                    usabilityEvents.record({
                      from: mode,
                      surface: "onboarding",
                      to: option,
                      type: "mode_changed",
                    });
                  }}
                  type="radio"
                  value={option}
                />
                <span>
                  <strong>
                    {option === "guided" ? "Guided" : "Professional"}
                  </strong>
                  <small>
                    {option === "guided"
                      ? "Step-by-step context in plain language."
                      : "Concise guidance with technical terminology."}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Disclosure
          className="first-use-form__preferences"
          onToggle={(event) => {
            setPreferencesOpen(event.currentTarget.open);
          }}
          open={preferencesOpen}
          summary="Optional defaults and teaching"
        >
          <div className="first-use-form__row">
            <label className="field">
              <span>Preferred cloud provider</span>
              <select
                aria-label="Preferred cloud provider"
                value="aws"
                disabled
              >
                <option value="aws">AWS (currently available)</option>
              </select>
              <small>
                Sets a preference only; catalog facts stay authoritative.
              </small>
            </label>
            <label className="field">
              <span>Default Region, when known</span>
              <input
                aria-describedby={
                  regionError === null
                    ? "first-use-region-help"
                    : "first-use-region-help first-use-region-error"
                }
                aria-invalid={regionError !== null}
                autoComplete="off"
                onChange={(event) => {
                  setDefaultRegion(event.currentTarget.value);
                  setRegionError(null);
                }}
                placeholder="For example, us-east-1"
                ref={regionInput}
                value={defaultRegion}
              />
              <small id="first-use-region-help">
                Optional. Blank uses the editor’s clearly labeled local fallback
                Region.
              </small>
              {regionError === null ? null : (
                <small id="first-use-region-error" role="alert">
                  {regionError}
                </small>
              )}
            </label>
          </div>
          <label className="first-use-teaching">
            <input
              checked={contextualTeachingEnabled}
              aria-label="Show the editor tour"
              onChange={(event) => {
                setContextualTeachingEnabled(event.currentTarget.checked);
              }}
              type="checkbox"
            />
            <span>
              <strong>Show the editor tour</strong>
              <small>
                Show step-by-step orientation. Guided mode provides
                recommendations; Learn is always available.
              </small>
            </span>
          </label>
        </Disclosure>

        <fieldset className="first-use-form__group">
          <legend>Project start</legend>
          <div className="first-use-form__choices first-use-form__choices--starts">
            {startChoices.map((choice) => (
              <label className="first-use-choice" key={choice.id}>
                <input
                  checked={startChoice === choice.id}
                  aria-label={choice.label}
                  name="project-start"
                  onChange={() => {
                    setStartChoice(choice.id);
                  }}
                  type="radio"
                  value={choice.id}
                />
                <span>
                  <strong>{choice.label}</strong>
                  <small>{choice.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {preference.storageStatus === "available" ? null : (
          <p className="first-use-card__storage" role="status">
            Local preference storage is unavailable. This session can continue,
            but the choices may not persist.
          </p>
        )}

        <div className="form-actions">
          <Button size="compact" type="submit" variant="primary">
            Start local experience
          </Button>
        </div>
      </form>
    </section>
  );
}
