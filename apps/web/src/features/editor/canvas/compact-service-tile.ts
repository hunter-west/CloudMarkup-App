/** Screen-space detail only. Does not change graph coordinates or resource identity. */
export function compactServiceTile(zoom: number) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const compact = safeZoom < 0.7;
  const iconOnly = safeZoom < 0.35;
  return {
    compact,
    iconOnly,
    scale: 1 / safeZoom,
    width: (iconOnly ? 44 : Math.max(136, 176 * safeZoom)) / safeZoom,
    height: (iconOnly ? 44 : 76) / safeZoom,
  };
}

/** Boundary tiles keep a constant screen-space size at overview zoom. */
export function boundaryOverviewTile(zoom: number) {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const iconOnly = safeZoom < 0.25;
  return {
    iconOnly,
    scale: 1 / safeZoom,
    width: (iconOnly ? 56 : 176) / safeZoom,
    height: (iconOnly ? 56 : 72) / safeZoom,
  };
}

/** Presentation-only overview thresholds preserve the nested design at useful zooms. */
export function boundaryOverviewAtZoom(
  level: "outer" | "primary" | "secondary" | "tertiary" | null | undefined,
  zoom: number,
): boolean {
  if (!Number.isFinite(zoom) || zoom <= 0) return false;
  switch (level) {
    case "tertiary":
      return zoom < 0.4;
    case "secondary":
      return zoom < 0.38;
    case "primary":
      return zoom < 0.34;
    case "outer":
      return zoom < 0.26;
    default:
      return zoom < 0.3;
  }
}
