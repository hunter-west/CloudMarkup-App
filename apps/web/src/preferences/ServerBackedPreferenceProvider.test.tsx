import {
  createCloudMarkupClient,
  type ApiTransport,
  type ApiTransportRequest,
  type ApiTransportResponse,
  type PresentationPreferencesV1,
} from "@cloudmarkup/api-contract";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CloudMarkupQueryProvider } from "../api/index.js";
import {
  ExperiencePreferenceProvider,
  ModePreferenceProvider,
  getExperiencePreferenceStorageKey,
  getModePreferenceStorageKey,
  useExperiencePreference,
  useModePreference,
} from "./index.js";

const actorId = "principal_preferences_test";

function response(
  status: number,
  payload: unknown,
  etag?: string,
): ApiTransportResponse {
  return {
    headers: {
      get(name) {
        return name.toLowerCase() === "etag" ? (etag ?? null) : null;
      },
    },
    status,
    text() {
      return Promise.resolve(JSON.stringify(payload));
    },
  };
}

function PreferenceProbe() {
  const experience = useExperiencePreference();
  const mode = useModePreference();

  return (
    <div>
      <output data-testid="mode">{mode.mode}</output>
      <output data-testid="contextual">
        {String(experience.contextualTeachingEnabled)}
      </output>
      <button
        onClick={() => {
          mode.setMode("guided");
        }}
        type="button"
      >
        Guided
      </button>
      <button
        onClick={() => {
          experience.setContextualTeachingEnabled(true);
        }}
        type="button"
      >
        Enable contextual help
      </button>
    </div>
  );
}

function renderPreferences(transport: ApiTransport) {
  const client = createCloudMarkupClient({
    baseUrl: "https://api.test.invalid",
    transport,
  });
  return render(
    <CloudMarkupQueryProvider client={client}>
      <ModePreferenceProvider actorId={actorId}>
        <ExperiencePreferenceProvider actorId={actorId}>
          <PreferenceProbe />
        </ExperiencePreferenceProvider>
      </ModePreferenceProvider>
    </CloudMarkupQueryProvider>,
  );
}

describe("server-backed presentation preference providers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores server values and serializes explicit writes with exact ETags", async () => {
    const requests: ApiTransportRequest[] = [];
    let etag = '"preferences:principal_preferences_test:v1"';
    let preferences: PresentationPreferencesV1 = {
      contextualLearningEnabled: false,
      contractVersion: 1,
      experienceMode: "professional",
      syncVersion: 1,
      updatedAt: "2026-08-15T12:00:00.000Z",
    };
    const transport = vi.fn<ApiTransport>((request) => {
      requests.push(request);
      if (request.method === "PUT") {
        const body = JSON.parse(request.body ?? "null") as {
          readonly contextualLearningEnabled: boolean;
          readonly contractVersion: 1;
          readonly experienceMode: "guided" | "professional";
        };
        preferences = {
          ...preferences,
          ...body,
          syncVersion: preferences.syncVersion + 1,
          updatedAt: "2026-08-15T12:01:00.000Z",
        };
        etag = `"preferences:principal_preferences_test:v${String(
          preferences.syncVersion,
        )}"`;
      }
      return Promise.resolve(
        response(200, { apiVersion: "v1", data: preferences }, etag),
      );
    });

    renderPreferences(transport);

    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("professional");
      expect(screen.getByTestId("contextual")).toHaveTextContent("false");
    });
    expect(
      window.localStorage.getItem(getModePreferenceStorageKey(actorId)),
    ).toBe("professional");
    expect(
      window.localStorage.getItem(getExperiencePreferenceStorageKey(actorId)),
    ).toContain('"contextualTeachingEnabled":false');

    fireEvent.click(screen.getByRole("button", { name: "Guided" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Enable contextual help" }),
    );

    await waitFor(() => {
      expect(
        requests.filter((request) => request.method === "PUT"),
      ).toHaveLength(2);
    });
    const writes = requests.filter((request) => request.method === "PUT");
    expect(writes[0]?.headers["if-match"]).toBe(
      '"preferences:principal_preferences_test:v1"',
    );
    expect(writes[1]?.headers["if-match"]).toBe(
      '"preferences:principal_preferences_test:v2"',
    );
    expect(JSON.parse(writes[0]?.body ?? "null")).toEqual({
      contextualLearningEnabled: false,
      contractVersion: 1,
      experienceMode: "guided",
    });
    expect(JSON.parse(writes[1]?.body ?? "null")).toEqual({
      contextualLearningEnabled: true,
      contractVersion: 1,
      experienceMode: "guided",
    });
  });
});
