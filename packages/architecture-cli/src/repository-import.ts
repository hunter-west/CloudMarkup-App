import type {
  RepositoryImportResultV1,
  RepositoryImportService,
  RepositoryImportRequestV1,
} from "@cloudmarkup/repository-importer";

import {
  repositorySourceInputs,
  type LoadedArchitectureRepository,
} from "./repository.js";

export interface ArchitectureCliRepositoryImportPortV1 {
  run(
    input: Readonly<{
      root: string;
      repository: LoadedArchitectureRepository;
      signal: AbortSignal;
    }>,
  ): Promise<RepositoryImportResultV1>;
}

export function createArchitectureCliRepositoryImportPort(
  input: Readonly<{
    importer: RepositoryImportService;
    request(
      input: Readonly<{
        root: string;
        repository: LoadedArchitectureRepository;
      }>,
    ): RepositoryImportRequestV1 | Promise<RepositoryImportRequestV1>;
  }>,
): ArchitectureCliRepositoryImportPortV1 {
  return Object.freeze({
    async run(
      runInput: Readonly<{
        root: string;
        repository: LoadedArchitectureRepository;
        signal: AbortSignal;
      }>,
    ) {
      if (runInput.signal.aborted) {
        throw new DOMException("Repository import cancelled.", "AbortError");
      }
      const source = repositorySourceInputs(runInput.repository);
      const request = await input.request({
        root: runInput.root,
        repository: runInput.repository,
      });
      if (
        request.solutionRevision.solutionRevisionId !==
          source.solutionRevision.solutionRevisionId ||
        request.approvedArchitecture.architectureId !==
          source.documents.architectureDocument.architectureId
      ) {
        throw new Error(
          "Repository import request does not bind the locked immutable source.",
        );
      }
      return input.importer.importRepository({
        sourceDirectory: runInput.root,
        request,
      });
    },
  });
}
