import { useTourAnchor } from "./use-tour-anchor.js";
import { useEffect, useState, useRef } from "react";
import { BookOpen, X } from "lucide-react";
import { useRouteMatch } from "../../routing/index.js";
import { workspaceTourRestartEvent } from "./workspace-tour-events.js";
import "./workspace-tour.css";

const steps = [
  {
    key: "workspace",
    title: "Project work",
    description:
      "Dashboard is your starting point. Open recent projects, create with AI, or explore templates.",
  },
  {
    key: "organization",
    title: "Your selected workspace",
    description:
      "The Personal workspace or Organization section shows the selected workspace's name. Review its usage, plans and billing, and the settings your role permits.",
  },
  {
    key: "account",
    title: "Personal account",
    description:
      "Manage your profile, personal security and preferences here. Personal & organizations opens the directory for switching between your personal workspace and organizations.",
  },
  {
    key: "profile",
    title: "Quick preferences and notifications",
    description:
      "Use your profile menu for appearance and notifications. You can restart this tour from Dashboard.",
  },
] as const;
export function WorkspaceTour({
  actorId,
  onRevealNavigation,
  autoRevealNavigation = true,
}: {
  readonly actorId: string;
  readonly autoRevealNavigation?: boolean;
  readonly onRevealNavigation: () => void;
}) {
  const route = useRouteMatch();
  const storageKey = "cloudmarkup.workspace-tour.v1." + actorId;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) !== "complete";
    } catch {
      return true;
    }
  });
  const [step, setStep] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      const savedIndex = steps.findIndex(
        (candidate) => saved === `step:${candidate.key}`,
      );
      return savedIndex < 0 ? 0 : savedIndex;
    } catch {
      return 0;
    }
  });
  const current = steps[step] ?? steps[0];
  const visible =
    open && ["dashboard", "projects", "organizations"].includes(route.id);
  const selector =
    current.key === "profile"
      ? "#profile-menu-trigger"
      : '[data-navigation-group="' +
        current.key.charAt(0).toUpperCase() +
        current.key.slice(1) +
        '"]';
  const {
    ref: tourRef,
    style: tourStyle,
    side: tourSide,
  } = useTourAnchor(selector, visible);
  const revealedStep = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      revealedStep.current = null;
      return;
    }
    if (
      autoRevealNavigation &&
      current.key !== "profile" &&
      revealedStep.current !== current.key
    ) {
      revealedStep.current = current.key;
      onRevealNavigation();
    }
  }, [visible, current.key, onRevealNavigation, autoRevealNavigation]);
  useEffect(() => {
    const restart = () => {
      setStep(0);
      setOpen(true);
      try {
        localStorage.setItem(storageKey, `step:${steps[0].key}`);
      } catch {
        /* The restarted tour remains available in this session. */
      }
    };
    window.addEventListener(workspaceTourRestartEvent, restart);
    return () => {
      window.removeEventListener(workspaceTourRestartEvent, restart);
    };
  }, [storageKey]);
  function moveToStep(nextStep: number) {
    setStep(nextStep);
    try {
      localStorage.setItem(
        storageKey,
        `step:${steps[nextStep]?.key ?? steps[0].key}`,
      );
    } catch {
      /* Progress remains available in this session. */
    }
  }
  function close() {
    setOpen(false);
    try {
      localStorage.setItem(storageKey, "complete");
    } catch {
      /* The tour remains dismissed in this session. */
    }
  }
  if (!visible) return null;
  return (
    <aside
      ref={tourRef}
      style={tourStyle}
      data-anchor-side={tourSide}
      className="workspace-tour"
      aria-label="Workspace tour"
      data-step={current.key}
    >
      <header>
        <BookOpen aria-hidden="true" size={18} />
        <span>
          Getting started · {step + 1} of {steps.length}
        </span>
        <button aria-label="Dismiss workspace tour" onClick={close}>
          <X aria-hidden="true" size={16} />
        </button>
      </header>
      <h2>{current.title}</h2>
      <p>{current.description}</p>
      <footer>
        {current.key === "profile" ? null : (
          <button className="button button--quiet" onClick={onRevealNavigation}>
            Show navigation
          </button>
        )}
        <span />
        {step > 0 ? (
          <button
            className="button button--secondary"
            onClick={() => {
              moveToStep(step - 1);
            }}
          >
            Back
          </button>
        ) : null}
        <button
          className="button button--primary"
          onClick={() => {
            if (step === steps.length - 1) close();
            else moveToStep(step + 1);
          }}
        >
          {step === steps.length - 1 ? "Done" : "Next"}
        </button>
      </footer>
    </aside>
  );
}
