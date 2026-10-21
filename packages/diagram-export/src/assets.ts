import type { ProviderCatalogArtifactV1 } from "@cloudmarkup/provider-sdk";
import { sha256DigestSchema } from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  diagramIconSetV1Schema,
  type DiagramExportIconSetV1,
} from "./contracts.js";
import { compareUtf16, digestBytes, utf8Size } from "./security.js";

const manifestSchema = z
  .object({
    approval: z
      .object({ approvedSurfaces: z.array(z.string().min(1)).max(16) })
      .loose(),
    assetSet: z
      .object({
        digest: sha256DigestSchema,
        id: z.string().min(1).max(256),
        providerId: z.string().min(1).max(256),
        version: z.string().min(1).max(64),
      })
      .strict(),
    catalogs: z
      .array(
        z
          .object({
            digest: sha256DigestSchema,
            id: z.string().min(1).max(256),
            version: z.string().min(1).max(64),
          })
          .strict(),
      )
      .max(64),
    contractVersion: z.literal(2),
    entries: z
      .array(
        z
          .object({
            automatedSecurityResult: z.string().optional(),
            file: z
              .string()
              .regex(/^[a-z0-9][a-z0-9.-]{0,95}\.svg$/u)
              .nullable(),
            iconId: z.string().min(1).max(256),
            mediaType: z.string().optional(),
            normalizedBytes: z.number().int().positive().optional(),
            normalizedSha256: sha256DigestSchema.optional(),
            placeholderReason: z.string().optional(),
            state: z.enum([
              "approved",
              "pending-approval",
              "placeholder",
              "rejected",
              "withdrawn",
            ]),
            viewBox: z.string().optional(),
          })
          .loose(),
      )
      .max(2_048),
  })
  .loose();

/**
 * Projects the reviewed provider icon manifest and exact local file bytes into
 * the provider-neutral renderer contract. No icon ID is inferred from a file
 * name and no missing asset is fetched.
 */
export function createDiagramIconSetV1(input: {
  readonly assetsByFile: Readonly<Record<string, string>>;
  readonly catalog: ProviderCatalogArtifactV1;
  readonly manifest: unknown;
}): DiagramExportIconSetV1 {
  const manifest = manifestSchema.parse(input.manifest);
  if (!manifest.approval.approvedSurfaces.includes("diagram-export")) {
    throw new TypeError(
      "Provider icon set is not approved for diagram export.",
    );
  }
  if (manifest.assetSet.providerId !== input.catalog.provider.id) {
    throw new TypeError(
      "Provider icon set does not match the selected provider.",
    );
  }
  const exactCatalog = manifest.catalogs.filter(
    (candidate) =>
      candidate.id === input.catalog.catalog.id &&
      candidate.version === input.catalog.catalog.version &&
      candidate.digest === input.catalog.digest,
  );
  if (exactCatalog.length !== 1) {
    throw new TypeError(
      "Provider icon manifest must pin the exact selected catalog once.",
    );
  }
  const entries = new Map<string, (typeof manifest.entries)[number]>();
  for (const entry of manifest.entries) {
    if (entries.has(entry.iconId)) {
      throw new TypeError("Provider icon manifest IDs must be unique.");
    }
    entries.set(entry.iconId, entry);
  }
  const referencedIconIds = [
    ...new Set(
      input.catalog.services.flatMap((service) =>
        service.iconId === null ? [] : [service.iconId],
      ),
    ),
  ].sort(compareUtf16);
  const icons = referencedIconIds.flatMap((iconId) => {
    const entry = entries.get(iconId);
    if (entry?.state !== "approved") {
      return [];
    }
    if (
      entry.automatedSecurityResult !== "passed" ||
      entry.file === null ||
      entry.mediaType !== "image/svg+xml" ||
      entry.normalizedBytes === undefined ||
      entry.normalizedSha256 === undefined ||
      entry.viewBox === undefined
    ) {
      throw new TypeError(
        "Approved provider icon is missing exact security or integrity evidence.",
      );
    }
    const svg = input.assetsByFile[entry.file];
    if (svg === undefined) {
      throw new TypeError(
        "Approved provider icon bytes are unavailable locally.",
      );
    }
    if (
      utf8Size(svg) !== entry.normalizedBytes ||
      digestBytes(svg) !== entry.normalizedSha256
    ) {
      throw new TypeError(
        "Approved provider icon bytes do not match their manifest evidence.",
      );
    }
    return [
      {
        iconId,
        normalizedSha256: entry.normalizedSha256,
        svg,
        viewBox: entry.viewBox,
      },
    ];
  });
  return diagramIconSetV1Schema.parse({
    assetSet: manifest.assetSet,
    contractVersion: 1,
    icons,
  });
}
