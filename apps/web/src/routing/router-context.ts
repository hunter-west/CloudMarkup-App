import { createContext, useContext } from "react";

import type { AppLocation, Navigate } from "./location.js";
import type { RouteMatch } from "./routes.js";

export interface RouterContextValue {
  readonly location: AppLocation;
  readonly navigate: Navigate;
  readonly route: RouteMatch;
}

export const RouterContext = createContext<RouterContextValue | undefined>(
  undefined,
);

export function useRouterContext(): RouterContextValue {
  const context = useContext(RouterContext);

  if (context === undefined) {
    throw new Error("Routing hooks must be used within a RouterProvider.");
  }

  return context;
}
