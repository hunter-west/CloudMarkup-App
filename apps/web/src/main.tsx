import { applyDocumentTheme } from "./preferences/theme-preference.js";
import { ThemePreferenceSync } from "./preferences/ThemeSwitch.js";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import {
  CloudMarkupQueryProvider,
  createExportCapabilitiesLoader,
  createAiCapabilitiesLoader,
  createConfiguredAuthenticatedBinaryDownloader,
  createConfiguredBrowserCloudMarkupClient,
  createAuthenticatedBinaryDownloader,
  createBrowserCloudMarkupClient,
} from "./api/index.js";
// Keep the reviewed cascade stable while editor JavaScript loads lazily.
// Scoped canvas selectors override XYFlow defaults in both appearance themes.
import "./features/editor/validation/validation.css";
import "./features/editor/editor-canvas.css";
import "@xyflow/react/dist/style.css";
import "@cloudmarkup/ui/styles.css";
import "./styles.css";
import "./features/auth/entry-pages.css";
import { getValidCognitoAccessToken } from "./features/auth/cognito-browser-auth.js";
import {
  LocalOwnerBrowserSession,
  selectLocalOwnerAuthentication,
} from "./features/auth/local-owner-browser-auth.js";

const rootElement = document.querySelector("#root");

if (rootElement === null) {
  throw new Error("The web root element was not found.");
}

const root = createRoot(rootElement);
function authenticationSetting(value: unknown): string | undefined {
  if (value !== undefined && typeof value !== "string")
    throw new TypeError("Invalid browser authentication setting.");
  return value;
}

const authenticationMode: unknown = import.meta.env.VITE_CLOUDMARKUP_AUTH_MODE;
const localOwnerMode =
  authenticationMode === undefined
    ? false
    : selectLocalOwnerAuthentication(
        authenticationSetting(authenticationMode),
        window.location.origin,
        authenticationSetting(import.meta.env["VITE_CLOUDMARKUP_API_BASE_URL"]),
        authenticationSetting(
          import.meta.env["VITE_CLOUDMARKUP_LOCAL_IDENTITY_TOKEN"],
        ),
      );
const localOwnerSession = localOwnerMode
  ? new LocalOwnerBrowserSession(
      window.fetch.bind(window),
      window.location.origin,
    )
  : undefined;
const localOwnerToken = () => localOwnerSession?.getValidAccessToken();
const cloudMarkupClient =
  localOwnerSession === undefined
    ? createConfiguredBrowserCloudMarkupClient(getValidCognitoAccessToken)
    : createBrowserCloudMarkupClient({
        accessToken: localOwnerToken,
        apiBaseUrl: "/api",
        development: false,
        fetchImplementation: window.fetch.bind(window),
      });
const loadExportCapabilities = import.meta.env.DEV
  ? undefined
  : createExportCapabilitiesLoader();
const loadAiCapabilities = createAiCapabilitiesLoader();
const cloudMarkupDownloadClient =
  localOwnerSession === undefined
    ? createConfiguredAuthenticatedBinaryDownloader(getValidCognitoAccessToken)
    : createAuthenticatedBinaryDownloader({
        accessToken: localOwnerToken,
        apiBaseUrl: "/api",
        development: false,
        fetchImplementation: window.fetch.bind(window),
      });

applyDocumentTheme();

async function renderApplication() {
  let developmentGallery: ReactNode;
  if (import.meta.env.DEV) {
    const { CloudMarkupDevelopmentGallery } =
      await import("./features/development/CloudMarkupDevelopmentGallery.js");
    developmentGallery = <CloudMarkupDevelopmentGallery />;
  }

  root.render(
    <StrictMode>
      <ThemePreferenceSync />
      <CloudMarkupQueryProvider
        loadAiCapabilities={loadAiCapabilities}
        {...(loadExportCapabilities === undefined
          ? {}
          : { loadExportCapabilities })}
        {...(cloudMarkupClient === undefined
          ? {}
          : { client: cloudMarkupClient })}
        {...(cloudMarkupDownloadClient === undefined
          ? {}
          : { downloadBinary: cloudMarkupDownloadClient })}
      >
        <App
          developmentGallery={developmentGallery}
          {...(localOwnerSession === undefined ? {} : { localOwnerSession })}
        />
      </CloudMarkupQueryProvider>
    </StrictMode>,
  );
}

void renderApplication();
