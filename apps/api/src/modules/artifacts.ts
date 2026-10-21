import {
  artifactListQueryV1Schema,
  artifactListResponseV1Schema,
  artifactPathV1Schema,
  artifactResponseV1Schema,
  downloadListQueryV1Schema,
  downloadableArtifactListResponseV1Schema,
  projectPathV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { CloudMarkupApplication } from "../application/ports.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  listEnvelope,
  pageOptions,
  parsePath,
  parseQuery,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerArtifactRoutes(
  app: Hono<ApiEnvironment>,
  application: CloudMarkupApplication,
): void {
  app.get("/v1/projects/:projectId/artifacts", async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const query = parseQuery(context, artifactListQueryV1Schema);
    const result = await application.listArtifacts(
      context.get("principal"),
      path.projectId,
      pageOptions(query),
    );
    return validatedJsonResponse(
      artifactListResponseV1Schema,
      listEnvelope(result.items, result.nextCursor),
      200,
    );
  });

  app.get("/v1/projects/:projectId/artifacts/:artifactId", async (context) => {
    const path = parsePath(context, artifactPathV1Schema);
    const artifact = await application.getArtifact(
      context.get("principal"),
      path.projectId,
      path.artifactId,
    );
    return validatedJsonResponse(
      artifactResponseV1Schema,
      dataEnvelope(artifact),
      200,
    );
  });

  app.get(
    "/v1/projects/:projectId/artifacts/:artifactId/downloads",
    async (context) => {
      const path = parsePath(context, artifactPathV1Schema);
      const query = parseQuery(context, downloadListQueryV1Schema);
      const result = await application.listDownloads(
        context.get("principal"),
        path.projectId,
        path.artifactId,
        pageOptions(query),
      );
      return validatedJsonResponse(
        downloadableArtifactListResponseV1Schema,
        listEnvelope(result.items, result.nextCursor),
        200,
      );
    },
  );
}
