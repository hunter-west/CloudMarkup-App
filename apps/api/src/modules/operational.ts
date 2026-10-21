import {
  generateOpenApiDocumentV1,
  healthResponseV1Schema,
  readinessResponseV1Schema,
} from "@cloudmarkup/api-contract";
import type { Hono } from "hono";

import type { ReadinessProbe } from "../application/ports.js";
import {
  type ApiEnvironment,
  validatedJsonResponse,
} from "../transport/http.js";

export function registerOperationalRoutes(
  app: Hono<ApiEnvironment>,
  readiness: ReadinessProbe,
): void {
  app.get("/health", () =>
    validatedJsonResponse(
      healthResponseV1Schema,
      {
        contractVersion: 1,
        service: "cloudmarkup-api",
        status: "ok",
      },
      200,
    ),
  );

  app.get("/ready", async () => {
    const results = await readiness.check();
    const ready = results.every((result) => result.ready);
    const checks = results.map((result) => ({
      name: result.name,
      status: result.ready ? "ready" : "not-ready",
    }));
    return validatedJsonResponse(
      readinessResponseV1Schema,
      {
        checks,
        contractVersion: 1,
        service: "cloudmarkup-api",
        status: ready ? "ready" : "not-ready",
      },
      ready ? 200 : 503,
    );
  });

  app.get(
    "/openapi/v1.json",
    () =>
      new Response(JSON.stringify(generateOpenApiDocumentV1()), {
        headers: { "content-type": "application/json; charset=UTF-8" },
        status: 200,
      }),
  );
}
