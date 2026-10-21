import { normalizePathname } from "./routes.js";

export interface AppLocation {
  readonly hash: string;
  readonly pathname: string;
  readonly search: string;
}

export interface NavigateOptions {
  readonly replace?: boolean;
}

export type Navigate = (destination: string, options?: NavigateOptions) => void;

export function encodeRouteSelector(selector: string): string {
  return encodeURIComponent(selector);
}

interface ResolvedAppDestination {
  readonly href: string;
  readonly location: AppLocation;
}

export function readAppLocation(): AppLocation {
  return Object.freeze({
    hash: window.location.hash,
    pathname: normalizePathname(window.location.pathname),
    search: window.location.search,
  });
}

export function resolveAppDestination(
  destination: string,
): ResolvedAppDestination {
  if (!isPathDestination(destination)) {
    throw new Error(
      "Application navigation requires a same-origin path, query, or fragment.",
    );
  }

  const url = new URL(destination, window.location.href);

  if (url.origin !== window.location.origin) {
    throw new Error("Application navigation cannot leave the current origin.");
  }

  const location = Object.freeze({
    hash: url.hash,
    pathname: normalizePathname(url.pathname),
    search: url.search,
  });

  return Object.freeze({
    href: `${location.pathname}${location.search}${location.hash}`,
    location,
  });
}

function isPathDestination(destination: string): boolean {
  return (
    destination.startsWith("/") ||
    destination.startsWith("?") ||
    destination.startsWith("#")
  );
}
