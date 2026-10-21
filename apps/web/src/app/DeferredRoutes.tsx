import { lazy, type ComponentProps } from "react";

import { DeferredRouteBoundary } from "./DeferredRouteBoundary.js";
import { loadDeferredRouteModule } from "./deferred-route-loader.js";

// Keep these identities stable across navigation and parent renders. Both editor
// entry points must defer; revisions also reference export creation components.
const LazyEditorRoute = lazy(() =>
  loadDeferredRouteModule(async () => ({
    default: (await import("../features/editor/EditorRoute.js")).EditorRoute,
  })),
);
const LazyEditorMain = lazy(() =>
  loadDeferredRouteModule(async () => ({
    default: (await import("../features/editor/EditorWorkspace.js")).EditorMain,
  })),
);
const LazyRevisionsPage = lazy(() =>
  loadDeferredRouteModule(async () => ({
    default: (await import("../features/revisions/RevisionPages.js"))
      .RevisionsPage,
  })),
);
const LazyRevisionDetailPage = lazy(() =>
  loadDeferredRouteModule(async () => ({
    default: (await import("../features/revisions/RevisionPages.js"))
      .RevisionDetailPage,
  })),
);
const LazyArtifactReviewPage = lazy(() =>
  loadDeferredRouteModule(async () => ({
    default: (await import("../features/exports/ExportPages.js"))
      .ArtifactReviewPage,
  })),
);
const LazyExportConfirmationPage = lazy(() =>
  loadDeferredRouteModule(async () => ({
    default: (await import("../features/exports/ExportPages.js"))
      .ExportConfirmationPage,
  })),
);
const LazyGitLabExportPage = lazy(() =>
  loadDeferredRouteModule(async () => ({
    default: (await import("../features/exports/GitLabExportPage.js"))
      .GitLabExportPage,
  })),
);
const LazyGitHubExportPage = lazy(() =>
  loadDeferredRouteModule(async () => ({
    default: (await import("../features/exports/GitHubExportPage.js"))
      .GitHubExportPage,
  })),
);
const LazySolutionExportPage = lazy(() =>
  loadDeferredRouteModule(async () => ({
    default: (await import("../features/exports/SolutionExportPage.js"))
      .SolutionExportPage,
  })),
);
const LazyTemplatesPage = lazy(() =>
  loadDeferredRouteModule(async () => ({
    default: (await import("../features/templates/TemplatePages.js"))
      .TemplatesPage,
  })),
);
const LazyTemplateDetailPage = lazy(() =>
  loadDeferredRouteModule(async () => ({
    default: (await import("../features/templates/TemplatePages.js"))
      .TemplateDetailPage,
  })),
);

export function TemplatesPage(props: ComponentProps<typeof LazyTemplatesPage>) {
  return (
    <DeferredRouteBoundary title="Templates">
      <LazyTemplatesPage {...props} />
    </DeferredRouteBoundary>
  );
}

export function TemplateDetailPage(
  props: ComponentProps<typeof LazyTemplateDetailPage>,
) {
  return (
    <DeferredRouteBoundary title="Template">
      <LazyTemplateDetailPage {...props} />
    </DeferredRouteBoundary>
  );
}

export function EditorRoute(props: ComponentProps<typeof LazyEditorRoute>) {
  return (
    <DeferredRouteBoundary
      title="Architecture editor"
      includeShell
      shellIdentity={props.shellIdentity}
    >
      <LazyEditorRoute {...props} />
    </DeferredRouteBoundary>
  );
}

export function EditorMain(props: ComponentProps<typeof LazyEditorMain>) {
  return (
    <DeferredRouteBoundary title="Architecture editor">
      <LazyEditorMain {...props} />
    </DeferredRouteBoundary>
  );
}

export function RevisionsPage(props: ComponentProps<typeof LazyRevisionsPage>) {
  return (
    <DeferredRouteBoundary title="Revision history">
      <LazyRevisionsPage {...props} />
    </DeferredRouteBoundary>
  );
}

export function RevisionDetailPage(
  props: ComponentProps<typeof LazyRevisionDetailPage>,
) {
  return (
    <DeferredRouteBoundary title="Immutable revision">
      <LazyRevisionDetailPage {...props} />
    </DeferredRouteBoundary>
  );
}

export function ArtifactReviewPage(
  props: ComponentProps<typeof LazyArtifactReviewPage>,
) {
  return (
    <DeferredRouteBoundary title="Artifact review">
      <LazyArtifactReviewPage {...props} />
    </DeferredRouteBoundary>
  );
}

export function ExportConfirmationPage(
  props: ComponentProps<typeof LazyExportConfirmationPage>,
) {
  return (
    <DeferredRouteBoundary title="ZIP export">
      <LazyExportConfirmationPage {...props} />
    </DeferredRouteBoundary>
  );
}

export function GitHubExportPage(
  props: ComponentProps<typeof LazyGitHubExportPage>,
) {
  return (
    <DeferredRouteBoundary title="GitHub export">
      <LazyGitHubExportPage {...props} />
    </DeferredRouteBoundary>
  );
}

export function SolutionExportPage(
  props: ComponentProps<typeof LazySolutionExportPage>,
) {
  return (
    <DeferredRouteBoundary title="Solution export">
      <LazySolutionExportPage {...props} />
    </DeferredRouteBoundary>
  );
}

export function GitLabExportPage(
  props: ComponentProps<typeof LazyGitLabExportPage>,
) {
  return (
    <DeferredRouteBoundary title="GitLab export">
      <LazyGitLabExportPage {...props} />
    </DeferredRouteBoundary>
  );
}
