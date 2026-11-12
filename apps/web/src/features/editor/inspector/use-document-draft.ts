import { hashCanonicalValue } from "@cloudmarkup/domain";
import { useState } from "react";

/** Keep local edits tied to the saved snapshot they were based on. */
export function useDocumentDraft<TValue>(current: TValue, snapshotKey: string) {
  const [edited, setEdited] = useState<{
    readonly snapshotKey: string;
    readonly value: TValue;
  } | null>(null);

  return {
    value: edited?.value ?? current,
    conflicted: edited !== null && edited.snapshotKey !== snapshotKey,
    update: (update: (value: TValue) => TValue) => {
      setEdited((previous) => {
        const value = update(previous?.value ?? current);
        return hashCanonicalValue(value) === hashCanonicalValue(current)
          ? null
          : { snapshotKey: previous?.snapshotKey ?? snapshotKey, value };
      });
    },
    reset: () => {
      setEdited(null);
    },
    keep: () => {
      setEdited((previous) =>
        previous === null ? null : { ...previous, snapshotKey },
      );
    },
  };
}
