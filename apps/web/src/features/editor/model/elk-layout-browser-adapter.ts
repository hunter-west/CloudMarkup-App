import ElkWorker from "elkjs/lib/elk-worker.min.js?worker";

import {
  createWebWorkerElkLayoutEngine,
  ElkLayoutAdapter,
} from "./elk-layout-adapter.js";

export const elkLayoutAdapter = new ElkLayoutAdapter({
  createEngine: () => createWebWorkerElkLayoutEngine(() => new ElkWorker()),
});
