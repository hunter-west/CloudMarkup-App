import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  readAppLocation,
  resolveAppDestination,
  type Navigate,
} from "./location.js";
import { RouterContext, type RouterContextValue } from "./router-context.js";
import { matchRoute } from "./routes.js";

export interface RouterProviderProps {
  readonly children: ReactNode;
}

export function RouterProvider({ children }: RouterProviderProps) {
  const [location, setLocation] = useState(readAppLocation);

  useEffect(() => {
    const handlePopState = () => {
      setLocation(readAppLocation());
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const navigate = useCallback<Navigate>((destination, options) => {
    const next = resolveAppDestination(destination);
    if (options?.replace === true) {
      window.history.replaceState(null, "", next.href);
    } else {
      window.history.pushState(null, "", next.href);
    }
    setLocation(next.location);
  }, []);

  const route = useMemo(
    () => matchRoute(location.pathname),
    [location.pathname],
  );
  const value = useMemo<RouterContextValue>(
    () => ({ location, navigate, route }),
    [location, navigate, route],
  );

  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  );
}
