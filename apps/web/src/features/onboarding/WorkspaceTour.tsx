import { useTourAnchor } from "./use-tour-anchor.js";
import { useEffect, useState, useRef } from "react";
import { BookOpen, X } from "lucide-react";
import { useRouteMatch } from "../../routing/index.js";
import { workspaceTourRestartEvent } from "./workspace-tour-events.js";
import "./workspace-tour.css";

const steps = [
  {
    key: "workspace",
    title: "Your workspace",
    description:
      "Dashboard is your starting point. Open recent projects, create with AI, or explore templates.",
  },
  {
    key: "account",
    title: "Your account",
    description:
      "Manage your profile, appearance preferences and personal security here.",
  },
  {
    key: "organization",
    title: "Your team and its resources",
    description:
      "Switch organizations, review shared usage and billing, and manage organization settings.",
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
  const [step, setStep] = useState(0);
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
    };
    window.addEventListener(workspaceTourRestartEvent, restart);
    return () => {
      window.removeEventListener(workspaceTourRestartEvent, restart);
    };
  }, []);
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
              setStep(step - 1);
            }}
          >
            Back
          </button>
        ) : null}
        <button
          className="button button--primary"
          onClick={() => {
            if (step === steps.length - 1) close();
            else setStep(step + 1);
          }}
        >
          {step === steps.length - 1 ? "Done" : "Next"}
        </button>
      </footer>
    </aside>
  );
}
