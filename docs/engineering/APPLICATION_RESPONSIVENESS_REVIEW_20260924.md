# Application responsiveness review (September 24, 2026)

## Scope and evidence

This review covers the M9 beta editor, AI proposal polling, project loading,
solution export admission, and verification. It uses local source inspection,
one uninstrumented representative editor run, two warmed web builds, and focused
Chromium scenarios. It is not a concurrent-user load test or a hosted latency
claim. The existing [beta baseline](BETA_PERFORMANCE_BASELINE.md) defines the
representative fixtures and remaining browser measurements.

| Observation                        | Local evidence                                                                                                                                                                                                 | Action                                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate desktop graph projection | The editor main view projected the document for its phone list even on desktop; the canvas projected it again. A 500-node, zero-edge projection took 137.72 ms in this local run.                              | Project the phone list only for phone posture. Desktop still uses the canvas projection.                                                                               |
| Repeated validation hashing        | `useEditorValidation` calculated document hashes in both initial state and render, including renders with the same document object. Autosave preparation for 500 nodes took 61.8 ms in the representative run. | Memoize hashes by document identity and reuse the first value for initial state. Validation still runs on content/hash changes and fails closed.                       |
| Hidden AI panel work               | Shared tabs mount hidden panels. Opening Issues could mount the AI proposal panel even before Assistant was selected.                                                                                          | Load the AI panel on first Assistant activation, retain it while switching tabs, and load the project creation review only when present.                               |
| AI status traffic                  | Durable proposal jobs were polled every 2 seconds for up to 10 minutes.                                                                                                                                        | Keep the first two polls at 2 seconds, then poll every 5 seconds. A minute-long job now schedules about 13 status reads instead of 30, depending on completion timing. |
| Large editor download              | Before changes, the production `EditorWorkspace` chunk was 2,044.45 kB (413.06 kB gzip); after changes it is 2,028.92 kB (408.94 kB gzip). The separate ELK worker remains 1,426.49 kB and loads for layout.   | Treat this as a small local chunk improvement, not a measured page-load gain. Profile the actual browser waterfall and long tasks before further splitting.            |

The slower steady-state polling can delay detection of a completed AI job by up
to 5 seconds; it reduces status requests rather than model execution time. The
same run measured 190.38 ms for dual validation and 161.13 ms for layout-request
preparation at 500 nodes. The fixture has no edges, so relationship-heavy graphs
still need browser profiling. Selection lookup alone was 0.11 ms. These are
one-run timings and not a latency budget.

## Canvas and export findings

The expanded service details panel was constrained by a measured viewport height
and its own scroll container. It now grows with its content, uses larger text
and controls, and compensates for low canvas zoom up to a bounded scale. Its
collapse control sits at the card top so a tall card cannot place that control
under the fixed workspace toolbar. Collapsed region, VPC, availability-zone, and
subnet boundaries use a compact transient canvas footprint; graph dimensions and
export meaning do not change. Focused Chromium scenarios cover visible details,
zoom, no inner scrolling, the header control, and compact boundaries. Very large
cards can still extend beyond the viewport and require canvas pan or zoom.

The reported export failure is an HTTP 504 on job creation. The browser
extension message shown with it does not identify the API failure. The beta
CloudFormation-export profile had a 25-second API timeout. The candidate raises
that bound to 29 seconds and overlaps independent immutable-object reads and
content-addressed writes in the synchronous admission path. A 504 can leave the
client uncertain whether admission succeeded, so the UI now retries it once
automatically and offers an explicit retry using the exact original idempotency
key. This is a bounded mitigation, not a verified production repair: hosted
request traces and a deployed run are needed to establish the cause and p95
latency. If admission still approaches the gateway limit, move expensive
preparation behind a durable queued response while preserving authorization,
immutable revision binding, and idempotency.

## Optimistic rendering and concurrency

The editor already applies a validated Graph Command to its local document
immediately and queues a server save. This is the useful form of optimistic
rendering for service add, delete, move, and configuration: the graph engine
validates first, Undo has an explicit inverse, and the draft save uses the
existing ETag and editing lease. The UI must continue to show save and conflict
state; a locally visible deletion does not assert that the server has persisted
it. Immutable revisions and exports remain based on their exact accepted
version.

Do not optimistically mark AI proposals, credit charges, revisions, or
deployments as successful. Those cross trust or immutable boundaries. AI
proposal admission is a short request followed by a durable job; the worker owns
model execution, and the browser reports queued/running state. Current server
controls include tenant authorization, an active editor lease per shared
project, idempotent job admission, commercial reservations, and a global model
dispatch spending fence. The one-editor-per-project lease is an intentional
product constraint, not a general multi-user throughput limit.

The beta stack reserves 25 concurrent API Lambda invocations, 10 general worker
invocations, and two each for proposal and solution-export workers. These are
invocation ceilings, not user-count estimates. A slow synchronous export
admission occupies one of the 25 API slots for its full request; moving that
preparation behind a durable queued response is more scalable than further
raising the gateway timeout if traces confirm it is the bottleneck.

There is no measured p95 for simultaneous users. Before increasing worker or
database capacity, run synthetic multi-project loads at 10, 50, and 100 active
users with no live model charge. Record project/draft read latency, save
conflict rate, status-poll QPS, queue wait, worker utilization, database
connections and lock wait, and browser long tasks. Then test a controlled
model-backed cohort separately under the existing spending fence. Changing queue
concurrency or the global reservation lock without that evidence could weaken
admission or merely move contention.

## Tests and deployment time

In this local run, the web Vitest suite took 97.06 seconds for 1,416 tests, the
backend Vitest suite took 141.14 seconds for 3,403 selected tests, and the main
Chromium profile took 4.2 minutes for 71 selected scenarios. The separate
prompt-26 Chromium profile took 2.7 minutes for 37 scenarios. A web production
build took 5.57 seconds. These warm-local numbers identify tests as the larger
verification cost here; they do not predict hosted runner time. The required
repository-wide coverage run took 2,398.02 seconds (about 40 minutes) with 8,450
passes and 1,461 configured skips. Its runtime is the clearest local reason to
keep full coverage in the separate diagnostic cadence while retaining the same
core tests in the delivery selection.

The source baseline at `b975e584` already keeps all eight selected test shards
but removes V8 instrumentation from deployment verification; diagnostic coverage
runs on a weekly/manual credentialless profile. Test-only source pushes can skip
deployment only through a fail-closed complete-diff classifier. The subsequently
verified [beta release](../PUBLIC_STATUS.md) used 177.3 predeployment runner
minutes versus 234.4 in the preceding attempt, about 24% less. The preceding
attempt stopped before deployment, so wall times are not comparable. That
release predates this branch; no hosted gain from these editor changes is
claimed.

The long proposed-model accounting shard is expensive, but it protects credit,
pricing, quota, and dispatch admission. The editor and AI changes here do not
justify dropping it or weakening security, tenant, graph-command, or compiler
tests. Existing local caches and focused workstream gates are the fast feedback
path; one full `pnpm check` remains the prompt-boundary evidence. Future test
removal should start with per-file duration and duplicate-assertion evidence,
then retain the core behavior in a smaller deterministic test before changing
any gate.

For the next performance pass, prioritize the relationship-heavy browser profile
and a production-like concurrent API test. The large editor and catalog chunks
suggest more code splitting may help, but the small local chunk reduction above
is insufficient to justify another broad split without a network waterfall and
interaction measurement.
