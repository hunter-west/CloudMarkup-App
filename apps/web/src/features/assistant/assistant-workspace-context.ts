import { createContext, useContext } from "react";

import type { AssistantWorkspaceHostInputV1 } from "./AssistantWorkspace.js";

export const AssistantWorkspaceContext =
  createContext<AssistantWorkspaceHostInputV1 | null>(null);

export function useAssistantWorkspaceHost(): AssistantWorkspaceHostInputV1 | null {
  return useContext(AssistantWorkspaceContext);
}
