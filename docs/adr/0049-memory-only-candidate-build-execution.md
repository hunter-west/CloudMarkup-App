# ADR-0049: Memory-only candidate build execution

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-09-12
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

Temporary candidate source and unaccepted model output must not enter host
files, persistent Docker storage or logs. The existing application executor uses
host temporary files and bind mounts; the Terraform executor also uses a default
disk-backed volume. Their deterministic validation remains useful, but they
cannot satisfy this storage boundary.

[ADR-0030](0030-nodejs-typescript-lambda-starter-runtime.md) fixes the
application runtime and command matrix.
[ADR-0037](0037-deterministic-multi-artifact-application-build-batches.md)
requires actual per-workload results and artifacts. Proposed
[ADR-0045](0045-memory-only-ai-previews.md) records non-replayable content and
metadata-only receipt semantics. This decision implements a separate local
execution option and does not grant model, tenant, promotion or deployment
authority.

## Decision

Add an opt-in application executor behind the existing data-only workspace
interface. Keep existing public requests, results, evidence and the historical
local executor compatible. The application runner continues to validate actual
tool output and produce deterministic packages and request/revision/source-bound
evidence.

A separately versioned image helper uses only fixed probe, seed, inspect, prune,
collect and bounded holder operations. Source/lock bytes enter through bounded
stdin; collected regular-file bytes return through separately bounded stdout.
Commands, environment and diagnostic streams contain no candidate content. A
prepared successor image identifies exact helper bundle bytes and a
digest-pinned existing tool-image base. No mutable image tag or arbitrary helper
is admitted.

Two explicit local-driver tmpfs mounts hold workspace/dependencies/build output
and scanner cache. A bounded holder keeps the mounts alive between isolated tool
containers. Verify exact volume options, ownership, image and container
controls, then inspect actual kernel mount information before sending source.
Reject disk-backed/default/ambiguous storage and fallback. Preserve actual
per-step read-only mounts and shared source/dependency/file guards; verify
collected bytes against the inspected authority.

All containers use no network, read-only root, non-root UID/GID 65532, no
capabilities, no new privileges, disabled Docker logging, fixed
CPU/PID/memory/time/byte limits and disabled core dumps. tmpfs requires noswap.
The trusted native Linux host must have no active swap, disabled process core
dumps, an explicitly reviewed non-receiver core_pattern (core or core.%p), and
no automatic Node heap snapshot persistence. The helper must report the same
kernel boot identity as the parent. Thus this mode rejects Docker Desktop,
remote daemons, active swap and unsupported tmpfs kernels without changing host
settings.

The optional proof workflow may prepare its fresh GitHub-hosted Ubuntu VM before
any candidate exists: verify the hosted Linux/repository environment, disable
swap, select the non-receiver core filename and set a process core limit of
zero. It then runs unchanged admission and stops on any failure. This exception
applies only to the disposable CI VM; no local/user host or persistent boot
configuration is changed. The executor never performs this preparation itself.
Actual first-run active-swap denial and exact command/order negatives are
preserved in the historical PR16 Linux proof plan at committed source 920956f
(private historical evidence, omitted from this distribution).

Application admission cannot prevent a privileged external host operator,
hypervisor snapshot, hibernation or machine crash recorder from capturing
memory. Those facilities remain outside the application trust boundary and must
not capture candidate content in an admitted environment. No unsupported
environment is described as proven RAM-only.

Before returning success, remove only exact owned containers/volumes and verify
absence. Failure to prove cleanup blocks success. Failed sessions cannot
continue or collect artifacts; cleanup remains retryable. Never substitute
successful metadata from the existing whole-build service for actual produced
package bytes.

## Consequences

### Positive

- The deterministic runner and evidence semantics remain authoritative.
- No candidate-bearing host files, default volumes, process arguments, inherited
  credentials or Docker logs are needed.
- Current source/dependency ownership and per-step isolation checks are reused.

### Negative

- Requires a compatible native Linux/no-swap environment and a separately
  prepared, verified helper image.
- More container/control operations and a bounded holder are necessary to
  preserve per-step isolation.
- Unaccepted content is intentionally unavailable after disposal; only actual
  execution identity, counts and digest metadata may be retained.

### Follow-up

- Prove the actual mounts, stdin boundary, real tool sequence, deterministic
  artifacts and cleanup using the opt-in Linux harness.
- Record exact image/helper identities and independently review the successor
  before activation.
- Bind actual results to the separately owned pre-result attempt lineage. This
  ADR creates no validation receipt or promotion authority.
- Evaluate Terraform reuse only after the application boundary is verified; its
  pinned provider requires executable scratch storage.

## Alternatives considered

### Existing temporary directories or Docker default volumes

They persist candidate bytes on host storage. Deleting them after execution does
not satisfy memory-only handling.

### Only mount /tmp as tmpfs

Source, dependencies and compiled output live in /workspace, so this does not
cover the candidate lifecycle.

### Run the existing whole-build service in one container

That service consumes and emits files, does not collect full artifact bytes, and
does not establish equivalent per-step read-only mounts. A future
single-container design needs independent authority and isolation evidence.

## References

- Execution plan
- [Application execution](../architecture/APPLICATION_BUILD_EXECUTION.md)
- [Terraform static validation](../architecture/TERRAFORM_STATIC_VALIDATION.md)
- [ADR checklist](CHECKLIST.md)

- [Linux core(5): RLIMIT_CORE and piped receivers](https://kernel.googlesource.com/pub/scm/docs/man-pages/man-pages/+/refs/tags/man-pages-6.11/man/man5/core.5)
