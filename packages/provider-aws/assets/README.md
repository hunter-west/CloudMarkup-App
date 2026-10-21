# AWS provider icon assets

Provider-icon availability is declared only by the checked contract-v2 manifest
and generated registration. An approved entry is usable only when the
source-level owner record covers its surface and its automated security result
passes. A placeholder entry or runtime integrity failure resolves to the
provider-neutral Cloud Markup placeholder. Provider archives, extracted
packages, staging bundles, and unrecorded assets never belong here.

## Evidence contract

[SOURCE_REVIEW.md](SOURCE_REVIEW.md) is the concise authoritative human record
for one official package, the product-owner use approval, the three approved
surface classes, the trademark-use acknowledgment, and the supplementary-icon
accessibility contract. It is not an outside-counsel opinion or a human security
attestation.

The record uses parser-canonical one-line JSON values and is intentionally
excluded from Prettier. Do not hand-wrap or generally format it; produce the
exact canonical representation and validate it with the source-review parser and
provider-icon checks.

The generated manifest is likewise narrowly excluded from Prettier because its
canonical JSON serializer, key ordering, and byte representation are owned by
the pipeline. Do not hand-format it; promotion and provider-icon checks own its
deterministic output.

The manifest is the authoritative generated mapping record. For every approved
mapping it carries the exact catalog icon ID and display name, AWS service
family, official source member, source and normalized checksums, canonical
destination asset ID and filename, exact-resource or service-family mapping
type, automated security result, byte sizes, viewBox, media type, and
transformation steps. This evidence is not duplicated as hand-maintained
per-entry Markdown.

The importer creates candidate staging only. Promotion binds the candidate's
source and approval projection to the checked owner record, validates every
mapping against the exact catalog and staged bytes, reruns every
source-independent pre-promotion admission check, changes matching passing
candidates to approved, generates deterministic registration, and calculates the
canonical asset-set digest. No separate reviewer file path or manually pasted
final digest is accepted by the promotion CLI.

## Controlled local import

The importer accepts only a developer-supplied local directory and an explicit
contract-v2 mapping file. It does not download, scrape, discover, or infer
provider files. Verify and extract an official archive separately into a bounded
temporary directory outside the repository; reject traversal, links, devices,
nested archives, unsupported members, and limit violations. Never alter or
commit the archive or extracted package.

Import and promotion assume a trusted, quiescent local workspace: do not replace
or mutate source, staging, evidence, or repository paths while either command is
running. Their fail-closed metadata and content checks are not a defense against
a malicious local administrator racing filesystem operations.

Run the importer in dry-run mode first. This validates and reports a candidate
set without writing provider assets, runtime assets, or staging files:

```powershell
pnpm icons:import:aws --source <local-directory> --mapping <mapping.json> --source-origin <official-https-location> --package-label <package-or-archive-name> --package-version <exact-version> --package-sha256 <sha256:digest> --asset-set-version <version> --imported-at <explicit-utc-timestamp> --approval-record <record-id> --reviewer-name <name> --reviewer-role "Cloud Markup product owner" --reviewer-relationship <relationship> --approval-date <YYYY-MM-DD>
```

The wrapper supplies the canonical `diagram-export`, `documentation`, and
`product-ui` surfaces, the `supplementary-icon-with-visible-name-v1`
accessibility contract, and the repository-defined substantive trademark-use
acknowledgment. They are fixed contract values, not free-form command arguments.

The dry-run reports `selectedSourceSha256`, a deterministic digest over the
exact mapped relative source paths and their bytes. Compare that value with the
bounded extraction inventory. Repeat the same command with
`--selected-source-sha256 <dry-run-digest> --write --staging <external-candidate-directory>`.
The staging directory must already exist and resolve canonically outside the
repository. Write mode fails if the mapped source changed. The selected-source
digest is a technical race/drift lock, not a human approval or a second final
asset-set digest.

The recorded `--package-sha256` is official-package provenance; the importer
does not claim to verify or extract the upstream archive. Retrieval, package
verification, bounded extraction, and extraction inventory remain separate
prerequisites under the asset policy. The importer never copies or executes the
provider package. Importer `2.0.0` includes the conditional
`remove-unused-root-xlink-namespace-v1` source step. It removes only the exact
unused root ` xmlns:xlink="http://www.w3.org/1999/xlink"` declaration after a
bounded namespace-aware parse proves the namespace is unused and every element
remains ordinary SVG. It deletes that one source span without reserializing or
altering artwork, then runs the complete unchanged SVG validator. Raw source and
normalized byte counts and SHA-256 values remain distinct. The top-level
manifest steps list this importer capability; an entry lists it only when the
declaration was actually removed.

Check and promotion never invoke the source-only step. Restoring or presenting
the namespace declaration in admitted bytes remains a safety failure. Exact step
sequences are allow-listed and ordered. XML preflight accepts only grammatical
lowercase XML 1.0 or 1.1 declarations with optional UTF-8 encoding;
processing-instruction lookalikes, incompatible encodings, active content,
remote URLs, deceptive namespace text, and used or rebound namespaces fail
closed.

The JSON report also lists imported IDs, missing catalog IDs, and stale or
orphaned staging files. A confirmed write creates candidate icons, a
candidate-only manifest, and a candidate static registration externally. It
never writes `packages/provider-aws/assets/icons` or the web application, and
candidate state is invalid in the checked final manifest. A mapping file has
this strict shape:

```json
{
  "contractVersion": 2,
  "mappings": [
    {
      "awsServiceFamily": "AWS service family",
      "destinationAssetId": "aws.cloudmarkup.provider-icons.canonical-asset",
      "iconId": "an.exact.catalog.icon-id",
      "mappingType": "exact-resource",
      "outputFile": "reviewed-logical-name.svg",
      "sourceFile": "relative/path/from-the-local-source.svg"
    }
  ]
}
```

Mapping entries use only `iconId`, `sourceFile`, `outputFile`,
`destinationAssetId`, `awsServiceFamily`, and `mappingType` (`exact-resource` or
`service-family`). The importer derives `serviceName` from the pinned catalog.
Aliases must use the same destination asset, source member, output file, and
normalized bytes. Identical bytes under different destination IDs or filenames
fail closed.

Staged files remain `candidate`. Import is not permission to ship. The
product-owner evidence supplied on the command line is staged for exact binding,
but only the checked [SOURCE_REVIEW.md](SOURCE_REVIEW.md) is authoritative for
the source-level approval.

Validate the exact candidate bundle and checked source-level approval in
promotion dry-run mode:

```powershell
pnpm icons:promote:aws --staging <external-candidate-directory>
```

Repeat with `--write` only after reviewing the dry-run:

```powershell
pnpm icons:promote:aws --staging <external-candidate-directory> --write
```

Promotion reads the fixed checked owner record; there is no `--review-record` or
`--asset-set-digest` argument. It requires the approved official source, exact
product-owner record, canonical surfaces and trademark/accessibility contracts,
explicit exact-resource or service-family mappings, and passing automated
security. It validates the recorded source evidence, rehashes staged normalized
bytes, and revalidates catalog names, paths, symlinks, SVG/XML safety, size,
transformations, aliases, and orphan files. Reusing an owner record for a
changed source package, approval, or mapping fails closed. The promoter then
calculates the final digest, materializes only passing mapped candidates as
approved, and generates registration. Direct-import, registration-drift,
production-build, and exact-once bundle checks remain mandatory post-promotion
release gates.

The guarded write updates the canonical local icon subset, checked manifest, and
generated registration with backups and rollback on detected failures; it never
downloads an asset. An interrupted process can leave a
`.cloudmarkup-promotion-*.backup` or `.tmp` recovery path, which blocks another
promotion until a human compares it with the working tree and restores or
removes it. `pnpm icons:check` and the full scoped diff must pass before commit.

Run `pnpm icons:check` after any change. The check rejects owner-record or
manifest drift, catalog gaps, duplicate identities/files/bytes, orphaned
IDs/files, unsafe SVG, unexpected raster/archive content, noncanonical
normalized SVG, unrecorded source evidence, direct provider-asset imports
outside the registry, remote runtime assets, and deterministic integrity drift.
Run `pnpm icons:check:bundle` after the production web build to prove each
canonical approved asset is bundled exactly once even when several icon IDs
alias it.
