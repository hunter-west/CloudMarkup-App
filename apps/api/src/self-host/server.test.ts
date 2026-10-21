import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { createConnection, type Socket } from "node:net";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_JSON_REQUEST_BYTES } from "@cloudmarkup/api-contract";
import {
  parseSelfHostConfiguration,
  SELF_HOST_CONFIGURATION_ENVIRONMENT_NAME,
} from "./configuration.js";
import { ORDINARY_PERSISTENCE_PURPOSES } from "./persistence-config.js";
import {
  createSelfHostCredentialResolver,
  createSelfHostRequest,
  readSelfHostConfiguration,
  serveSelfHostWeb,
  startSelfHostServer,
} from "./server.js";
import type { ApiEnvironment } from "../transport/http.js";
import type { SelfHostRuntime } from "./runtime.js";

const directories: string[] = [];
afterEach(async () => {
  for (const root of directories.splice(0)) {
    if (dirname(root) !== resolve(tmpdir()))
      throw Error("Synthetic fixture escaped temporary directory");
    await rm(root, { recursive: true, force: true });
  }
});
async function directory() {
  const root = await mkdtemp(resolve(tmpdir(), "self-host-server-synthetic-"));
  directories.push(root);
  return root;
}
function document(root: string) {
  return {
    schemaVersion: 1,
    server: {
      host: "0.0.0.0",
      port: 3000,
      publicOrigin: "https://app.example.invalid",
      requestDeadlineMilliseconds: 60000,
      maximumInFlightRequests: 8,
    },
    identity: {
      mode: "cognito",
      userPoolId: "us-east-1_SYNTHETIC",
      clientId: "synthetic-client",
      directory: "existing-principals",
      publicRuntime: {
        schemaVersion: 1,
        authentication: {
          provider: "cognito",
          clientId: "synthetic-client",
          domain: "https://identity.example.invalid",
          callbackUrl: "https://app.example.invalid/auth/callback",
          logoutUrl: "https://app.example.invalid/",
          scopes: ["openid", "profile", "cloudmarkup-api/access"],
        },
      },
      accountAccess: {
        schemaVersion: 1,
        managedLogin: true,
        registrationEnabled: false,
      },
      accountSecurity: { schemaVersion: 1, recoveryContact: null },
    },
    persistence: {
      objectRoot: resolve(root, "objects"),
      expectedSchemaVersion: "0138",
      readinessTimeoutMillis: 1000,
      shutdownTimeoutMillis: 30000,
      databases: Object.fromEntries(
        ORDINARY_PERSISTENCE_PURPOSES.map(
          (purpose) =>
            [
              purpose,
              {
                host: "postgres",
                port: 5432,
                database: "cloudmarkup",
                user: `cloudmarkup_beta_${purpose}_runtime`,
                passwordReference: `operator.database.${purpose}`,
                tls: "disable",
                maxConnections: 2,
                connectionTimeoutMillis: 1000,
                idleTimeoutMillis: 1000,
                statementTimeoutMillis: 30000,
              },
            ] as const,
        ),
      ),
    },
    models: null,
    adapters: {
      proposalJobs: null,
      solutionExports: null,
      projectCleanup: null,
      billing: null,
      commercial: null,
      github: null,
      gitlab: null,
      continuousConformance: null,
    },
    credentialSources: Object.fromEntries<Record<string, unknown>>(
      ORDINARY_PERSISTENCE_PURPOSES.map(
        (purpose) =>
          [
            `operator.database.${purpose}`,
            {
              kind: "environment",
              name: `SYNTHETIC_PG_${purpose.toUpperCase()}`,
            },
          ] as const,
      ),
    ),
  };
}
function incoming(target: string, bytes = Buffer.alloc(0), method = "GET") {
  const stream = Readable.from(
    bytes.length === 0 ? [] : [bytes],
  ) as unknown as IncomingMessage;
  stream.method = method;
  stream.url = target;
  stream.headers = {
    host: "forged.example.invalid",
    "x-forwarded-host": "forged.example.invalid",
    "x-forwarded-proto": "http",
    authorization: "Bearer synthetic.jwt.token",
  };
  return stream;
}

describe("private startup and the shared HTTP/browser bridge", () => {
  it("routes browser same-origin API paths with their actual proof headers and body, preserving queries", async () => {
    const message = incoming(
      "/api/v1/projects?cursor=synthetic",
      Buffer.from('{"name":"synthetic"}'),
      "POST",
    );
    message.headers.origin = "http://127.0.0.1:4317";
    message.headers["sec-fetch-site"] = "same-origin";
    message.headers["x-cloudmarkup-session"] = "1";
    message.headers["content-type"] = "application/json";
    const request = await createSelfHostRequest(
      message,
      "http://127.0.0.1:4317",
      new AbortController().signal,
    );
    expect(request.url).toBe(
      "http://127.0.0.1:4317/v1/projects?cursor=synthetic",
    );
    expect(request.headers.get("origin")).toBe("http://127.0.0.1:4317");
    expect(request.headers.get("sec-fetch-site")).toBe("same-origin");
    expect(await request.json()).toEqual({ name: "synthetic" });
    expect(
      (
        await createSelfHostRequest(
          incoming("/api/runtime-config"),
          "http://127.0.0.1:4317",
          new AbortController().signal,
        )
      ).url,
    ).toBe("http://127.0.0.1:4317/runtime-config");
  });
  it("reads only the explicit private startup file and redacts malformed contents", async () => {
    const root = await directory();
    const file = resolve(root, "startup.json");
    await writeFile(file, JSON.stringify(document(root)), { mode: 0o600 });
    expect(
      (
        await readSelfHostConfiguration({
          [SELF_HOST_CONFIGURATION_ENVIRONMENT_NAME]: file,
        })
      ).server.port,
    ).toBe(3000);
    await expect(readSelfHostConfiguration({})).rejects.toThrow(
      "configuration is unavailable",
    );
    await writeFile(file, '{"synthetic-secret":');
    await expect(
      readSelfHostConfiguration({
        [SELF_HOST_CONFIGURATION_ENVIRONMENT_NAME]: file,
      }),
    ).rejects.toThrow("configuration is unavailable");
  });
  it("resolves only whitelisted server references and rejects aborted/missing values", async () => {
    const root = await directory();
    const config = parseSelfHostConfiguration(document(root));
    const resolver = createSelfHostCredentialResolver(config, {
      SYNTHETIC_PG_API: "synthetic-only-password",
    });
    const signal = new AbortController().signal;
    expect(await resolver("operator.database.api", signal)).toBe(
      "synthetic-only-password",
    );
    await expect(resolver("operator.unknown", signal)).rejects.toThrow(
      "configuration is unavailable",
    );
    await expect(
      resolver("operator.database.billing", signal),
    ).rejects.toThrow();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      resolver("operator.database.api", aborted.signal),
    ).rejects.toThrow();
  });
  it("keeps internal origin fixed and does not trust Host/forwarded or body tenant fields", async () => {
    const signal = new AbortController().signal;
    const request = await createSelfHostRequest(
      incoming(
        "/v1/projects?view=one",
        Buffer.from('{"organizationId":"forged"}'),
        "POST",
      ),
      "https://app.example.invalid",
      signal,
    );
    expect(request.url).toBe(
      "https://app.example.invalid/v1/projects?view=one",
    );
    expect(request.headers.has("host")).toBe(false);
    expect(request.headers.has("x-forwarded-host")).toBe(false);
    expect(request.headers.get("authorization")).toBe(
      "Bearer synthetic.jwt.token",
    );
    expect(await request.json()).toEqual({ organizationId: "forged" });
    // The shared application resolves authority; the bridge does not promote it.
  });
  it.each([
    "https://forged.example.invalid/",
    "//forged.example.invalid/",
    "/\\private",
  ])("refuses non-origin-form target %s", async (target) => {
    await expect(
      createSelfHostRequest(
        incoming(target),
        "https://app.example.invalid",
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
  it("bounds JSON bodies before invoking the API and refuses caller cancellation", async () => {
    await expect(
      createSelfHostRequest(
        incoming(
          "/v1/projects",
          Buffer.alloc(MAX_JSON_REQUEST_BYTES + 1),
          "POST",
        ),
        "https://app.example.invalid",
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createSelfHostRequest(
        incoming("/v1/me"),
        "https://app.example.invalid",
        controller.signal,
      ),
    ).rejects.toThrow();
  });
  it("serves the packaged browser with the existing edge CSP and retains API routing", async () => {
    const root = await directory();
    const config = parseSelfHostConfiguration(document(root));
    await writeFile(
      resolve(root, "index.html"),
      '<!doctype html><script src="/assets/synthetic.js"></script>',
    );
    await mkdir(resolve(root, "assets"));
    await writeFile(
      resolve(root, "assets/synthetic.js"),
      "export const synthetic = true;",
    );
    const index = await serveSelfHostWeb(
      new Request("https://app.example.invalid/projects/one", {
        headers: { accept: "text/html" },
      }),
      config,
      root,
    );
    expect(await index?.text()).toContain("synthetic.js");
    expect(index?.headers.get("content-security-policy")).toContain(
      "connect-src 'self' https://identity.example.invalid",
    );
    expect(index?.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    const asset = await serveSelfHostWeb(
      new Request("https://app.example.invalid/assets/synthetic.js"),
      config,
      root,
    );
    expect(asset?.headers.get("content-type")).toBe(
      "text/javascript; charset=UTF-8",
    );
    expect(await asset?.text()).toContain("synthetic = true");
    expect(
      await serveSelfHostWeb(
        new Request("https://app.example.invalid/v1/projects"),
        config,
        root,
      ),
    ).toBeNull();
    const local = parseSelfHostConfiguration({
      ...document(root),
      server: {
        ...document(root).server,
        host: "127.0.0.1",
        publicOrigin: "http://127.0.0.1:4317",
      },
      identity: {
        mode: "local-owner",
        ownerPrincipalId: "principal_local_owner",
        operatorSecretReference: "operator.owner",
      },
      credentialSources: {
        ...document(root).credentialSources,
        "operator.owner": { kind: "environment", name: "SYNTHETIC_OWNER" },
      },
    });
    const localIndex = await serveSelfHostWeb(
      new Request("http://127.0.0.1:4317/", {
        headers: { accept: "text/html" },
      }),
      local,
      root,
    );
    expect(localIndex?.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect(localIndex?.headers.get("content-security-policy")).not.toContain(
      "amazoncognito",
    );
    expect(localIndex?.headers.get("content-security-policy")).not.toContain(
      "upgrade-insecure-requests",
    );
    await localIndex?.body?.cancel();
    for (const path of [
      "/api/v1/projects",
      "/api/runtime-config",
      "/auth/local-owner/v1/exchange",
      "/auth/session/v1/exchange",
    ]) {
      expect(
        await serveSelfHostWeb(
          new Request("http://127.0.0.1:4317" + path, {
            headers: { accept: "text/html" },
          }),
          local,
          root,
        ),
      ).toBeNull();
    }
    expect(
      await serveSelfHostWeb(
        new Request("https://app.example.invalid/runtime-config"),
        config,
        root,
      ),
    ).toBeNull();
  });
  it("drains a delayed binary response after client EOF while refusing a truncated request", async () => {
    const root = await directory();
    await writeFile(resolve(root, "index.html"), "<!doctype html>");
    const parsed = parseSelfHostConfiguration(document(root));
    const config: typeof parsed = {
      ...parsed,
      server: { ...parsed.server, host: "127.0.0.1", port: 0 },
    };
    const payload = Uint8Array.of(0, 255, 1, 208, 169, 42);
    const app = new Hono<ApiEnvironment>();
    app.get("/api/eof", async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return new Response(payload, {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(payload.length),
        },
      });
    });
    let closes = 0;
    const runtime: SelfHostRuntime = {
      app,
      configuration: config,
      adapterLedger: () => [],
      checkReadiness: () => Promise.resolve([]),
      stopAdmissions: () => undefined,
      close: () => {
        closes++;
        return Promise.resolve({
          state: "incomplete",
          resourcesDisposed: false,
        });
      },
    };
    const running = await startSelfHostServer(
      config,
      {
        resolveCredential: () =>
          Promise.reject(Error("Unused unit credential port")),
      },
      () => Promise.resolve(runtime),
      root,
    );
    const clients = new Set<Socket>();
    const address = running.server.address();
    if (address === null || typeof address === "string")
      throw Error("No test listener");
    const exchange = (request: string) =>
      new Promise<Buffer>((accept, reject) => {
        const socket = createConnection({
          host: "127.0.0.1",
          port: address.port,
          allowHalfOpen: true,
        });
        clients.add(socket);
        const chunks: Buffer[] = [];
        const timer = setTimeout(
          () => socket.destroy(Error("Unit response deadline")),
          2000,
        );
        socket.on("data", (bytes: Buffer) => chunks.push(bytes));
        socket.once("error", reject);
        socket.once("connect", () => socket.end(request));
        socket.once("close", () => {
          clearTimeout(timer);
          clients.delete(socket);
          accept(Buffer.concat(chunks));
        });
      });
    try {
      const received = await exchange(
        "GET /api/eof HTTP/1.1\r\nHost: app.example.invalid\r\nConnection: close\r\n\r\n",
      );
      expect(received.toString("ascii").startsWith("HTTP/1.1 200 ")).toBe(true);
      const headersEnd = received.indexOf("\r\n\r\n");
      expect(headersEnd).toBeGreaterThan(0);
      expect(received.subarray(headersEnd + 4)).toEqual(Buffer.from(payload));
      const malformed = await exchange(
        "POST /api/eof HTTP/1.1\r\nHost: app.example.invalid\r\nContent-Length: 20\r\nConnection: close\r\n\r\n{}",
      );
      expect(malformed.toString("ascii").startsWith("HTTP/1.1 400 ")).toBe(
        true,
      );
    } finally {
      for (const client of clients) client.destroy();
      expect((await running.stop()).resourcesDisposed).toBe(false);
    }
    expect(closes).toBe(1);
    expect(running.server.listening).toBe(false);
  });
  it("rejects hidden/encoded private paths and missing built browser assets", async () => {
    const root = await directory();
    const config = parseSelfHostConfiguration(document(root));
    await expect(
      serveSelfHostWeb(
        new Request("https://app.example.invalid/"),
        config,
        root,
      ),
    ).rejects.toThrow();
    await writeFile(resolve(root, ".private"), "synthetic-only");
    await expect(
      serveSelfHostWeb(
        new Request("https://app.example.invalid/%2eprivate"),
        config,
        root,
      ),
    ).rejects.toThrow();
  });
  it.runIf(process.platform !== "win32")(
    "refuses symlinked private files and browser assets",
    async () => {
      const root = await directory();
      const config = parseSelfHostConfiguration(document(root));
      const file = resolve(root, "private.json");
      await writeFile(file, JSON.stringify(document(root)), { mode: 0o600 });
      const link = resolve(root, "startup.json");
      await symlink(file, link);
      await expect(
        readSelfHostConfiguration({
          [SELF_HOST_CONFIGURATION_ENVIRONMENT_NAME]: link,
        }),
      ).rejects.toThrow();
      await symlink(file, resolve(root, "index.html"));
      await expect(
        serveSelfHostWeb(
          new Request("https://app.example.invalid/"),
          config,
          root,
        ),
      ).rejects.toThrow();
    },
  );
});
