export const workspaceTourRestartEvent = "cloudmarkup:restart-workspace-tour";
export function restartWorkspaceTour() {
  window.dispatchEvent(new Event(workspaceTourRestartEvent));
}
