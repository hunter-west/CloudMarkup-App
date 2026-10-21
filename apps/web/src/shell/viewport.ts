import { useEffect, useState } from "react";

export type ViewportPosture = "desktop" | "tablet" | "phone";

export interface ViewportDimensions {
  readonly height: number;
  readonly posture: ViewportPosture;
  readonly width: number;
}

export function getViewportPosture(width: number): ViewportPosture {
  if (width >= 1280) {
    return "desktop";
  }
  if (width >= 768) {
    return "tablet";
  }
  return "phone";
}

export function useViewportDimensions(): ViewportDimensions {
  const [dimensions, setDimensions] = useState<ViewportDimensions>(() => ({
    height: window.innerHeight,
    posture: getViewportPosture(window.innerWidth),
    width: window.innerWidth,
  }));

  useEffect(() => {
    function updateDimensions() {
      setDimensions({
        height: window.innerHeight,
        posture: getViewportPosture(window.innerWidth),
        width: window.innerWidth,
      });
    }

    window.addEventListener("resize", updateDimensions);
    return () => {
      window.removeEventListener("resize", updateDimensions);
    };
  }, []);

  return dimensions;
}

export function useViewportPosture(): ViewportPosture {
  return useViewportDimensions().posture;
}
