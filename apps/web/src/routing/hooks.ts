import type { AppLocation, Navigate } from "./location.js";
import { useRouterContext } from "./router-context.js";
import type { RouteMatch } from "./routes.js";

export function useAppLocation(): AppLocation {
  return useRouterContext().location;
}

export function useNavigate(): Navigate {
  return useRouterContext().navigate;
}

export function useRouteMatch(): RouteMatch {
  return useRouterContext().route;
}
