import ELK from "elkjs/lib/elk.bundled.js";

import type { ElkLayoutEngine } from "./elk-layout-adapter.js";

/**
 * In-process engine for deterministic non-browser verification. Production
 * editor code uses the dedicated Web Worker factory instead.
 */
export function createBundledElkLayoutEngine(): ElkLayoutEngine {
  const elk = new ELK();
  return {
    async layout(graph) {
      return elk.layout(graph);
    },
    terminateWorker() {
      elk.terminateWorker();
    },
  };
}
