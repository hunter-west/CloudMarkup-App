import { useEffect, useState } from "react";
import {
  runtimeAiCapabilitiesV1Schema,
  type RuntimeAiCapabilitiesV1,
} from "@cloudmarkup/api-contract";
import { useOptionalCloudMarkupQueryRuntime } from "./cloudmarkup-query-context.js";
export function useAiCapabilities() {
  const loader = useOptionalCloudMarkupQueryRuntime()?.loadAiCapabilities;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    loader: typeof loader;
    attempt: number;
    data?: RuntimeAiCapabilitiesV1;
    error?: true;
  } | null>(null);
  useEffect(() => {
    if (!loader) return;
    const controller = new AbortController();
    void loader(controller.signal)
      .then((raw) => {
        const data = runtimeAiCapabilitiesV1Schema.parse(raw);
        if (!controller.signal.aborted) setResult({ loader, attempt, data });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({ loader, attempt, error: true });
      });
    return () => {
      controller.abort();
    };
  }, [loader, attempt]);
  const current =
    result !== null && result.loader === loader && result.attempt === attempt
      ? result
      : null;
  const data = current?.data;
  return {
    checked: data !== undefined && attempt > 0,
    proposalAvailable: data?.proposalVersions[0] === 6,
    sourceAvailable: data?.applicationSources[0] === "ai-source-draft-v3",
    state: !loader
      ? ("unavailable" as const)
      : current === null
        ? ("loading" as const)
        : current.error
          ? ("error" as const)
          : ("ready" as const),
    retry: () => {
      setAttempt((value) => value + 1);
    },
  };
}
