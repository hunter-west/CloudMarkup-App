# Cloud Markup asset policy

## Status and purpose

This document defines ownership, provenance, security, accessibility, packaging,
and deterministic-use requirements for visual assets. The current M1 foundation
implements a provider-neutral icon registry, a neutral placeholder, the
contract-v2 AWS manifest, a controlled local candidate-staging and promotion
pipeline, generated static registration, and integrity and bundle checks. The
pipeline may admit only an explicit catalog-referenced subset of an
owner-approved official package after every selected file passes the automated
technical gates. It does not make provider artwork a Cloud Markup brand asset or
change provider semantics. The deterministic diagram renderer consumes only the
exact owner-approved local manifest and normalized bytes; it cannot fetch or
invent provider artwork.

The product-owner-supplied Cloud Markup logo and its deterministic browser icon
derivatives are now recorded under `apps/web/src/assets/brand`. No illustration
library or template thumbnail set is present. An absent, unmapped, or
technically rejected provider icon resolves to the reviewed neutral placeholder
without changing catalog, graph, validation, or deployment meaning.

This policy is governed by:

- [ADR-0019: Product-owner governance for official provider icons](../adr/0019-product-owner-governance-for-official-provider-icons.md);
- [ADR-0007: Deterministic diagram export](../adr/0007-deterministic-diagram-export.md);
- historical
  [ADR-0008: Controlled provider icon asset pipeline](../adr/0008-provider-icon-asset-pipeline.md),
  which ADR-0019 supersedes while retaining its technical controls;
- [ADR-0015: Provider-neutral icon resolution](../adr/0015-provider-neutral-icon-resolution.md);
- [Security principles](../architecture/SECURITY_PRINCIPLES.md); and
- the [Cloud Markup design system](DESIGN_SYSTEM.md).

## Non-negotiable rules

- Do not generate or commission AI imitations of AWS, Azure, GCP, or other
  provider service icons.
- Do not copy provider icons from arbitrary websites, search results,
  screenshots, unofficial icon libraries, or unverified repositories.
- Do not hotlink runtime or exported assets.
- Do not imply provider endorsement, certification, partnership, or support
  merely because a provider name or icon is shown.
- Keep provider-owned marks visually and operationally separate from Cloud
  Markup brand assets.
- Import only assets referenced by the exact included catalog slice and covered
  by the product-owner approval for the intended surfaces. Prefer an exact
  resource icon; use an official service-family icon only through an explicit
  approved mapping. Do not commit an entire provider archive “for later.” Asset
  inclusion does not promote a catalog item to curated support.
- Record the official package label and version, canonical origin, whole-package
  SHA-256, import date, product-owner record, approved surfaces, one
  trademark-use acknowledgment, and the shared accessibility contract at source
  level. Record the exact source and normalized evidence for every mapping.
- Treat all incoming SVG, raster, archive, and metadata content as untrusted
  until it passes the controlled ingestion process.
- Multiple catalog icon IDs may alias one canonical destination only when their
  physical source and normalized evidence agrees. Store and bundle those bytes
  once; do not create duplicate files for aliases.
- Use a deterministic, local placeholder when a referenced asset is absent,
  unmapped, technically rejected, corrupt, or unavailable at runtime.

## Asset classes and ownership

| Asset class                      | Source owner                             | Repository owner                     | Required review                                                                                                         | Runtime/export rule                                              |
| -------------------------------- | ---------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Cloud Markup brand assets        | Cloud Markup                             | Product/brand                        | Product, brand, legal, accessibility                                                                                    | Local approved files only; supplied logo and exact derivatives   |
| Official AWS service icons       | Amazon Web Services                      | AWS provider asset maintainer        | Official source, product-owner use/mapping acknowledgment, automated technical admission, shared accessibility contract | Pinned local approved subset; never Cloud Markup logo material   |
| Future Azure/GCP icons           | Their respective provider                | Matching provider-package maintainer | Same provider-specific review as AWS                                                                                    | Separate versioned asset sets and registries                     |
| Interface action icons           | Approved icon source or Cloud Markup     | `packages/ui`                        | Design system, accessibility, dependency/security where applicable                                                      | Provider-neutral; never use provider marks as action controls    |
| Empty-state illustrations        | Cloud Markup or commissioned source      | Product/design                       | Product, brand, accessibility, security, legal                                                                          | Optional; must not carry required instructions                   |
| Architecture-template thumbnails | Cloud Markup renderer                    | Template/product owner               | Product, provider semantics, deterministic-render review                                                                | Generated from synthetic immutable template revisions            |
| Educational diagrams             | Cloud Markup documentation               | Product/design/documentation         | Technical accuracy, accessibility, provider usage                                                                       | Versioned source plus text alternative                           |
| Exported architecture diagrams   | Customer-directed deterministic renderer | Export subsystem                     | Authorization, redaction, renderer/asset integrity                                                                      | Immutable-revision-bound SVG/PNG; never viewport screenshots     |
| Raster/vector UI assets          | Class-specific owner                     | Owning package                       | Format, integrity, accessibility, security                                                                              | Local, bounded, optimized, and attributable                      |
| Social/marketing images          | Cloud Markup marketing                   | Product/marketing                    | Brand, legal, privacy, accessibility                                                                                    | Never shipped as product semantics                               |
| User avatars                     | User or approved identity source         | Identity/profile adapter             | Privacy, content, security, retention                                                                                   | Rasterized/proxied or initials fallback; no arbitrary inline SVG |

Provider assets remain provider-owned even when packaged locally. They cannot be
recolored, combined into a Cloud Markup mark, used as a decorative background,
or presented outside recorded provider usage guidance. Service names and text
remain the primary accessible identification.

## Repository structure and planned roots

The M1 provider-neutral UI and AWS provider asset roots now exist. Paths marked
future must not be created or populated until their implementation milestone and
review are authorized. Paths are code text rather than links because this
section describes both present and nonexistent layout targets rather than
navigable documentation.

```text
apps/web/src/assets/
  brand/
    README.md                  # product-owner source and derivative record
    public/                    # exact supplied logo plus browser metadata/icons
  illustrations/
    README.md
    empty-states/             # optional, non-semantic illustrations
    education/                # reviewed local educational artwork
  social/
    README.md
    open-graph/               # product/marketing output, not UI semantics

packages/ui/
  src/
    tokens/                   # semantic design tokens and density profiles
    icons/                    # provider-neutral action-icon wrappers
    provider-icons/           # IconRegistry contract and ProviderIcon adapter
    components/               # provider-neutral primitives/composites
  assets/
    actions/                  # approved local action-icon subset if required
    placeholders/             # neutral provider/resource placeholders

packages/provider-aws/assets/
  README.md
  SOURCE_REVIEW.md             # concise authoritative source/owner evidence
  provider-icons.manifest.json # contract-v2 bound runtime projection
  icons/                       # canonical approved catalog-referenced files

packages/provider-azure/assets/   # future; same structure and separate approval
packages/provider-gcp/assets/     # future; same structure and separate approval
```

Cloud Markup brand, illustrations, and social images never move into a provider
package. Provider icons never move into `apps/web/src/assets/brand`,
`packages/ui/assets/actions`, or a general marketing directory.

Provider catalog TypeScript and compiled JSON continue to contain only opaque
`iconId` values. They contain no path, URL, loader, byte content, attribution
body, or executable callback. The asset manifest is a separately reviewed
release input.

## Asset-set and entry manifest

The version-2 final manifest contract is strict, versioned, and deterministic.
Contract-v1, mixed, candidate, or invented evidence fails closed. At minimum,
the final asset set records:

- `contractVersion`, manifest kind, stable asset-set ID, provider ID, semantic
  version, calculated digest, and exact catalog identities;
- one `source` block with `packageLabel`, `packageVersion`, official HTTPS
  `origin`, `packageSha256`, and explicit UTC `importedAt`;
- one `approval` block with the product-owner `recordId`, `reviewerName`,
  `reviewerRole`, stated `reviewerRelationship`, `approvalDate`, canonical
  `approvedSurfaces`, one `trademarkUseAcknowledgment`, and one
  `accessibilityContract`;
- deterministic transformation tool, version, and allow-listed capabilities; and
- entries sorted by exact catalog `iconId`.

An approved mapping records `state: approved`, exact opaque `iconId`,
catalog-derived `serviceName`, `awsServiceFamily`, `sourceMember`,
`sourceSha256`, `normalizedSha256`, `destinationAssetId`, canonical local
`file`, `mappingType` (`exact-resource` or `service-family`),
`automatedSecurityResult: passed`, source and normalized byte sizes,
`mediaType`, SVG `viewBox`, and the exact transformation steps that ran.

A final placeholder entry has only `state: placeholder`, `file: null`, `iconId`,
catalog-derived `serviceName`, and a concrete `placeholderReason`. An unmapped
official source uses `missing`; the runtime derives `integrity-failure` only
from invalid or unexpected evidence. Candidate state exists only in external
staging and is never accepted by the checked final-manifest validator.

The checked `SOURCE_REVIEW.md` is the authoritative source-level human decision
record. The manifest is the authoritative generated per-mapping evidence.
Promotion retains the candidate's source and approval projection only after
matching it exactly to the checked record and validating every mapping against
the catalog and staged normalized checksums. Reusing an owner record for a
changed source package, approval, or mapping fails closed. Repository checks
reject drift between the record and projection. The canonical asset-set digest
is calculated by tooling; no operator pastes it back as a second approval.

`SOURCE_REVIEW.md` uses a strict parser-canonical line format. It is narrowly
excluded from general Markdown formatting so line wrapping cannot change its
meaning; its dedicated parser and provider-icon checks enforce exact bytes and
manifest binding. The generated provider-icon manifest is also narrowly excluded
from general formatting because the pipeline owns its canonical JSON key
ordering and byte serialization. It must be regenerated and validated, never
hand-formatted.

Dates and reviewer identity are explicit evidence, but canonical runtime
resolution cannot depend on the current clock, directory enumeration, machine
paths, or network state. Manifest ordering is normalized before hashing. Aliases
share one `destinationAssetId`, filename, normalized digest, and complete
physical evidence; equal bytes under different asset identities or files fail.

If an official distribution is not literally a software package, its named
release/archive is still recorded in `source.packageLabel` with the safest
available exact package version evidence. “Latest,” an unversioned download URL,
or a retrieval date alone is not a version.

## Controlled ingestion and approval

1. Confirm that every requested icon ID appears in the exact pinned provider
   catalog and that adding the asset does not claim curated service support.
2. Record the official package label/version, official HTTPS origin,
   whole-package SHA-256, explicit import date, and product-owner record. Do not
   use search-result mirrors or machine paths as evidence.
3. Keep the archive in a quarantined temporary location outside runtime asset
   paths and the repository. Do not alter or commit it.
4. Verify package identity before extraction. Bound archive entries, expanded
   bytes, compression ratio, paths, nesting, file count, and formats. Reject
   traversal, links, devices, executables, nested archives, and unexpected
   members.
5. Select only explicit catalog mappings. Prefer exact resource artwork and use
   an official service-family asset only when the owner record approves that
   semantic mapping.
6. Run the importer in dry-run mode. Parse and validate every selected file
   using pinned tools and apply only narrow, versioned, deterministic
   normalization.
7. Bind the dry-run selected-source digest when writing a candidate bundle to an
   existing external staging directory. The importer cannot mark an entry
   approved or write runtime assets.
8. Record the exact package, approved surfaces, trademark-use acknowledgment,
   accessibility contract, and permitted exact-resource/service-family policy in
   the checked concise `SOURCE_REVIEW.md`. Keep exact per-mapping evidence in
   the candidate manifest rather than duplicating it as handwritten Markdown.
9. Run promotion without `--write`. Promotion reads only that fixed checked
   source-level record, exact-binds its source and approval projection to the
   candidate, validates every manifest mapping and staged checksum, reruns all
   path, symlink, SVG, normalization, size, catalog, registration, and alias
   checks, and calculates the final digest.
10. Review the dry-run, then repeat promotion with `--write`. Only exact
    owner-approved mappings that still pass every automated technical gate
    become approved; an individual failure remains on the neutral placeholder.
11. Run manifest, integrity, registry coverage, local-only resolution,
    accessibility fallback, build, security, bundle, and diff checks.
12. Review the concise owner record, source evidence, admitted files, and
    complete scoped diff together before commit.

Retrieval, candidate staging, owner approval, and repository admission are
separate operations. The importer never self-approves. Promotion materializes a
decision already present in the checked owner record; it does not invent one.
Automated validation is the authoritative technical security gate for admitted
static SVGs. No separate human security signature or outside-counsel opinion is
required by this provider-icon contract.

Local import and promotion assume a trusted, quiescent developer workspace.
Source, staging, review-record, and repository paths must not be replaced or
mutated concurrently. The fail-closed metadata and content checks reduce
accidental and untrusted-input risk; they are not a defense against a malicious
local administrator racing filesystem operations.

## Exact security and size limits

The following are provisional maximums for admitted product assets. A larger
asset requires a documented exception and security/performance evidence; it must
not be silently compressed to evade the limit.

| Asset                                              | Maximum admitted bytes | Maximum decoded dimensions/complexity                                          |
| -------------------------------------------------- | ---------------------: | ------------------------------------------------------------------------------ |
| Runtime SVG asset, including provider/action icons |                256 KiB | One finite `viewBox`, at most 2,000 rendered elements and 20,000 path commands |
| Runtime raster asset or template thumbnail         |                  1 MiB | 2,048 × 2,048 and 4 megapixels                                                 |
| Separately reviewed marketing original             |                  5 MiB | 4,096 × 4,096 and 16 megapixels                                                |

Product illustrations and re-encoded avatars shipped at runtime must meet the
runtime raster row. Any larger source-upload transport limit is a separate
future security and retention decision; it does not relax repository admission.
Marketing originals receive separate product, brand, legal, privacy, and
security review and are not runtime UI assets by default.

Archive ingestion is bounded to 100 MiB compressed, 500 MiB expanded, 10,000
members, 10 directory levels, and a maximum 20:1 expansion ratio. Only selected
files within the admitted limits enter the repository.

### SVG controls

Reject an SVG containing:

- scripts, event-handler attributes, `foreignObject`, embedded HTML, or
  executable animation;
- external URLs, network references, `@import`, remote fonts, external
  stylesheets, or external `<use>` targets;
- `data:` or blob payloads, embedded archives, or executable media;
- DTDs, entities, processing instructions, or XML inclusion;
- filters, masks, patterns, or recursion that exceed reviewed complexity
  budgets;
- non-finite coordinates, extreme transforms, invisible oversized canvases, or
  parser-expansion constructs; or
- metadata that conflicts with the recorded source or usage guidance.

Namespace IDs deterministically when inline embedding is required. Prefer an
isolated local image for UI display; diagram SVG embedding uses only the
sanitized admitted representation. Record both the official source checksum and
the normalized-output checksum. A transformation never erases the source record
or creates permission to alter a provider mark.

The AWS importer has one narrowly versioned source-only transformation:
`remove-unused-root-xlink-namespace-v1`. It may delete only the exact root
attribute ` xmlns:xlink="http://www.w3.org/1999/xlink"` after a namespace-aware
parse of the original bounded UTF-8 source proves that the declaration occurs
once on the unprefixed root `svg`, every rendered element remains in the SVG
namespace, and no prefixed name, alias, nested or rebound namespace, or
declaration-like token uses or imitates XLink. The importer deletes the proved
source span without DOM reserialization and then runs the complete unchanged
admitted-SVG validator from the beginning. It preserves the original source
bytes, size, and checksum separately from the admitted bytes, size, and
checksum.

The admitted validator, shared repository check, and promotion command never
perform this source-only normalization. A bare or restored `xmlns:xlink`
declaration remains forbidden in staged and runtime bytes. The manifest's
top-level transformation list records importer capabilities in canonical order;
each file-bearing entry records the exact steps that actually ran. Unknown,
missing, duplicated, reordered, or extra step sequences fail closed. The
importer version must change whenever this behavior changes.

The XML preflight recognizes only a grammatical lowercase XML 1.0 or 1.1
declaration whose optional encoding is UTF-8. Processing instructions, lookalike
`xml-*` targets, malformed declarations, incompatible encoding claims, DTDs,
entities, and inclusion remain forbidden.

### Raster controls

- Verify file signature and decoded media type rather than trusting extension or
  `Content-Type`.
- Decode under CPU, memory, pixel, and time limits; reject decompression bombs
  and malformed color profiles.
- Strip EXIF, GPS, comments, thumbnails, and unrelated metadata.
- Re-encode user avatars and untrusted raster input through an approved
  deterministic pipeline.
- Preserve provider colors only as permitted by usage guidance; do not apply
  arbitrary recoloring.
- Never treat raster text as the only accessible content.

### Runtime controls

- No remote URL may appear in a runtime registration or exported diagram.
- Registration uses static declared imports or generated local tables, not
  directory scans, dynamic module paths, or catalog-supplied callbacks.
- Duplicate IDs, digest mismatch, unsupported media, or a missing approved entry
  fail the build/asset verification gate.
- Runtime resolution still returns a safe placeholder rather than a broken image
  if corruption or deployment drift is encountered.
- Asset failures reveal identifiers and bounded reasons, never local machine
  paths, archive contents, credentials, or customer architecture data.

## Provider-neutral `IconRegistry`

`ProviderIconId` remains owned by `@cloudmarkup/provider-sdk` and is obtained
from a parsed `ProviderServiceDefinitionV1`. The SDK and catalog do not resolve
files. The provider-neutral `@cloudmarkup/ui` package does not depend on the
provider SDK, so its public registry contract is generic over an exact string
ID. Application composition supplies the catalog-owned `ProviderIconId` as that
generic type without interpreting or replacing it.

The implemented UI contract is logically:

```ts
export interface IconAssetSetIdentity {
  readonly id: string;
  readonly providerId: string;
  readonly version: string;
  readonly digest: string;
}

export type IconResolution<TAsset, TIconId extends string = string> =
  | {
      readonly kind: "approved";
      readonly iconId: TIconId;
      readonly asset: TAsset;
      readonly assetSet: IconAssetSetIdentity;
      readonly sourceDigest: string;
    }
  | {
      readonly kind: "placeholder";
      readonly iconId: TIconId;
      readonly asset: TAsset;
      readonly assetSet: IconAssetSetIdentity;
      readonly reason:
        | "pending-approval"
        | "missing"
        | "rejected"
        | "withdrawn"
        | "integrity-failure";
    };

export interface IconRegistry<TAsset, TIconId extends string = string> {
  readonly assetSet: IconAssetSetIdentity;
  resolve(iconId: TIconId): IconResolution<TAsset, TIconId>;
}
```

The provider-neutral registry is now an unreleased internal `@cloudmarkup/ui`
public export implementing this total-resolution contract. Renderer-specific
asset representations remain future work.

The type parameter lets the web adapter resolve a local image/component while a
diagram renderer resolves sanitized SVG bytes. Neither adapter changes the
catalog or graph. Registry construction is read-only and rejects duplicate
registrations. Resolution is total and deterministic.

Feature components follow this flow:

1. read a service through the version-bound catalog accessor;
2. pass `service.iconId` to the injected registry;
3. render the returned approved asset or neutral placeholder; and
4. use `service.displayName` for visible and accessible service naming.

React feature components never import AWS, Azure, or GCP asset files. The
application composition root injects the checked AWS registry and its generated
static registration. `packages/ui` supplies the provider-neutral `ProviderIcon`
wrapper, focus/high-contrast treatment, and placeholder.

The registry does not infer provider, service, filename, or visual appearance
from an ID prefix. Although AWS currently declares `aws.cloudmarkup.icons`, the
catalog compiler does not currently enforce icon namespace membership. Coverage
checks compare exact IDs explicitly.

Multiple icon IDs may intentionally resolve to the same approved official
service asset when provider guidance allows it. This is safer than inventing a
subresource mark. An asset filename never becomes a service or icon identity.

## Current AWS icon references

The latest AWS catalog, `0.15.0`, references the 24 IDs below. Checked asset set
`1.3.0`
(`sha256:d69f9d42d8f6eb28cdae6d250768ac1176f3f5c23ac950c4ab0f7e97a489dd06`)
preserves all 11 immutable catalog identity/digest pins from `0.5.0` through
`0.15.0`. All 24 current icon IDs resolve through 20 canonical SVGs totaling
54,682 bytes, with zero manifest placeholders:

- `aws.cloudmarkup.icons.apigateway`;
- `aws.cloudmarkup.icons.availability-zone`;
- `aws.cloudmarkup.icons.cloudwatch-alarm`;
- `aws.cloudmarkup.icons.cloudwatch-logs`;
- `aws.cloudmarkup.icons.cognito`;
- `aws.cloudmarkup.icons.cognito-app-client`;
- `aws.cloudmarkup.icons.dynamodb`;
- `aws.cloudmarkup.icons.eventbridge`;
- `aws.cloudmarkup.icons.eventbridge-rule`;
- `aws.cloudmarkup.icons.gateway-vpc-endpoint`;
- `aws.cloudmarkup.icons.iam-policy`;
- `aws.cloudmarkup.icons.iam-role`;
- `aws.cloudmarkup.icons.internet-gateway`;
- `aws.cloudmarkup.icons.lambda`;
- `aws.cloudmarkup.icons.nat-gateway`;
- `aws.cloudmarkup.icons.region`;
- `aws.cloudmarkup.icons.route-table`;
- `aws.cloudmarkup.icons.s3`;
- `aws.cloudmarkup.icons.security-group`;
- `aws.cloudmarkup.icons.sns`;
- `aws.cloudmarkup.icons.sqs`;
- `aws.cloudmarkup.icons.step-functions`;
- `aws.cloudmarkup.icons.subnet`; and
- `aws.cloudmarkup.icons.vpc`.

These are compatibility identifiers only. The checked manifest and bound owner
record, not this list, determine whether each ID resolves to an approved exact
or service-family mapping. The IDs must not be renamed to resemble upstream
filenames: changing `iconId` changes canonical catalog content and its digest.

## Placeholder requirements

The neutral placeholder:

- is a Cloud Markup-owned geometric resource/container symbol, not provider-like
  artwork;
- uses no provider silhouette, color system, initials, logo fragments, or trade
  dress;
- is readable in light, monochrome, high-contrast, print, and transparent
  backgrounds;
- appears beside a visible service name and receives an accessible name only
  when not decorative;
- supports bounded missing, unmapped, technically rejected, and
  integrity-failure reasons without implying that the architecture node itself
  is invalid;
- has stable vector and raster forms with pinned checksums; and
- is embedded locally in deterministic exports.

An unavailable icon never removes the service, changes validation, blocks graph
commands, changes IaC, or substitutes a different service.

## Updates and source changes

- Asset sets use semantic versions and immutable digests.
- Updating bytes under a stable catalog `iconId` creates a new asset-set
  version; it does not require changing catalog identity.
- Changing an `iconId` is a catalog compatibility change and requires the
  catalog version/digest and migration or intentional rejection analysis.
- A provider-requested removal or source replacement creates an explicit new
  asset set and falls back safely where required; the registry never fetches a
  replacement silently.
- Compatibility/withdrawal prose and a future review cadence are operational
  product decisions, not per-entry promotion evidence for a technically safe,
  owner-approved official package.

## Diagram export profiles

The deterministic diagram renderer implements both export profiles. They consume
the same immutable, authorized Architecture Document revision and exact provider
catalog. A profile changes explanatory presentation only; it cannot change the
document, validation result, IaC addresses, or generated code.

Every export request and manifest pins:

- Architecture Document schema version, revision ID, and content/visual hashes;
- provider/catalog ID, version, and digest;
- diagram output contract and profile version;
- renderer and layout-rule versions;
- asset-set ID, version, and digest;
- approved font-set ID/version/digest;
- validation report identity/target/environment where included;
- background, fit, detail, identifier, and redaction settings; and
- SVG/PNG file digests.

### Presentation profile

The presentation profile prioritizes explanation:

- clean service and user labels;
- a title and optional subtitle;
- provider and explicit region, or `Region not established`;
- restrained relationship labels;
- readable provider-semantic boundaries;
- a compact legend for relationship patterns and visible statuses;
- validation status summary without dense diagnostic paths;
- generated/AI/unsupported/read-only status only when relevant; and
- no ports, internal node IDs, or configuration detail by default.

### Technical profile

The technical profile adds:

- exact port and relationship labels;
- selected allowlisted configuration summaries;
- lifecycle/provenance badges;
- validation severity, affected locations, and report completeness;
- catalog, renderer, and asset metadata;
- optional Cloud Markup node ID and deployment key;
- exact region state and mapping readiness; and
- optional resource identifiers only when explicitly selected, authorized,
  present in the immutable input, and safe to export.

The technical profile never reveals raw secret values, platform secrets,
credential material, authorization tokens, secret-reference identifiers,
sensitive variable values, or unreviewed internal metadata.

### Output formats and backgrounds

SVG and PNG are beta requirements. PDF remains deferred.

- SVG uses a deterministic `viewBox`, embedded sanitized local icon definitions,
  pinned font behavior, stable element order/IDs, `<title>`, `<desc>`, text
  labels, and no network references.
- PNG is rasterized from the canonical SVG with pinned `resvg-js`, local pinned
  Inter assets, and system-font discovery disabled; it is never a browser
  capture.
- Background options are `opaque-light` (default), `transparent`, and
  `canvas-light`. Transparent output retains contrast-safe node and label
  backing. A future dark profile requires separate reviewed tokens and golden
  evidence.
- `fit-content` includes the full normalized graph with a 48 px logical margin.
  `fit-selection` is allowed only when an explicit selection is part of the
  export request and is named in the title/description. `fit-viewport` refers to
  an explicit export viewport, never the transient browser viewport.

### Large-diagram behavior

- SVG retains the complete vector scene within accepted graph/output complexity
  limits.
- A single PNG is bounded to 8,192 px per dimension and 32 megapixels.
- The v1 renderer bounds nodes, edges, icons, labels, SVG bytes, and PNG bytes;
  over-limit input fails closed before unbounded allocation.
- Within the hard limits, the renderer uses fit-to-content and reports stable
  detail/label/readability warnings instead of silently clipping. Tiled output
  remains deferred.

### Redaction and accessibility

- Secret values are never renderer inputs. A configured secret displays
  `Secret reference configured` only when that fact is selected for the
  technical profile.
- Sensitive values and provider-generated identifiers are excluded by default.
  Configuration summaries use an explicit allowlist derived from reviewed
  catalog metadata; absence means omit, not guess.
- SVG includes an accessible title and description naming revision, provider,
  region state, node/edge counts, validation status, profile, and legend.
- Combined exports include a machine-readable manifest and a plain-text or
  structured architecture summary so the image is not the only representation.
- Color, provider icons, canvas position, and line shape are never the only
  source of relationship or status meaning.

## Verification status and remaining release evidence

The current M1 foundation checks strict v2 manifest and owner-record binding,
canonical hashing and drift, exact catalog coverage, total fallback resolution,
canonical aliases, duplicate identities/files/bytes, oversized and malicious
SVG, unsupported raster/archive content, traversal, symlinks, remote references,
direct provider imports, runtime approval, and production-bundle representation.
Component tests cover decorative/named wrappers, visible service names, and
neutral fallback behavior. These automated results are the technical security
gate; they do not manufacture the product-owner source, mapping, trademark-use,
or accessibility decision.

Deterministic diagram export adds deterministic SVG/PNG, malicious-label,
provider-icon, large-graph, viewport-independence, profile-parity,
manifest/checksum, and browser preview evidence. A later visual-review milestone
may add broader golden image coverage without changing revision or deployment
meaning.

The future component-state matrix is defined in
[Design system](DESIGN_SYSTEM.md#representative-component-state-matrix), and the
testing tool direction is recorded in
[ADR-0016](../adr/0016-component-isolation-and-visual-testing.md).

The web brand gate separately verifies the exact supplied logo digest and
dimensions, deterministic PNG/ICO derivatives, local-only manifest and HTML
links, production-build byte identities, and deployed response media types. It
does not modify or replace the independently governed provider-icon checks.

## Open decisions

This specification deliberately does not invent:

- brand typography or marketing illustration style;
- Azure or GCP sources;
- future provider review/update cadence;
- PDF, dark-theme, tiled-output, or broader visual-review policy; or
- artifact retention behavior after a provider requires asset withdrawal.

Those future decisions require their applicable owners. The checked AWS
product-owner record is a business-owner trademark-use acknowledgment, not an
outside-counsel legal opinion. Safe provider placeholders and the reviewed Cloud
Markup logo allow other work to proceed without inventing missing decisions.
