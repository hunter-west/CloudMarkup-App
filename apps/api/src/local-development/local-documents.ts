export {
  createDocumentStageInput,
  createInitialArchitectureDocument as createLocalArchitectureDocument,
  getArchitectureDocumentStorage as getLocalDocumentStorage,
  rebindArchitectureDocumentCopy as rebindLocalDraftCopy,
  rebindImmutableArchitectureRevision as rebindLocalImmutableRevision,
  type ArchitectureDocumentIdentity as LocalDocumentIdentity,
  type ArchitectureDocumentStorage as LocalDocumentStorage,
} from "../application/architecture-document-storage.js";
