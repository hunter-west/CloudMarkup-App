import type {
  AnchorHTMLAttributes,
  MouseEvent as ReactMouseEvent,
} from "react";

import { useNavigate } from "./hooks.js";
import { resolveAppDestination } from "./location.js";

export interface AppLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> {
  readonly replace?: boolean;
  readonly to: string;
}

export function AppLink({
  children,
  onClick,
  replace = false,
  target,
  to,
  ...anchorProps
}: AppLinkProps) {
  const navigate = useNavigate();
  const href = resolveAppDestination(to).href;

  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);

    if (!shouldNavigateInApp(event)) {
      return;
    }

    event.preventDefault();
    navigate(href, replace ? { replace: true } : undefined);
  };

  return (
    <a {...anchorProps} href={href} onClick={handleClick} target={target}>
      {children}
    </a>
  );
}

function shouldNavigateInApp(
  event: ReactMouseEvent<HTMLAnchorElement>,
): boolean {
  if (event.defaultPrevented || event.button !== 0) {
    return false;
  }

  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }

  if (event.currentTarget.hasAttribute("download")) {
    return false;
  }

  const target = event.currentTarget.getAttribute("target");
  return target === null || target.toLowerCase() === "_self";
}
