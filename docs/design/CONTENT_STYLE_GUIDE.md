# Content Style Guide

> **Specification status:** This guide defines normative product copy. Current
> implementation, activation and release evidence are recorded in
> [Project Status](../PUBLIC_STATUS.md).

## Purpose

Cloud Markup content must help a person make an informed architecture decision
without overstating what the product, provider catalog, validation engine,
compiler, or export pipeline knows. The voice is calm, direct, respectful, and
specific. It teaches cloud concepts without treating the reader as careless or
inexperienced.

This guide applies to interface labels, onboarding, explanations, findings,
dialogs, notifications, job states, billing and usage, diagrams, documentation
generated for artifacts, and accessible names. It works with
[Guided and Professional Modes](GUIDED_AND_PROFESSIONAL_MODES.md) and does not
replace authoritative domain or provider text.

## Voice principles

### Accurate before reassuring

State the known result and its scope. Do not soften an incomplete, unsupported,
failed, stale, or denied state into apparent success.

- Prefer: “Validation stopped before all rules ran.”
- Avoid: “Everything looks good so far.”

### Respectful, never condescending

Explain the consequence, not the user's presumed skill level. Avoid childish
metaphors, praise for routine choices, scolding, jokes about mistakes, and
phrases such as “easy,” “obvious,” “just,” or “don't worry.”

- Prefer: “This connection needs permission to write to the table.”
- Avoid: “Don't worry, we'll handle the complicated IAM stuff for you.”

### Concrete and actionable

Name the object, state, evidence, and available next action. Use the catalog
display name for a service and the exact technical identifier only where it
helps inspection.

- Prefer: “The Lambda function has no execution-role attachment. Select a
  reviewed role connection.”
- Avoid: “Your permissions need attention.”

### Honest about authority

Use “the change preview proposes,” “the catalog declares,” “validation found,”
and “the compiler generated” according to the source. Do not imply that AI,
presentation logic, or an external provider approved a result.

User-facing shell, status, proposal, validation, and error copy remains
brand-neutral until final naming is approved. Prefer “the editor,” “the
workspace,” “the change preview,” or the named catalog/validation source.
Internal package, migration, and compatibility identifiers are not rewritten to
achieve display neutrality.

### Concise, with detail on demand

Lead with the minimum information needed to understand the state. Make evidence,
paths, version pins, and exact operations available without burying the next
action.

## Explanation structure

User-facing explanations follow the same five-part information model, even when
a compact surface shows only the first lines:

1. **State:** What is known, unknown, proposed, changed, or failed?
2. **Consequence:** Why does it matter for this architecture or action?
3. **Evidence:** Which rule, graph location, catalog declaration, revision, or
   job supports the statement?
4. **Action:** What can this authorized user do next?
5. **Scope:** What has not been checked, applied, priced, or verified?

Both modes keep the five parts in the same control and evidence order. Guided
copy may add a plain-language sentence, example, or definition inside the
corresponding assistance slot. Professional copy may lead that slot with the
exact term and use fewer words. Neither variant reorders a field, evidence row,
action, dialog stage, or confirmation.

## Canonical terminology

Use these terms consistently. Do not substitute a friendlier term when it would
change domain meaning.

| Term                        | Required meaning and usage                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Intent Document**         | Versioned, provider-neutral reviewed needs, assumptions, unknowns, decisions, and alternatives. Never call it an AWS plan.                                                                                       |
| **Architecture Document**   | Typed, versioned source-of-truth graph. Use **architecture** in ordinary copy after the source-of-truth distinction is clear.                                                                                    |
| **Workload Behavior**       | Versioned declarative implementation intent bound to stable graph identities. It is not source code, a prompt, or proof that generation/build is available.                                                      |
| **draft**                   | Mutable working architecture. A draft can be saved and validated, but it is never compiler input.                                                                                                                |
| **revision**                | Immutable architecture snapshot with explicit version pins. Do not use **version** as a casual synonym when immutable revision identity matters.                                                                 |
| **artifact**                | Immutable output bound to one revision. Name the artifact type when possible: diagram, IaC, application-source, built-workload, or combined artifact.                                                            |
| **node**                    | A typed graph element. Prefer the catalog service display name in Guided copy; use **node** when discussing graph mechanics.                                                                                     |
| **port**                    | A typed connection endpoint. Do not call every port a network port.                                                                                                                                              |
| **connection**              | User-facing relationship between compatible endpoints. Use **edge** for graph evidence and technical paths.                                                                                                      |
| **boundary**                | Explicit placement or grouping construct. Do not imply physical containment for associations.                                                                                                                    |
| **supporting resource**     | Element generated by a reviewed connection rule and carrying provenance. Do not describe it as disposable.                                                                                                       |
| **proposal**                | Untrusted AI or wizard output awaiting deterministic validation and any required approval. Never call it an applied change.                                                                                      |
| **Graph Command**           | Versioned deterministic mutation request with preconditions. Use **change** in primary Guided copy and expose the exact command in details.                                                                      |
| **finding**                 | Version-bound validation result with stable identity, severity, location, and explanation. Do not use **issue** to erase a non-error severity.                                                                   |
| **validation report**       | Results and completeness for one exact document state. No findings is clean only when the report is complete and current.                                                                                        |
| **security-error**          | Current security-relevant invalid-condition severity. Do not call it blocking unless application policy separately says so.                                                                                      |
| **compile**                 | Deterministically transform one immutable revision into an IaC artifact. It does not deploy or verify a cloud account.                                                                                           |
| **generate starter source** | Deterministically create supported reviewable application source from an immutable revision and pinned workload/template inputs. Never shorten this to **compile** or imply arbitrary business-logic generation. |
| **build workload**          | Run an explicitly supported source artifact through a separate isolated, pinned runtime toolchain. It is not IaC compilation, export, or deployment.                                                             |
| **export**                  | Deliver an already reviewed immutable artifact as ZIP or through an authorized GitHub workflow. It does not deploy or merge.                                                                                     |
| **deploy**                  | Apply infrastructure to a cloud account. The application does not deploy in the first release.                                                                                                                   |
| **Cloud Markup credits**    | Customer-facing organization allowance. Do not equate credits with raw provider tokens or billing usage.                                                                                                         |
| **AWS cost**                | Potential customer-cloud charge. Keep it distinct from application subscription price and Cloud Markup credits.                                                                                                  |

### Glossary rules

- Expand an unfamiliar abbreviation on first use in a page, dialog, or
  self-contained exported summary: “Infrastructure as Code (IaC).”
- Guided copy may lead a shared content slot with the plain-language
  description: “Permission policy (IAM policy).”
- Professional copy may lead that same slot with the exact term and keep the
  concise definition available. The control label, accessible name, placement,
  and surrounding content order do not change.
- Never make a tooltip the only source of a required definition, consequence,
  error, or action.
- Use the catalog's `displayName`, relationship names, configuration labels, and
  education text. Do not derive user-facing names from opaque IDs.
- Say **Starter generation is not available in this milestone** when only
  generated-starter intent exists. Do not say **code ready**, **generated**, or
  **build ready** until the named immutable artifact and evidence actually
  exist.
- Keep one term for one state. In particular, do not interchange **saved**,
  **revision created**, **compiled**, **verified**, **exported**, and
  **deployed**.
- Link to official provider documentation only when the reviewed catalog or
  finding supplies that reference. Label external links with their publisher.

## State and action language

### Saving and conflicts

Use the exact state:

- **Saved** — the current accepted draft version is acknowledged by the
  authoritative persistence boundary.
- **Saving** — an accepted local command is awaiting acknowledgement.
- **Queued offline** — the change remains local and has not reached the server.
- **Conflict** — the saved draft advanced and local work was not overwritten.
- **Save failed** — the attempted persistence did not succeed.
- **Read-only** — capabilities allow review but not mutation.

Never use **Saved** for a queued, conflicted, or failed change. A conflict
message names both available states without claiming which one should win.

### Validation

- Say **Complete — no findings** only for a complete, current report with no
  findings.
- Say **Validation incomplete** whenever an engine diagnostic, missing
  inventory, or failed rule prevents full evaluation.
- Say **Results are stale** when the report belongs to an earlier draft version.
- Preserve the rule-provided severity. Do not promote a warning to an error for
  emphasis or demote an error to make a screen reassuring.
- Do not call `security-error` or `error` **blocking** until the future
  product-wide gating policy supplies that status.
- Use **Reviewed this session**, not **accepted**, **waived**, **acknowledged**,
  or **suppressed**, for the bounded local warning-review affordance. State that
  it does not change or hide the finding and does not establish a gate.
- Pair it with **Warning acceptance — Not available** while product-wide
  acknowledgement, suppression, and revision-gating policy remains unresolved.
- Keep **Structurally valid**, **No error or security-error findings**,
  **IaC-ready revision — Not available**, and each target's **Not ready** result
  separate. Never collapse them into **ready**, **secure**, or **deployable**.
- Pair every local readiness summary with the bounded statement that a valid
  diagram is not proof of security for every production context.

### Jobs and artifacts

Use **Pending**, **Running**, **Succeeded**, **Failed**, **Canceled**, and
**Retry available** only when supported by the authoritative job state. A
succeeded compilation can still have a separate static-validation result.

Use **Ready to review** for an artifact that exists but has not completed the
user's review flow. Use **Exported** only after the export record confirms that
the exact immutable artifact was delivered or published.

### Authorization and tenancy

Denied copy must not confirm whether a cross-tenant organization, project,
revision, artifact, invitation, repository, or member exists.

- Prefer: “You cannot access this page with your current account.”
- Avoid: “Project Apollo belongs to another organization.”

Name a missing capability only after the server has safely authorized disclosure
of the current tenant context. Route parameters are selectors, never proof of
identity or permission.

### Billing and entitlements

Stripe-hosted Checkout or Customer Portal return state is informational. Use
copy such as “We are waiting for confirmed billing status.” Never say a plan is
active, an export is unlocked, or credits were added until the local
webhook-derived subscription projection and entitlement checks confirm it.

The organization credit balance comes from the usage ledger. A reservation is
not a settled charge. If raw provider token or pricing information is useful, it
appears only to an authorized user through the opt-in technical disclosure;
Cloud Markup credits remain primary.

## Uncertainty, support, security, and cost

### Uncertainty and support

Use explicit, bounded language:

- **Unknown** means the authoritative input has no reviewed answer.
- **Not supported by this catalog version** means the pinned catalog does not
  declare the capability.
- **Descriptor only** means metadata exists but no reviewed executable resolver
  is available.
- **Mapping metadata only** means a target mapping is declared but no
  deterministic compiler implementation is proven.
- **Availability not reviewed for this Region** means region metadata is
  `unknown`; it does not mean available or unavailable.
- **Validation incomplete** means the product cannot state that the architecture
  is clean.

Never silently replace an unsupported service, relationship, Region, or target
with a nearby option.

### Security

Name the exact condition and scope. Explain the risk without claiming breach,
compliance, or complete security. Avoid echoing secret values, unrestricted
identifiers, prompts, thrown exception details, or sensitive architecture
content.

- Prefer: “The policy includes a wildcard action, which grants more actions than
  this reviewed connection requires.”
- Avoid: “This architecture is insecure.”

Use “reduces this identified risk” rather than “makes the architecture secure.”
Use “Validation did not evaluate this” rather than implying an absent check
passed.

### Cost

Keep three cost domains separate:

1. application subscription and entitlements;
2. Cloud Markup credits; and
3. possible provider infrastructure charges.

Do not call a service or operation **free**. If a reviewed estimate is later
available, identify currency, region, pricing source/version or retrieval time,
assumptions, and exclusions. Otherwise say “cost-sensitive choice” or “may
change AWS charges,” not a numeric prediction.

## Prohibited claims

Do not use these claims unless the named evidence and scope make the exact
statement true:

- **AWS-approved**, **AWS-certified**, **provider-approved**, or wording that
  implies provider endorsement;
- **deployed**, **live**, **running in AWS**, or **applied** for compilation,
  verification, download, or pull-request creation;
- **secure**, **fully secure**, **safe**, **compliant**, or **least privilege**
  as an architecture-wide guarantee;
- **free**, **no cost**, or **cost optimized** without reviewed, bounded pricing
  evidence;
- **production-ready** for a production-oriented catalog item, mapping metadata,
  an unverified artifact, or the product foundation;
- **validated** when validation is incomplete, stale, or only compilation
  succeeded;
- **supported** when a catalog entry is production-oriented, descriptor-only,
  metadata-only, region-unknown, rejected, or outside the pinned version;
- **saved** before authoritative acknowledgement;
- **subscription active** or **unlocked** based only on a browser redirect;
- **fixed automatically** before the exact deterministic command succeeds; or
- **deleted automatically** for a generated resource that may be shared,
  adopted, customized, or still referenced.

When a prohibited word is necessary in explanatory content, negate or qualify it
directly: “This application does not deploy this artifact.”

## Paired Guided and Professional examples

The wording differs; the facts and action do not.

| Situation             | Guided                                                                                                                                                                   | Professional                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| AI proposal           | “The assistant proposed three architecture changes. Review the assumptions and exact changes before applying them.”                                                      | “Proposal contains 3 Graph Commands. Review assumptions, preconditions, and the canonical change preview.”                                     |
| Explicit default      | “Encryption is recommended and will be saved as **On** if you apply this change.”                                                                                        | “Proposed command sets `serverSideEncryptionEnabled` to literal `true`; no value is applied yet.”                                              |
| Connection permission | “This function needs permission to write to the table. Review the exact actions and supporting policy before connecting.”                                                | “The resolved connection adds the catalog-declared table write actions through a generated IAM policy. Inspect the atomic batch before apply.” |
| Generated lifecycle   | “This policy was created for the connection. Removing the connection will keep it if another element uses it or you adopted it.”                                         | “Wizard-generated policy retains rule/version provenance. Release deletes it only at zero provenance dependencies and zero live references.”   |
| Incomplete validation | “Validation could not finish every check, so this draft is not confirmed clean. Review the diagnostic and retry.”                                                        | “Validation incomplete for this document hash. One or more rules did not execute; absence of findings is not a clean result.”                  |
| Security finding      | “This policy allows more actions than the reviewed connection needs. Limit it to the listed actions.”                                                                    | “`security-error`: wildcard IAM action exceeds the catalog-derived action set. Review the affected policy path.”                               |
| Region unknown        | “Availability for this service has not been reviewed in the selected Region. If a Region with reviewed evidence is offered, choose it or keep this question unresolved.” | “Catalog availability is `unknown` for the selected Region; do not treat it as supported.”                                                     |
| Save conflict         | “A newer draft was saved while you were editing. Your changes are still here; compare both versions before choosing what to keep.”                                       | “Draft precondition is stale. Compare local commands with the current persisted version; no overwrite occurred.”                               |
| Read-only access      | “You can review this project, but your current access does not allow changes.”                                                                                           | “Read-only capability: mutation commands are unavailable.”                                                                                     |
| Compilation success   | “Terraform files were generated from revision 12. Nothing was deployed to AWS.”                                                                                          | “Compilation succeeded for immutable revision 12 and the pinned compiler/catalog inputs. Deployment was not performed.”                        |
| Billing return        | “Checkout is complete, but access will change only after billing status is confirmed.”                                                                                   | “Return received; entitlements remain unchanged pending the webhook-derived subscription projection.”                                          |
| Low credits           | “Your organization may not have enough Cloud Markup credits for another request. Review usage or ask an owner about the plan.”                                           | “Available Cloud Markup credits are below the request estimate. No reservation has been created.”                                              |
| Unsupported export    | “This artifact cannot be exported to that target. Your reviewed revision is unchanged.”                                                                                  | “Target unsupported for the artifact's pinned format/version. No export record was created.”                                                   |

Examples containing technical actions must be populated from the actual catalog,
connection preview, validation report, command, revision, or job. Copy must not
invent identifiers for rhetorical precision.

## Interface-writing rules

### Labels and buttons

- Use sentence case: **Create revision**, **Review changes**, **Retry
  validation**.
- Start action buttons with a specific verb. Avoid **Yes**, **OK**, **Submit**,
  and **Continue** when the resulting action can be named.
- A destructive or consequential confirmation names the object and effect:
  **Release generated policy**, not **Confirm**.
- Use **Cancel** only when it safely exits without applying the pending action.
- Keep labels stable across modes when they name the same command. Additional
  explanation may differ.
- Do not place a required qualification only in placeholder text.

### Errors and notifications

- Put field errors beside the field and summarize them at the form start.
- Preserve safe input after a validation or service failure.
- State whether retry is safe, unavailable, or could duplicate an external
  action. Do not offer **Retry** unless the underlying operation is idempotent
  or explicitly protected.
- A toast is supplemental. Persistent or consequential state must remain
  available in the page, activity record, job view, or dialog.
- Do not expose raw stack traces, provider responses, secret values, opaque
  authorization reasons, or cross-tenant identifiers.

### Dates, quantities, and identifiers

- Show a user's local date/time with timezone where ambiguity matters; preserve
  an exact machine-readable timestamp in technical details when authorized.
- Pair percentages and counts with their denominator or scope.
- Label currency and billing period.
- Use human-readable labels before IDs. Provide copyable stable identifiers only
  where authorized and useful.
- Do not shorten digests so far that two visible values can be confused in the
  same context.

## Accessible content

- Every icon-only action has a stable accessible name that describes the action,
  not the icon shape.
- Link text identifies its destination; avoid repeated **Learn more** links
  without context.
- Alternative text communicates the purpose of an informative image. Decorative
  images have empty alternative text.
- Status text accompanies color, shape, line pattern, and icon cues.
- Instructions never depend only on spatial position, color, dragging, hovering,
  or hearing.
- Live announcements are short and factual. Persistent detail remains navigable;
  it is not repeated in full through a live region.
- Provider placeholders use the catalog display name in their accessible label.
  They never derive speech from an opaque icon ID.

See [Accessibility](ACCESSIBILITY.md) for interaction and announcement
requirements.

## Content review checklist

Before accepting copy, verify:

- the authoritative source and exact evaluated version are known;
- current, stale, incomplete, unknown, unsupported, and failed states are
  distinguished;
- the wording cannot be mistaken for deployment or provider endorsement;
- security and cost statements are bounded and evidence-based;
- Guided and Professional variants preserve the same control labels, placement,
  fields, evidence order, dialog stages, facts, and available actions;
- denial copy discloses no cross-tenant existence or sensitive detail;
- model output is labeled as a proposal;
- billing return state does not grant entitlement;
- terminology matches the table above; and
- the accessible name and persistent text communicate the same outcome.
