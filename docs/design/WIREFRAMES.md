# Cloud Markup Wireframes

## Status and use

These low-fidelity text wireframes are normative layout and content references.
They are not screenshots, final visual design or implementation evidence. See
[Project Status](../PUBLIC_STATUS.md) for current implementation and activation.

The frames instantiate [Information Architecture](INFORMATION_ARCHITECTURE.md)
and [UI Specification](UI_SPEC.md). The
[Product Specification](../product/PRODUCT_SPEC.md),
[User Workflows](../product/USER_WORKFLOWS.md), and
[Domain Model](../architecture/DOMAIN_MODEL.md) remain authoritative for product
and architecture semantics.

## Reading the frames

- `[Action]` is a button; `[Disabled: reason]` is visibly unavailable with a
  safe explanation.
- `( )` and `(x)` are unselected and selected single-choice controls.
- `[ ]` and `[x]` are unchecked and checked multiple-choice controls.
- `<Status: text>` is a text-bearing status, never a color-only indicator.
- `>` indicates the current navigation or list item.
- `...` is intentionally omitted content, not permission to invent behavior.
- “Guided” and “Professional” annotations change presentation only. They never
  indicate different graph, validation, revision, compiler, or export data.
- Provider icon positions accept an approved local icon or a neutral labeled
  placeholder. No frame implies provider endorsement or approved icon assets.

Widths are illustrative. The initial behavioral postures are desktop at
`>= 1280px`, tablet at `768px`–`1279px`, and phone below `768px`.

## Desktop screens

### D1 — Sign in

Route: `/sign-in`

```text
+----------------------------------------------------------------------------+
| CloudMarkup                                                    [Help]      |
+----------------------------------------------------------------------------+
|                                                                            |
|                         Welcome to CloudMarkup                             |
|        Design, understand, validate, and export cloud architecture.        |
|                     CloudMarkup does not deploy it.                        |
|                                                                            |
|                    [Continue with configured identity]                     |
|                                                                            |
|              Privacy summary                          Terms                |
|                                                                            |
| <Status region: signed out / retryable error / service unavailable>        |
+----------------------------------------------------------------------------+
```

State annotations:

- A validated same-origin return route may be retained; organization or project
  names are not revealed before authentication.
- A retry preserves the safe return route. A terminal identity error does not
  loop automatically.
- The control labels the configured identity method; no frame assumes a
  particular production identity provider.

### D2 — Authentication callback

Route: `/auth/callback`

```text
+----------------------------------------------------------------------------+
| CloudMarkup                                                                |
+----------------------------------------------------------------------------+
|                                                                            |
|                           Completing sign in                               |
|                           [progress indicator]                             |
|                  Checking your identity and access...                      |
|                                                                            |
| <Live status: callback pending>                                            |
+----------------------------------------------------------------------------+
```

Failure replaces the progress region with a safe explanation, correlation
reference, **Try sign in again**, and **Return to sign in**. Callback parameters
are consumed server-side and removed from the browser URL before an
authenticated screen renders.

### D3 — Invitation

Route: `/invitations/:invitationToken`

```text
+----------------------------------------------------------------------------+
| CloudMarkup                                                    [Account]   |
+----------------------------------------------------------------------------+
|                         Organization invitation                            |
|                                                                            |
|  Sign in to review this invitation.                                        |
|  Invitation details appear only after identity and token checks succeed.   |
|                                                                            |
|                  [Sign in and continue]   [Decline]                        |
|                                                                            |
| <Status: checking / ready / accepted / expired-or-unavailable>              |
+----------------------------------------------------------------------------+
```

After a successful check, the screen may show the authorized organization name,
inviter display information, and role/policy summary. **Accept invitation**
exchanges the opaque token once. Accepted, expired, revoked, already-consumed,
invalid, and unauthorized results never leave the token in normal navigation or
reveal unauthorized membership information.

### D4 — Project dashboard

Route: `/organizations/:organizationId/projects`

```text
+----------------------------------------------------------------------------+
| CloudMarkup | Organization v | Projects        Mode: Guided | Credits | Me |
+----------------------+-----------------------------------------------------+
| > Projects           | Projects                                  [New project] |
|   Templates          | [Search projects........................] [Filter v] |
|   Usage              |                                                     |
|   Settings           | Plan limit: 3 of 5 projects                         |
|                      | +-------------------------------------------------+ |
|                      | | Notes API        <Draft v12: Saved>              | |
|                      | | 2 errors, validation current | Updated 10m ago  | |
|                      | +-------------------------------------------------+ |
|                      | | Customer portal  <Revision r7>                  | |
|                      | | Artifact job running | Updated yesterday        | |
|                      | +-------------------------------------------------+ |
|                      |                                                     |
|                      | Recent authorized activity              [View all]  |
+----------------------+-----------------------------------------------------+
```

Empty variants:

- **No projects yet** offers prompt, template, and blank creation if authorized.
- **No search matches** preserves the query and offers **Clear filters**.
- **Project limit reached** distinguishes entitlement/limit state and offers
  only an authorized resolution path.
- Loading uses project-card skeletons without previous-organization content.

### D5 — Templates and template detail

Routes: `/organizations/:organizationId/templates` and
`/organizations/:organizationId/templates/:templateId`

```text
+----------------------------------------------------------------------------+
| CloudMarkup | Organization v | Templates                     Credits | Me  |
+----------------------+-----------------------------------------------------+
|   Projects           | Architecture templates                              |
| > Templates          | [Search........] [Capability v] [Readiness v]       |
|   Usage              |                                                     |
|   Settings           | +------------------+ +------------------+           |
|                      | | [thumbnail]      | | [thumbnail]      |           |
|                      | | Template name    | | Template name    |           |
|                      | | Version / status | | Version / status |           |
|                      | | [Review]         | | [Review]         |           |
|                      | +------------------+ +------------------+           |
+----------------------+-----------------------------------------------------+

+----------------------------------------------------------------------------+
| [Back to templates]  Template name vN                         [Use template]|
|----------------------------------------------------------------------------|
| Summary and intended capabilities      | Pinned provider/catalog context   |
| Included architecture concepts         | Assumptions and unresolved gaps   |
| Security/cost/availability notes       | Compilation and icon readiness    |
| Proposed starting content preview      | <Catalog status / unknown facts> |
+----------------------------------------------------------------------------+
```

A thumbnail is explanatory only. **Use template** creates a project proposal
through the normal creation flow; it does not apply hidden semantic defaults.
Unsupported, incompatible, or unapproved templates are reviewable only when
authorized and have no active creation action.

### D6 — New-project start choices

Route: `/organizations/:organizationId/projects/new`

```text
+----------------------------------------------------------------------------+
| [Back]                      New project                         Step 1 of 2 |
|----------------------------------------------------------------------------|
| Project name                                                               |
| [                                                                         ]|
|                                                                            |
| How would you like to start?                                               |
| +--------------------+ +--------------------+ +--------------------------+ |
| | Describe an app    | | Use a template     | | Start with a blank draft | |
| | Guided intent      | | Review a versioned | | Add catalog concepts     | |
| | proposal           | | starting proposal  | | yourself                 | |
| | [Choose prompt]    | | [Browse templates] | | [Choose blank]           | |
| +--------------------+ +--------------------+ +--------------------------+ |
|                                                                            |
| <Limit and entitlement status>                          [Cancel] [Continue] |
+----------------------------------------------------------------------------+
```

Step 2 shows only the chosen input:

- prompt: application description, data/availability/cost reminders, privacy
  notice, expected credit reservation, and **Create intent proposal**;
- template: exact template/version review and **Create from reviewed template**;
- blank: provider/catalog context and **Create blank project**.

Creation succeeds atomically or remains on this screen with safe input
preserved. No partial project is shown.

### D7 — AI requirements review

Route: `/organizations/:organizationId/projects/:projectId/intent`

```text
+----------------------------------------------------------------------------+
| CloudMarkup | Org / Project | Intent <Proposal> | Saved | Guided | Credits |
+----------------------+-----------------------------------------------------+
| Intent sections      | Review what CloudMarkup understood                  |
| > Summary            |                                                     |
|   Requirements (8)   | Application summary                                |
|   Assumptions (3)    | [editable reviewed text..........................]   |
|   Questions (2)      |                                                     |
|   Data               | Requirements                                        |
|   Availability       | [x] HTTP ingress     [Edit]                         |
|   Cost               | [x] Authenticated users [Edit]                      |
|   Decisions          |                                                     |
|                      | Assumptions                                          |
| Proposal evidence    | ! "Traffic is moderate" [Confirm] [Correct]         |
| Model response:      |                                                     |
| schema accepted      | Unresolved questions                                |
| Raw output: not      | ? Retention period [Answer] <Unresolved>             |
| applied              |                                                     |
|                      | [Save review] [Request architecture proposal]        |
+----------------------+-----------------------------------------------------+
```

The screen separates requirements, assumptions, unresolved questions,
decisions/alternatives, environment, ingress/egress, identity/authorization,
data sensitivity/retention/residency, availability/recovery/latency/scale,
operational overhead, cost, and compliance. Unknowns stay explicit. Raw model
output is never applied. Model refusal, schema rejection, timeout, policy
denial, and credit exhaustion have distinct states and leave the current Intent
Document usable.

### D8 — Blank editor

Route: `/organizations/:organizationId/projects/:projectId/editor`

```text
+--------------------------------------------------------------------------------------+
| CloudMarkup | Org / Project | Status | Undo Redo | Commands | Canvas | Help          |
+--------------------------------------------------------------------------------------+
| . . . . . . . . . . FULL ARCHITECTURE CANVAS BACKGROUND . . . . . . . . . . . . |
| +-- Catalog · persistent/resizable 336px --+                  +-- Inspector 92px --+ |
| | Search services                          | Local fixture    | [Architecture]      | |
| | [Category v]                             | not persisted    | [Configure]         | |
| |                                          |                  | [Connect]           | |
| | Service results                          | Your architecture| [Learn]             | |
| | (catalog-bound)                          | is blank         | [IaC]               | |
| |                                          |                  +---------------------+ |
| |                                          | [Describe an application]                 |
| |                                          | [Use a template]                          |
| |                                          | [Add a service]                           |
| +------------------------------------------+                                           |
|                              +-- Minimap 152x104 --+                                   |
|                              | viewport + nodes   |                                   |
|                              +--------------------+                                   |
| +-- Workspace launcher · fixed 48px -----------------------------------------------+ |
| | [Assistant] [Issues] [Code] [Activity] [Jobs]                                    | |
| +----------------------------------------------------------------------------------+ |
+--------------------------------------------------------------------------------------+
```

Catalog-empty, incompatible-catalog, unavailable-icon, offline, read-only, and
permission states replace only the affected region while the shell reports the
overall state. No blank-state action creates infrastructure meaning without a
reviewed command. The local-fixture status is development-only and is absent for
a production-backed project. The Catalog, 92px Inspector launcher, and 48px
Workspace launcher overlay the continuous canvas. No rich popup is open on a
fresh desktop, and the fixed launchers reserve only their compact safe areas.

### D9 — Populated editor

Route: `/organizations/:organizationId/projects/:projectId/editor`

```text
+--------------------------------------------------------------------------------------+
| CloudMarkup | Org / Notes | Status | Undo Redo | Commands | Canvas | Help            |
+--------------------------------------------------------------------------------------+
| +-- Catalog · 336px ----------------+                  +-- Inspector launcher 92px -+ |
| | [Search........]                  |                  | [Architecture]            | |
| | Compute Lambda [Details] [Add]    | o [HTTP API] o  | [Configure]               | |
| | Data DynamoDB [Details] [Add]     |       | invoke   | [Connect]                 | |
| | Identity Cognito [Details] [Add]  |       v          | [Learn]                   | |
| | Availability not reviewed         | o [λ notes-api] o| [IaC]                     | |
| +-----------------------------------+       | read      +---------------------------+ |
|                                             v                                        |
|                     o [DynamoDB] o    [IAM policy]*                                  |
|                                                                                      |
|                                                                                      |
|                     +-- Minimap 152x104 --+                                           |
|                     | all nodes + viewport|                                           |
|                     +---------------------+                                           |
| +-- Workspace launcher · 48px -----------------------------------------------+       |
| | [Assistant] [Issues] [Code] [Activity] [Jobs]  Validation: Incomplete      |       |
| +----------------------------------------------------------------------------+       |
+--------------------------------------------------------------------------------------+
```

The invocation, data access, and permission lines are separate typed
relationships. No semantic boundary is rendered: boundary styling remains
future-only until the applicable domain and provider contracts support it.
`* generated` indicates provenance, not lower importance. The frame
intentionally says Region **Unknown**, validation **Incomplete**, catalog
`0.5.0`, and mapping **metadata only**; it must not look clean or export ready.
Every non-boundary service in a freshly opened or reset project session starts
in the same 176-by-72 compact presentation. Expanding a card is an explicit
session-only choice. The compact Lambda keeps one visible blue input dot on the
left and one output dot on the right. All exact group handles remain bound at
those anchors, and hover/focus names the represented inputs or outputs. **Fit
architecture** accounts for the persistent Catalog, fixed launchers, active
popup, and minimap safe area without rewriting graph coordinates. The canvas
itself keeps direct zoom and minimap controls only.

### D10 — Selected-resource inspector

This is D9 after double-clicking the Lambda body or activating Configure. The
shared popup sits beside the 92px launcher rather than occupying a persistent
canvas column.

```text
+-- Configure popup · shadow --------------------------------+ +-- Inspector 92px --+
| Configure                                           [Close] | | [Architecture]      |
| > [icon] Lambda · notes-api — Selected details             | | [Configure] active  |
| [Configure] [Connect] [Learn] [IaC]                        | | [Connect]           |
|-------------------------------------------------------------| | [Learn]             |
| Runtime *                                                   | | [IaC]               |
| [catalog-controlled value v]                                | +---------------------+
| Source: explicit / proposed default                         |
|                                                             |
| Memory *                                                    |
| [ 512 ] MiB | Cost note from catalog                        |
|                                                             |
| Advanced configuration [Show]                               |
| Secret values are never entered here.                       |
|                                                             |
| Implementation                                              |
| Mode: generated starter (intent only)                       |
| Runtime: nodejs | Handler: index.handler                     |
| Triggers: GET /notes (1)                                    |
| Actions: read table A; write table B                        |
| Dispatch: single handler | Missing decisions: 0             |
| Starter generation: Not available in M1                     |
| User code: required until generation exists                 |
|                                                             |
| [Discard form buffer] [Preview command]                     |
+-------------------------------------------------------------+

Architecture destination instead of Configure:
+-- Architecture popup ---------------------------------------+
| Architecture (4 resources)                         [Close] |
| HTTP API                                      [Show details] |
| Lambda                                        [Show details] |
| DynamoDB table                                [Show details] |
| [scrolling authoritative list/tree]                        |
+------------------------------------------------------------+

Resource port details and the selected-details summary are closed by default.
Expanding one Architecture row reveals its exact input/output ports without
hiding child resources. Validation navigation expands the containing row before
focusing a hidden exact port.

Connect destination:
| Receives events from                                       |
|   API route — many allowed                                 |
| Reads or writes data                                       |
|   Read table A | Write table B                             |
| Network and security                                       |
|   Execution role — 1 of 1                                 |
| Observability                                              |
|   Canonical log group — 1 of 1                            |
| [Review relationship] [Start connection]                  |

Learn destination:
| What it does | Security | Cost | Availability              |
| Unsupported capabilities | Provider documentation         |

IaC destination:
| Target: Terraform | Status: Mapping metadata only          |
| Compilation is not implemented                            |
| Configuration-binding summary                             |
```

Architecture, Configure, Connect, Learn, and IaC consume the exact pinned
catalog and selected identity through one popup frame. Switching a launcher
changes the destination without discarding hidden advanced values or opening a
second rich popup. **Preview command** shows the exact prior-value precondition
and domain change; it is not a second form-validation system. Labels, focus
treatment, and activation targets remain complete while padding, type size,
blank space, and gap are compact.

Both modes use the category and consequence labels shown above and the same
**Technical details** disclosure for capability, port, relationship, rule, IAM
provenance, cardinality, and finding IDs/paths. Assistance wording may differ.
The Architecture popup exposes the same per-port starts without drag, but keeps
them flat beneath each resource so its existing tree hierarchy remains
unambiguous; category grouping belongs to Connect and the wizard. Each popup
uses the shared restrained shadow and 160ms open/close motion, becomes immediate
under reduced motion, and restores focus to its invoking launcher on close.

### D11 — Connection wizard

Overlay on the editor; desktop uses a modal, constrained widths use a
full-height sheet.

The bounded M1 editor implements one resolver-backed component tree in both
modes. The dialog has the same geometry, density, fields, order, validation,
actions, shortcuts, and **Technical details** disclosure. Guided may add
plain-language explanation; Professional may use concise exact terminology.
Persistence, removal/lifecycle actions, compilation, cloud access, and
deployment remain outside this slice.

```text
+--------------------------------------------------------------------------+
| Connect Lambda to DynamoDB                         Review and connect 2/2 |
| Source: Lambda / Invocation | Target: DynamoDB / Table API               |
| Relationship: data read                                [Change endpoints] |
|--------------------------------------------------------------------------|
| Complete atomic change preview                                          |
|  1. Add typed relationship: Lambda -> DynamoDB                           |
|  2. Add generated bounded policy resource                               |
|  3. Attach policy to exact Lambda role                                   |
|  4. Reference exact DynamoDB table                                       |
|                                                                          |
| Permission effects and supporting-resource lifecycle                     |
| <Preview validation: current | findings N | diagnostics 0>               |
|                                                                          |
| > Technical details                                                      |
|   exact ports | rule | actions/scope | command IDs | provenance          |
|--------------------------------------------------------------------------|
| [Back]                                    [Cancel] [Connect]             |
+--------------------------------------------------------------------------+
```

Stage 1 is **Set up connection**: choose one compatible relationship and
complete the ordered fields, recommendations, and validation. Stage 2 is
**Review and connect**: review the complete atomic effects and confirm. Changing
an endpoint, field, catalog, or draft version invalidates the preview. An
unresolved requirement, incomplete validation preview, unsupported resolver,
stale draft, or permission loss disables **Connect**. Failure applies no partial
state.

### D12 — Generated-resource lifecycle

```text
+--------------------------------------------------------------------------+
| Remove connection and review supporting resources                        |
|--------------------------------------------------------------------------|
| Connection: Lambda -> DynamoDB                                            |
| [x] Release this connection dependency                                    |
|                                                                          |
| Bounded policy resource                                                   |
| <Will be retained>                                                        |
| Reason: another provenance dependency remains                            |
| Live references: 1 | Provenance dependencies after release: 1             |
|                                                                          |
| This outcome is non-invertible because prior provenance cannot be         |
| reconstructed safely.                                                     |
|--------------------------------------------------------------------------|
| [Cancel]                                    [Apply exact release command] |
+--------------------------------------------------------------------------+
```

Alternate authoritative results are **delete after zero dependencies and live
references**, **retain because shared**, **adoption required before
customization**, **adopt and retain**, or **cannot proceed because preconditions
changed**. There is no generic cascading-delete choice.

### D13 — Validation workflow

Route: editor with Issues workspace open.

```text
+--------------------------------------------------------------------------------------+
| CloudMarkup | Org / Project | Draft v12 | Saved | Validation: Incomplete            |
+--------------------------------------------------------------------------------------+
| . . . . . . . . . . FULL ARCHITECTURE CANVAS BACKGROUND . . . . . . . . . . . . |
| [API] -> [Lambda] -> [Table]                          +-- Inspector launcher 92px -+ |
| Selected affected path highlighted + focused         | [Architecture]            | |
|                                                      | [Configure]               | |
|                                                      | [Connect]                 | |
|                                                      | [Learn]                   | |
|                                                      | [IaC]                     | |
|                                                      +---------------------------+ |
| +-- Issues popup · shadow ---------------------------------------------------------+ |
| | Issues · Validation incomplete                                          [Close] | |
| | [All] [Severity v] [Element v] [Current version only]                           | |
| | ! Engine diagnostic — report incomplete                                         | |
| | > security-error | API authentication... | node path                             | |
| |   warning        | ...                   | edge path                             | |
| +---------------------------------------------------------------------------------+ |
| +-- Workspace launcher · fixed 48px ----------------------------------------------+ |
| | [Assistant] [Issues active] [Code] [Activity] [Jobs]                            | |
| +---------------------------------------------------------------------------------+ |
+--------------------------------------------------------------------------------------+
```

The status includes engine version, evaluated content hash, target, environment,
catalog context, executed/skipped rules, and draft version. Running, stale,
incomplete, clean-complete, and unavailable are distinct. “Clean” is allowed
only for a complete current report with zero findings. Finding severity is
preserved exactly; future server-owned eligibility, not this screen, decides
gates. Issues opens above the fixed 48px launcher and gives its content one
scroll owner. It is the only rich popup while active; opening an Inspector
destination replaces it rather than stacking another editor surface. Closing
restores focus to Issues and retains it as the last Workspace destination. The
shared shadow and 160ms motion become immediate under reduced motion.

### D14 — Revision history and immutable revision

Routes: `/organizations/:organizationId/projects/:projectId/revisions` and
`.../revisions/:revisionId`

```text
+----------------------------------------------------------------------------+
| Project | Revisions                                      [Review new revision]|
|----------------------------------------------------------------------------|
| Revision | Created by/at | Graph/catalog | Validation | Artifact            |
| r7       | actor / time  | v2 / 0.5.0    | complete   | failed              |
| r6       | actor / time  | v2 / 0.5.0    | complete   | ready               |
| r5       | actor / time  | v1 / 0.3.0    | ...        | unsupported         |
+----------------------------------------------------------------------------+

+----------------------------------------------------------------------------+
| [Back] Revision r6 <Immutable>                         [Start new draft work]|
|----------------------------------------------------------------------------|
| Summary | Architecture | Validation | Lineage | Artifacts                  |
| Content digest | graph schema | provider/catalog ID/version/digest          |
| Created actor/time | assumptions | unresolved requirements                 |
| [Presentation diagram/list]             [Open artifact]                    |
+----------------------------------------------------------------------------+
```

Revision detail has no edit controls. A stale/unsupported version fails closed
and presents only authorized safe actions. **Start new draft work** creates new
lineage; it never alters r6.

### D15 — Revision creation

Overlay from a saved draft.

```text
+--------------------------------------------------------------------------+
| Create immutable revision                                                |
|--------------------------------------------------------------------------|
| Persisted draft: v12                      <Saved>                         |
| Validation report: report_...             <Current and complete>          |
| Eligibility: [server-authoritative result and reasons]                   |
| Provider / region: AWS / Unknown                                         |
| Graph schema: 2 | Workload: v1 | Catalog: id / 0.5.0 / sha256:...        |
| Compiler compatibility: [pinned document value]                          |
|                                                                          |
| Assumptions (3) [Review] | Unresolved requirements (2) [Review]           |
| Semantic changes since r6 [Expand]                                       |
|                                                                          |
| A revision is immutable. Compilation will reference only this revision.  |
|--------------------------------------------------------------------------|
| [Cancel]                                          [Create revision]       |
+--------------------------------------------------------------------------+
```

Saving, offline queue, conflict, stale/incomplete validation, capability loss,
or an ineligible server result prevents submission and links to the necessary
review. Success navigates to the immutable revision/job state; an ambiguous
response resolves the idempotent request before allowing another submission.

### D16 — Generated-code and diagram review

Route:
`/organizations/:organizationId/projects/:projectId/artifacts/:artifactId/review`

```text
+----------------------------------------------------------------------------+
| Artifact a9 <Immutable> | Revision r6 | Verified status          [Export v]|
|----------------------------------------------------------------------------|
| Files | Diff | Code | Diagram | Validation | Metadata                       |
|============================================================================|
| Manifest                       | Review                                    |
| > main.tf         digest...    |  Code view / complete diff                |
|   variables.tf    digest...    |  read-only                               |
|   architecture.svg digest...  |                                           |
|   architecture.png digest...  |  diagnostics + tool versions             |
|   summary.md      digest...    |                                           |
|                                |  no edit/apply/deploy control             |
|----------------------------------------------------------------------------|
| Input revision/digest | compiler/target/catalog versions | verification     |
+----------------------------------------------------------------------------+

Diagram tab:
+----------------------------------------------------------------------------+
| Profile: (x) Presentation ( ) Technical | Background: Light / Transparent  |
| Format: SVG / PNG | [Fit] | [Open text summary]                            |
|----------------------------------------------------------------------------|
|                   deterministic renderer output                            |
|                 [title + provider/region + legend]                         |
|                 [readable boundaries and labels]                           |
|----------------------------------------------------------------------------|
| Renderer/layout/font/asset-set versions and digests | Redaction: applied   |
+----------------------------------------------------------------------------+
```

Both diagram profiles consume the same immutable revision. Technical adds
allowed ports/relationships/configuration/validation/identifier detail; it does
not change the architecture. Preview zoom and checkerboard are not artifact
inputs. Oversized PNG reports deterministic fit/tiling or a bounded explicit
failure and never silently crops. The diagram is not a browser screenshot.

### D17 — ZIP export

Route: `.../artifacts/:artifactId/export/zip`

```text
+--------------------------------------------------------------------------+
| Export reviewed artifact as ZIP                                          |
|--------------------------------------------------------------------------|
| Artifact: a9 | Revision: r6 | Digest: sha256:...                          |
| Files: N | Size: estimated N | Verification: [exact artifact result]      |
|                                                                          |
| Includes                                                                 |
| [x] Exact reviewed generated IaC                                          |
| [x] SVG and PNG diagrams                                                  |
| [x] Architecture/version metadata and summary                             |
| [x] Validation and verification evidence                                 |
|                                                                          |
| CloudMarkup has not deployed or verified this in your cloud account.      |
|--------------------------------------------------------------------------|
| [Back to review]                                  [Download exact ZIP]    |
+--------------------------------------------------------------------------+
```

Expired storage, digest mismatch, lost permission, limit/entitlement denial, and
platform failure have separate states. Retrying retrieves the same reviewed
artifact and never regenerates it silently.

### D18 — GitHub export

Route: `.../artifacts/:artifactId/export/github`

```text
+----------------------------------------------------------------------------+
| Export reviewed artifact to GitHub                               Step 2/3 |
|----------------------------------------------------------------------------|
| Artifact a9 / revision r6 / digest sha256:...                              |
| Repository [authorized repository v]    Base [main v]                      |
| Branch     [cloudmarkup/project-r6........................]                 |
| PR title   [Add CloudMarkup architecture revision r6......]                |
| PR body    [references included deterministic diagram.....]                |
|                                                                            |
| Complete file change                                                       |
| + N added | ~ N changed | - N removed                     [Review full diff]|
|                                                                            |
| Integration will create a branch and pull request. It will not merge,      |
| force-push, deploy, or add files outside this reviewed artifact.           |
|----------------------------------------------------------------------------|
| [Back] [Cancel]                      [Create branch and pull request]       |
+----------------------------------------------------------------------------+
```

Step 1 obtains least-privilege authorization and repository selection. Step 3
shows queued/running/succeeded, permission loss, changed base, naming conflict,
expired authorization, or partial failure with an idempotent retry. A success
links to the authorized pull request and remains an export result, not a
deployment result.

### D19 — Billing

Route: `/organizations/:organizationId/billing`

```text
+----------------------------------------------------------------------------+
| Organization | Billing                                      <Owner access> |
|----------------------------------------------------------------------------|
| Subscription projection                                                     |
| Plan: [approved plan name or unavailable]  Status: [local projection]       |
| Last authoritative update: [time/status]                                    |
|                                                                              |
| Entitlements and limits                                                     |
| Projects       N / limit       | Exports       N / limit                    |
| AI features    enabled/denied  | Other approved capabilities                |
|                                                                              |
| Payment details are managed by Stripe. CloudMarkup does not store cards.    |
| [Start hosted checkout, if applicable] [Manage billing in Stripe]           |
|                                                                              |
| <Billing update pending: waiting for verified webhook>                       |
+----------------------------------------------------------------------------+
```

Only an authorized organization owner receives billing-management actions. A
return from Stripe displays pending/informational state until the local
webhook-derived projection changes. Prices, taxes, trials, refunds, proration,
cancellation access, and legal promises appear only after their policies are
approved.

### D20 — Usage

Route: `/organizations/:organizationId/usage`

```text
+----------------------------------------------------------------------------+
| Organization | Usage                                      [Period v]       |
|----------------------------------------------------------------------------|
| CloudMarkup credits                                                                 |
| Available 7,200 | Reserved 300 | Consumed 2,500 | Renewal [when approved]  |
| [====================----------------------] text equivalent available      |
|                                                                            |
| Usage history                                                              |
| Operation        Outcome       Credits       Time      [Details]            |
| Intent proposal  Settled       120           ...       [Open]               |
| Graph proposal   Released      0             ...       [Open]               |
|                                                                            |
| [ ] Show authorized technical details                                      |
|     model/version | input/output tokens | pricing-policy version | estimate |
|                                                                            |
| Credits are not money, card charges, or provider tokens.                   |
+----------------------------------------------------------------------------+
```

Credit exhaustion, feature-entitlement denial, product limit, projection
failure, and unavailable technical detail are distinct. Estimated provider cost
is labeled an estimate, never an invoice. Usage rows are projections over an
append-only ledger and have no edit control.

### D21 — Personal settings

Routes: `/settings/profile`, `/settings/preferences`, `/settings/security`

```text
+----------------------------------------------------------------------------+
| Settings                                                                   |
|----------------------------------------------------------------------------|
| > Profile          | Profile                                               |
|   Preferences      | [approved actor fields...........................]     |
|   Security         |                                      [Save profile]   |
|                    |                                                       |
|                    | Preferences                                           |
|                    | Assistance style: (x) Guided ( ) Professional          |
|                    | Workspace layout: [Reset]                              |
|                    | These preferences do not change architecture meaning. |
|                    |                                                       |
|                    | Security                                               |
|                    | Authorized sessions and approved account actions       |
+----------------------------------------------------------------------------+
```

Each route shows only its selected section; the combined frame documents their
shared shell. Assistance mode, panel, tutorial, and accessibility preferences
remain personal presentation state outside Architecture Documents. Any future
density preference is independent of assistance mode.

### D22 — Organization settings

Routes under `/organizations/:organizationId/settings/`.

```text
+----------------------------------------------------------------------------+
| Organization settings                                      <Read-only?>    |
|----------------------------------------------------------------------------|
| > General          | [Selected section heading]                            |
|   Members          |                                                       |
|   Roles            | Server-authorized data and actions                    |
|   Policies         |                                                       |
|   Security         | Empty/loading/denied/unavailable states are explicit. |
|   Data             |                                                       |
|                    | No control appears merely because a guessed role name |
|                    | would usually have access.                            |
+----------------------------------------------------------------------------+
```

Members includes invitation state and authorized membership actions. Roles and
Policies wait for the accepted M2 permission model. Security contains safe
organization posture and audit entry points. Data contains retention/export/
deletion actions only after policy and authorization are approved. Billing is a
separate owner-only route.

### D23 — Generic denied, unsupported, and not-found states

```text
+----------------------------------------------------------------------------+
| CloudMarkup                                                                |
|----------------------------------------------------------------------------|
| Access unavailable                                                        |
| We could not open this page with your current access.                      |
| [Return to projects] [Switch organization, when safe]                      |
+----------------------------------------------------------------------------+

+----------------------------------------------------------------------------+
| This version is not supported                                              |
| Resource class: [document/catalog/artifact/client, when authorized]        |
| Found: vN | Supported: [bounded compatibility statement]                   |
| Editing, compilation, and new export are unavailable.                      |
| [Supported migration, download, or help only when explicitly available]    |
+----------------------------------------------------------------------------+

+----------------------------------------------------------------------------+
| Page unavailable                                                           |
| The address may be incorrect, missing, or unavailable to you.              |
| [Return to a safe authorized location]                                     |
+----------------------------------------------------------------------------+
```

Denied and not-found copy intentionally avoids confirming tenant resource
existence. Unsupported state preserves source data and does not invent a
migration.

## Tablet behavior

### T1 — Editor review with drawers

```text
+------------------------------------------------------------------+
| CloudMarkup | Project | Draft v12 | Status | Me                   |
+------------------------------------------------------------------+
| [Catalog] [Canvas | List] [Inspector tools] [Workspace tools]     |
|------------------------------------------------------------------|
|                                                                  |
|               Architecture canvas or list/tree                   |
|               [Fit] [Select] [Open legend]                       |
|                                                                  |
| <Use desktop for precision placement and boundary fitting>       |
|                                                                  |
+------------------------------------------------------------------+
| Issues 2 | Jobs 1 | Save: queued offline                         |
+------------------------------------------------------------------+

Right drawer after [Architecture]:
                                     +------------------------------+
                                     | Architecture (4)           X|
                                     | [scrolling list/tree]        |
                                     | > API | Lambda | Table       |
                                     | [exact per-port actions]     |
                                     +------------------------------+

Right drawer after [Configure]:
                                     +------------------------------+
                                     | Lambda · Configure          X|
                                     | [scrolling schema fields]    |
                                     | [Preview command]            |
                                     +------------------------------+
```

Catalog and Inspector-destination drawers are mutually managed so the main
review region does not shrink below usability. Architecture remains separate
from Configure, Connect, Learn, and IaC. Assistant, Issues, Code, Activity, and
Jobs open as a bottom sheet. Configuration forms and explicit command previews
may remain usable; precision placement, edge drawing, and boundary fitting defer
to desktop and point to keyboard/list alternatives where available. The desktop
336px Catalog, 92px right launcher, 48px bottom launcher, and popup geometry do
not become narrow fixed columns; the same headings and controls move into these
responsive drawers without changing selection, active destination, or
Architecture Document meaning.

### T2 — Tablet connection sheet

```text
+------------------------------------------------------------------+
| Review and connect                                      Stage 2/2 |
|------------------------------------------------------------------|
| [scrolling exact changes, effects, findings, provenance]         |
| > Technical details                                              |
|                                                                  |
|------------------------------------------------------------------|
| [Back]                                     [Cancel] [Connect]    |
+------------------------------------------------------------------+
```

The connection workflow keeps **Set up connection** and **Review and connect**
with the same fields, order, disclosure, and actions as desktop. Other
generated-resource, revision, ZIP, and GitHub workflows use their documented
full-height sheet pattern. A sheet is not dismissed by an accidental background
gesture after the user enters data.

## Phone behavior

### P1 — Architecture list/tree review

```text
+--------------------------------------+
| < Project name           Status  Me  |
| Draft v12                            |
+--------------------------------------+
| Architecture | Issues | Activity | More|
|======================================|
| [Search architecture...............] |
| Resources (uncontained)              |
| > HTTP API         security-error 1  |
|   Port: [catalog name / exact ID]     |
|   Edge: invokes -> Lambda             |
| > Lambda           warning 1         |
|   Edge: read/write -> Table           |
|   Association: permission -> Policy  |
| > DynamoDB table                     |
| > Generated supporting resources    |
|                                      |
| [Open selected details]              |
|                                      |
| Full precision editing requires      |
| desktop. Review remains available.   |
+--------------------------------------+
```

The tree exposes node labels/types, semantic boundaries/parentage, ports, edge
direction/type, associations, provenance, permission/read-only state, and
finding counts as text. A small fit-to-screen diagram may be offered as a
supplement, never as the only meaning.

### P2 — Phone project status sheet

```text
+--------------------------------------+
| Project status                      X|
|--------------------------------------|
| Lifecycle        Draft v12           |
| Save             Conflict — review   |
| Mode             Guided [Change]     |
| CloudMarkup credits       7,200 available     |
| Validation       Incomplete / stale  |
| Jobs             1 running           |
| Export           Unavailable: draft  |
|                                      |
| [Review save conflict]               |
+--------------------------------------+
```

All top-bar status remains reachable and text-labeled. The sheet cannot resolve
a conflict automatically or imply export readiness.

### P3 — Phone node/edge details

```text
+--------------------------------------+
| < Architecture       Lambda details |
|--------------------------------------|
| Configure | Connect | Learn | IaC     |
|======================================|
| Type / provider / catalog version    |
| Provenance and permission state      |
| Findings with affected paths         |
|                                      |
| Configuration summary               |
| [Edit safe form, when authorized]    |
|                                      |
| Connections                          |
| invoke <- API                        |
| read/write -> Table                  |
| permission -> Policy                 |
+--------------------------------------+
```

Drawing edges, free placement, multi-panel editing, and precision boundary
resize are unavailable on phone. Reviewing and, where explicitly supported,
editing a schema-driven value still uses the same command and authorization
path.

### P4 — Phone findings

```text
+--------------------------------------+
| < Issues       Validation incomplete |
|--------------------------------------|
| ! Engine diagnostic                  |
| [All] [Severity] [Element]            |
|                                      |
| security-error                       |
| API authentication is incomplete     |
| Affected: HTTP API / auth config     |
| [Open explanation] [Go to element]   |
|                                      |
| warning                              |
| ...                                  |
+--------------------------------------+
```

The finding detail sheet preserves exact severity, beginner/technical
explanations, rule and condition, document path, references, version, and
remediation preview. Navigating to an element returns to P1 with that element
focused.

### P5 — Phone revision and artifact review

```text
+--------------------------------------+
| < Artifact a9        Immutable       |
| Revision r6 | digest...              |
|--------------------------------------|
| Manifest | Diff | Diagram | Metadata  |
|======================================|
| [selected file or fit diagram]       |
| [Open companion text summary]        |
|                                      |
| Verification status and diagnostics  |
| Renderer/compiler/catalog versions   |
|                                      |
| [Review export]                      |
+--------------------------------------+
```

Code uses a contained horizontal scroll region with line numbers and an
accessible plain-text alternative. The complete manifest and diff remain
reviewable. Authorized users may download or confirm an already-reviewed export;
the phone route does not compile a draft or regenerate an artifact.

### P6 — Phone creation and intent

```text
+--------------------------------------+
| < New project              Step 1/2  |
|--------------------------------------|
| Name [..............................] |
|                                      |
| [Describe an application]            |
| [Use a template]                     |
| [Start blank]                        |
|                                      |
| <Entitlement/limit status>           |
+--------------------------------------+

+--------------------------------------+
| < Intent review       Saved / Guided |
|--------------------------------------|
| [Summary v]                          |
| Requirement 1               [Edit]   |
| Assumption 1       [Confirm] [Correct]|
| Question 1                   [Answer] |
|                                      |
| [Next section]                       |
+--------------------------------------+
```

Project creation and intent review are form/list workflows and remain usable on
phone. Entering the resulting precision editor opens the list/tree review and
states the desktop construction boundary.

### P7 — Phone billing, usage, and settings

```text
+--------------------------------------+
| < Organization        Billing / Usage|
|--------------------------------------|
| [trusted projection summary]         |
| [entitlements or credit balances]    |
| [history rows]                       |
| [owner-only hosted action]           |
| <webhook update pending, if any>      |
+--------------------------------------+

+--------------------------------------+
| < Settings                           |
|--------------------------------------|
| [Profile]                            |
| [Preferences]                        |
| [Security]                           |
| [Organization sections if allowed]   |
+--------------------------------------+
```

The content and authority match D19–D22. Technical usage detail is opt-in,
billing return state is not entitlement, and unauthorized organization settings
are not disclosed.

## Overlay and transient-state plates

### O1 — Confirmation dialog

```text
+--------------------------------------------------------------+
| [Specific action and resource]                              X|
|--------------------------------------------------------------|
| Authoritative input: draft/revision/artifact ID and version  |
| Exact effect, supporting changes, and reversibility          |
| Warning or non-invertible result in text                     |
|                                                              |
| [Cancel]                              [Specific action verb]  |
+--------------------------------------------------------------+
```

Escape and Cancel have the same safe effect. Focus starts at the heading or
least-destructive logical control and returns to the invoker. A submission locks
duplicate actions but leaves status perceivable.

### O2 — Save conflict

```text
+--------------------------------------------------------------------------+
| Save conflict — no changes were overwritten                              |
|--------------------------------------------------------------------------|
| Your queued commands: N | Based on draft v12 | Current server draft v14  |
| [Review your command summaries] [Review server changes]                   |
|                                                                          |
| Reapply validates each exact precondition against the selected current    |
| version. Commands that no longer apply remain unapplied.                  |
|--------------------------------------------------------------------------|
| [Keep queue and close]                         [Begin reviewed reapply]   |
+--------------------------------------------------------------------------+
```

There is no automatic “last write wins,” tenant-data merge, or blind retry.

### O3 — Offline and reconnect

```text
+----------------------------------------------------------------------------+
| Offline — viewing cached draft v12 | Queued offline: 3 changes [Review]    |
+----------------------------------------------------------------------------+
```

On reconnect this becomes **Checking identity, access, draft version, and
preconditions**. It changes to Saved only after authoritative acknowledgement;
otherwise it opens O2 or an accurate denied/failed state. Revision, compilation,
billing, invitation, and export submissions remain unavailable offline.

### O4 — Notifications and jobs

```text
Toast: "Revision request received." [Open job] [Dismiss]

Notification center:
+--------------------------------------------------------------+
| Notifications                                              X|
| Running  | Compilation for revision r6                       |
| Failed   | GitHub export for artifact a9 [Review safe error] |
| Complete | ZIP ready for artifact a8 [Open]                  |
+--------------------------------------------------------------+
```

Toasts are supplemental. Durable state remains on the revision, artifact, job,
export, or billing/usage screen. Notifications contain no secret body or
unauthorized tenant detail.

### O5 — Loading, empty, read-only, limit, failure, and unsupported regions

```text
Loading:
| [stable skeleton shaped like the content] |
| <Live status: Loading authorized project> |

Empty:
| No findings for this complete current report. |
| or: No results match these filters. [Clear]   |

Read-only:
| Read-only — [safe reason category] |
| Review/navigation actions remain.  |

Limit:
| Project limit reached. |
| [Authorized plan/cleanup path, if policy supports it] |

Retryable failure:
| Save not acknowledged. Your safe input is retained. [Retry] |

Unsupported:
| Catalog version N is not supported. Editing and compilation are unavailable. |
```

Each state replaces or annotates the smallest responsible region while the page
heading, tenant-safe navigation, and status remain available. An empty finding
list is never called clean when the report is incomplete, stale, running, or
unavailable.

## Wireframe acceptance checklist

Future implementation must demonstrate that:

- every desktop screen above has loading, empty where meaningful, permission,
  read-only, failure, and narrow-screen behavior;
- authentication, invitation, organization switching, and deep links render no
  protected tenant data before authorization;
- project creation covers prompt, template, and blank starts without hidden
  infrastructure defaults;
- Guided and Professional render one editor component/control tree with
  identical geometry, density, fields, order, stages, actions, shortcuts, and
  **Technical details** state; only assistance copy differs;
- the desktop editor keeps a full-canvas background behind the persistent,
  resizable 336px Catalog, fixed 92px Inspector launcher, and fixed 48px
  Workspace launcher; at most one rich popup is open across all destinations;
- Architecture opens as its own popup, while Configure, Connect, Learn, IaC,
  Assistant, Issues, Code, Activity, and Jobs reuse the same compact popup frame
  with shadows, padded close controls, 160ms motion, reduced-motion behavior,
  internal scrolling, and focus restoration;
- every service starts compact on editor-session open or reset and can expand
  from its 176-by-72 icon-and-name projection; compact inputs stay left, outputs
  stay right, no more than two aggregate dots are visible, exact handles remain
  bound, and hover or focus names the represented groups;
- Architecture resource details and the selected-resource summary start
  collapsed, retain exact accessible names and validation focus handoff, and
  leave Inspector tabs immediately reachable;
- double-clicking a service opens Configure, while connection information opens
  beside its owning service without changing graph coordinates or hashes;
- the 152-by-104 minimap and canvas controls honor Catalog, launcher, and popup
  safe areas, and the local-fixture status is absent from production-backed
  project states;
- the editor exposes Catalog, canvas/list, all five Inspector destinations, all
  five Workspace destinations, save status, credits, validation, revision, and
  export state;
- both connection stages use the same fields and actions in both modes, expose
  exact evidence through **Technical details**, show complete atomic effects,
  and never permit partial application or silent cleanup;
- validation current/stale/incomplete states and all severities are textually
  distinct;
- revision and artifact screens cannot mutate immutable content;
- code/diagram review and ZIP/GitHub export stay bound to the exact reviewed
  artifact;
- Stripe-return, credit, plan, limit, and entitlement states are not conflated;
- tablet and phone retain review, findings, job, revision, and export truth
  while explicitly deferring precision construction; and
- status, focus, edge meaning, provenance, selection, and available actions do
  not depend on color, icon, hover, pointer drag, or canvas position alone.
