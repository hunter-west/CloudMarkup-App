import {
  acquireProjectEditingLeaseV1Schema,
  mutateProjectEditingLeaseV1Schema,
  projectEditingLeaseResponseV1Schema,
  projectPathV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import { ApplicationError } from "../application/errors.js";
import type { ProjectEditingLeasePort } from "../application/project-editing-leases.js";
import {
  type ApiEnvironment,
  dataEnvelope,
  parseJsonBody,
  parsePath,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerProjectEditingLeaseRoutes(
  app: Hono<ApiEnvironment>,
  port?: ProjectEditingLeasePort,
): void {
  function application(): ProjectEditingLeasePort {
    if (port === undefined)
      throw new ApplicationError(
        "service_unavailable",
        "Shared-project editing is not configured.",
      );
    return port;
  }
  const pathPattern = "/v1/projects/:projectId/editing-lease";
  app.get(pathPattern, async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const value = await application().get(
      context.get("principal"),
      path.projectId,
    );
    return validatedJsonResponse(
      projectEditingLeaseResponseV1Schema,
      dataEnvelope(value),
      200,
    );
  });
  app.post(pathPattern, async (context) => {
    const path = parsePath(context, projectPathV1Schema);
    const input = await parseJsonBody(
      context,
      acquireProjectEditingLeaseV1Schema,
    );
    const value = await application().acquire(
      context.get("principal"),
      path.projectId,
      { token: input.token },
    );
    return validatedJsonResponse(
      projectEditingLeaseResponseV1Schema,
      dataEnvelope(value),
      200,
    );
  });
  for (const method of ["renew", "release"] as const) {
    app.on(
      method === "renew" ? "PUT" : "DELETE",
      pathPattern,
      async (context) => {
        const path = parsePath(context, projectPathV1Schema);
        const input = await parseJsonBody(
          context,
          mutateProjectEditingLeaseV1Schema,
        );
        const value = await application()[method](
          context.get("principal"),
          path.projectId,
          { leaseId: input.leaseId, token: input.token },
        );
        return validatedJsonResponse(
          projectEditingLeaseResponseV1Schema,
          dataEnvelope(value),
          200,
        );
      },
    );
  }
}
