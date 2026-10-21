# AI extension generation

`@cloudmarkup/ai-extension-generation` coordinates review-only application and
IaC candidates. It treats ModelGateway output as untrusted, materializes files
only inside a restricted content-addressed boundary, runs deterministic parsers
and the fixed isolated validation runners, creates Evidence and Active Issues,
permits a bounded repair loop, and requires an explicit digest-bound user
decision.

The package cannot write or materialize a repository, mutate a source Solution
Revision or canonical design, replace a deterministic generator or compiler
artifact, run arbitrary commands, access credentials or cloud accounts, plan,
apply, create change sets, or deploy. Acceptance returns a distinct immutable
successor Solution Revision and immutable export input binding the accepted
`AiAuthoredExtensionV1`, exact restricted artifact, Evidence, ordered
model/prompt/usage attempts, ownership lineage, and user edits. It does not
persist either record or grant deployment authority.

CloudFormation validation is bounded to exact injected, recursively closed
reviewed resource schemas, strict intrinsic/reference grammar, and recursive IAM
wildcard controls. Acceptance requires target-readiness authority for the exact
candidate and target; general deterministic compiler support alone is
insufficient.

Review records expose the exact product flow:

```text
Generate
→ Check
→ Fix automatically where safe
→ Review remaining issues
→ Accept candidate
```

The coordinator awaits each bounded, strictly sequenced live generation,
validation, repair, or rejection snapshot. These snapshots form a verifiable
prefix containing exact artifact/review/bundle digests, current issues, and
append-only history. Terminal generation creates one immutable
`CandidateGenerationProgressFinalizationV1` seal over that full prefix, terminal
snapshot/result, and final Evidence/issues/history counts and digests. Neither
the live prefix nor the terminal seal has write, repository-write, or deployment
authority.

Inspect, edit, accept, reject, and deterministic-fix application call a
host-owned `CandidateReviewAuthorizationPort`. An allowed decision must derive
from verified authentication context and bind the exact action, principal,
organization/project, review, artifact digest, and source revision. Request and
model data cannot grant reviewer authority.

The artifact store binds each artifact to exactly one immutable review identity
and digest. Every operation rejoins that binding. Edited acceptance additionally
uses immutable historical reads to verify every predecessor review, artifact
lifecycle transition, validation replay, and append-only edit-revalidation
authority.

Inspection exposes only the exact authorized bytes. Editing rehashes owned
content, replays the original safe context and full target validator, and
creates fresh Evidence, issues, artifact, and review identity before one atomic
stale-safe store supersession. The predecessor and original model artifact
remain immutable, successful repeated edits append exact authorization and
per-file lineage, and failed or racing edits leave the predecessor current. The
generation finalization seal is never rewritten. Every successful edit appends
an immutable `CandidateEditRevalidationFinalizationV1` binding the exact edit
decision, cumulative file lineage, parent artifact/review/seal, validation
result, and monotonic Evidence, issue-history, and current-issue prefixes.

Acceptance and rejection authorize the exact current review, then reread the
current artifact and immutable review binding; concurrent supersession fails
closed. Edited acceptance also verifies the complete immutable predecessor chain
and every append-only revalidation authority before creating its successor.

The bounded review component uses the same tree and authority across assistance
preferences. Primary issues are plain English. Optional **Technical details**
show files and ownership, schema pins, tool diagnostics, model/prompt
provenance, and exact fix references. The bounded context also shows
assumptions, unresolved questions, expected tests, Evidence, and ordered
privacy-safe attempt summaries without raw provider-attempt prompts, responses,
repair sections, secrets, or unrestricted diagnostics. The strict adapter is
mounted on the existing artifact-review route with host-supplied authorized
records. Its surface exposes only edit and accept callbacks; authorized
inspection and rejection remain package operations outside that callback
contract. Stale or malformed review, inspection, replay, route, or file
authority fails closed without exposing candidate bytes.

Passing application candidates require rank-4 candidate parse/static Evidence
and rank-5 application build/test/security Evidence. Terraform and
CloudFormation candidates require exact rank-4 Evidence and never inherit or
fabricate deterministic-compiler Evidence. Required failures and blocking
unresolved items become Active Issues; exhausted repair stays reviewable and
cannot be accepted.

Issue history is append-only: a complete superseding assessment marks missing
issues stale instead of deleting them, and only exact issue-linked passing
Evidence may resolve one. `applyReviewedDeterministicIssueFix` first requires
the host port to allow the exact `apply-deterministic-fix` action and canonical
operation digest bound to scope, review, artifact, source revision, current
issue record, and source hashes. Its pure Graph Command v1 result derives
`reviewedBy` from that decision and returns the decision ID, exact changes, and
an inverse but no persistence or deployment authority. AI-only fixes are
rejected and otherwise remain proposals until complete validation passes.

Before provider invocation, the coordinator binds one trusted commercial
reservation, the accepted workflow estimate, and every generation/repair
idempotency context. Existing file bodies are allowed only for exact editable
owned paths; protected deterministic files remain digest metadata. Attempt
records preserve exact provider/model/prompt/version/usage provenance and
distinguish the raw model-response digest from the deterministic merged bundle
digest. Invalid structured generation or repair output stops safely with an
Active Issue and restricted marker while ModelGateway retains any raw output
under its diagnostic policy. Hosted loading, durable persistence, reconnection
and verified authentication are host-owned composition responsibilities; this
package does not supply their authority. See
[current status](../../docs/PUBLIC_STATUS.md) for enabled product flows and
remaining operational holds.

Ordinary local and CI tests use deterministic queued gateway responses, fake
restricted stores/executors, and injected reviewed schemas. No live model,
credential, repository write, Terraform plan/apply, CloudFormation change set,
or deployment is required.
