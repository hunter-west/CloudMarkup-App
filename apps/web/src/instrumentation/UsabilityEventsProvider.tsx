import { useCallback, useMemo, type ReactNode } from "react";

import {
  NOOP_USABILITY_EVENTS_ADAPTER,
  UsabilityEventsContext,
  sanitizeUsabilityEvent,
  type UsabilityEvent,
  type UsabilityEventsAdapter,
} from "./usability-events.js";

export interface UsabilityEventsProviderProps {
  readonly adapter?: UsabilityEventsAdapter;
  readonly children: ReactNode;
}

export function UsabilityEventsProvider({
  adapter = NOOP_USABILITY_EVENTS_ADAPTER,
  children,
}: UsabilityEventsProviderProps) {
  const record = useCallback(
    (event: UsabilityEvent) => {
      try {
        const sanitizedEvent = sanitizeUsabilityEvent(event);
        if (sanitizedEvent !== null) {
          adapter.record(sanitizedEvent);
        }
      } catch {
        // Optional instrumentation must never interrupt the product workflow.
      }
    },
    [adapter],
  );
  const value = useMemo<UsabilityEventsAdapter>(() => ({ record }), [record]);

  return (
    <UsabilityEventsContext.Provider value={value}>
      {children}
    </UsabilityEventsContext.Provider>
  );
}
