# Anonymous Linux normalization proof transport

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

This is a proposed, unexecuted proof launcher outside the compiler distribution.
It adds no module, dependency, public compiler command or application endpoint.
The unchanged compiler remains the only normalization authority.

## Parent protocol v1

The trusted parent selects the exact reviewed Linux launcher and compiler paths
and SHA-256 bytes before inputs exist. The Windows executable digest
747238ea51ce28ded212d300718aeb5539a44bf8bd8113d109a9a2cde4ab7fc3 is not a Linux
executable pin. Independently observe and admit the actual Linux bytes.

Invoke only the fixed launcher with --compiler and --compiler-sha256. Its input
and output must be anonymous pipes or unnamed local AF_UNIX socket pairs.
Regular files, named FIFOs, TCP sockets and unknown descriptor kinds are denied.
Parent stdout/result consumers must remain in RAM, never redirected to a host
file, process logger or persistent Docker volume.

The launcher reads no stdin before it has:

1. Read native Linux boot/kernel, no-active-swap and core policy.
2. Required RLIMIT_CORE soft zero and exactly core or core.%p (with optional
   newline); pipe/socket/unknown receivers are denied even with a zero limit.
3. Opened the absolute compiler path with O_NOFOLLOW, verified its regular
   executable size (1..128 MiB), exact SHA-256 and actual read-only mount via
   fstatfs ST_RDONLY. A writable directory with mode 0555 is insufficient.
4. Launched its fixed public-marker self probe through ExtraFiles: os.Pipe
   readers at fd3/4/5 and exact held executable fd6. The child must reopen all
   three procfs input paths, read each marker, and match fd6 to /proc/self/exe.

Then it emits one JSON READY line (maximum 1,024 bytes):
kind=cloudmarkup.anonymous-normalization.v1, phase=ready,
compilerSha256=<exact admitted hex>, kernelBootId=<actual boot UUID>. Only after
validating that line and the parent's own admission may the parent call the
fixed source factory and canonicalize the three inputs.

The single binary stdin message is:

- Eight ASCII bytes CMNORM1 followed by newline (the literal string has eight
  bytes total: C M N O R M 1 LF).
- Exactly three frames in architecture/workload/solution-revision order.
- Per frame: uint32 big-endian length, raw 32-byte SHA-256, then exact payload.
- Each payload is 1..1,048,576 bytes. No optional frame, fourth frame, trailing
  byte or missing EOF is accepted. The maximum message is 3,145,844 bytes.
- The parent owns canonical JSON/version/revision semantics. The launcher
  verifies wire digests; the actual compiler independently validates documents.

The fixed compiler argv is:

```text
normalize
--architecture /proc/self/fd/3
--workload /proc/self/fd/4
--solution-revision /proc/self/fd/5
--target terraform
--output -
--max-input-bytes 1048576
--max-output-bytes 2097152
```

The held, hashed compiler descriptor is fd6 and the actual exec path is
/proc/self/fd/6. No candidate byte enters argv, environment or content files.
The only child environment is GOTRACEBACK=none. There is no shell or
normalization/compile/target/filename choice in the payload.

Three joined writers support the CLI's actual sequential input reads. Compiler
stdout and stderr are separately bounded to 2 MiB and 64 KiB. A single overall
30-second context covers admission, input, execution and output. Cancellation,
broken pipes and output overflow terminate the held direct child through Go
Process.Kill and close blocked writers; command Wait joins output readers and
all three writers are joined. Go WaitDelay allows at most one second to close
inherited output pipes during cancellation cleanup. No failed/partial compiler
output is returned.

Success requires exit0, empty compiler stderr, nonempty valid JSON, joined
process/writers and matching post-execution host admission. It emits a JSON
result metadata line (maximum 2,048 bytes), followed by exactly stdoutBytes raw
compiler bytes and process EOF/exit0. Metadata fields are kind, phase=result,
compilerSha256, inputs (fixed kind/byteLength/sha256 for all three),
stdoutBytes, stdoutSha256 and stderrBytes=0. Raw output is forwarded only to the
parent's bounded RAM parser. Its schema and full normalized-model parity remain
parent checks, not assertions invented by the transport.

Failure attempts only anonymous-normalization:<closed reason> on stderr and
exits nonzero; no raw error, path, command stderr, partial JSON or stack is
forwarded. Reasons are admission, input-protocol, compiler, deadline,
output-limit, transport, internal or failed. Non-Linux emits
unsupported-platform. Best-effort buffer clearing is not a claim of forensic
memory erasure.

## Concrete proof composition and limits

The trusted parent must establish a pre-acquired, exact public Linux tool
environment with an independently inspected network-none namespace, disabled
logging, read-only root, non-root user, no capabilities, no new privileges,
bounded CPU/PID/memory, zero core limit, and no host memory capture. It must
provide actual read-only bind mounts for both verified public executables and
public repository/dependency bytes. Any writable temporary/cache location must
be verified tmpfs with noswap, with no disk-backed fallback. Do not change host
swap/core/daemon settings from this launcher.

The launcher does not enforce network namespaces. Its fixed source has no
network API, but no-route heuristics or an environment string cannot establish
network-none isolation. The parent must retain actual namespace/container and
mount admission metadata, exact tool/image/source hashes and boot identity. A
Docker Desktop/remote daemon/host-paged VM, active swap, unknown core policy,
writable compiler mount or missing admission fails before READY.

The private
[proof parent](../../apps/api/src/native-normalization-proof-parent.ts) uses the
current zero-argument fixed seed factory only after real READY. The
[supervisor](../native-normalization-proof.mjs) independently inspects the exact
parent container, its native same-daemon boot, mounts, image and public tool
hashes. It permits success only for that exact container ID in exited state,
with complete metadata and confirmed owned cleanup. Neither an environment
opt-in nor an unrestricted test reporter supplies proof authority.

The parent compares the entire goCompilationResultV1Schema normalizedSolution,
including solutionRevisionId and compatible-interface-only generator readiness,
without omitted fields. It requires no error diagnostics, no artifact and exact
compiler descriptor cloudmarkup.iac-compiler 1.1.0 /
sha256:13a76e103fed8783d043a0a308b579424d52c7170a7ecf646b8cf232f1b47e34. Only
the bounded closed report reaches the supervisor; source and model output stay
in anonymous pipes and RAM.

The earlier full-normalization API integration test remains preserved and unrun
in the original ignored proposal. It is excluded from this integration because
its unrestricted Vitest reporter is not native proof authority. Parent and
supervisor focused tests pass all 25 cases; these checks do not execute a full
native proof. Actual native/compiler and full-model proof remain blocked on
exact publication approval and admitted native execution. See the parent proof
plan.

## Executed public R3 evidence and remaining native gate

Pinned Go 1.26.8 compiled and vetted the exact ten Go files. The focused public
Docker run passed seven executable top-level groups and 13 subcases in 1.740s;
one actual-native/compiler opt-in was explicitly skipped. The test binary SHA256
is 9cb001193df8d3e309f72732026b22d12e30d302e43d97f4a59d1c9bfedfe82c. The
inspected network-none/read-only public test container was removed and its
absence checked. No compiler input, fixed seed or model content was supplied.

The initial recipe timed out at Docker image inspect after successful Go build
and vet; its original stale go-vet stage label has a preserved correction. The
unchanged container retry passed pipe controls but failed all five AF_UNIX modes
(15 top-level groups passed, one failed, one native opt-in skipped). Pinned Go
loses the kernel sockaddr length when returning a Unix socket name. R3 checks
raw local and peer AF_UNIX addresses for exact unnamed length two, with
connected SOCK_STREAM checks; it rejects named and abstract endpoints. The
passing focused cases include all ten inherited pipe/socket modes, exact caller
flag restoration, duplicate-descriptor denial, filled diagnostic output, and
named/abstract socket denials. Original failures and source snapshots remain.

Public transport success is not actual native/compiler or full-model proof.
Those gates remain blocked on exact publication approval and an independently
admitted native environment with real read-only executable mounts, reviewed
Linux tool pins, same-daemon isolation and complete cleanup evidence. No proof
bundle, native execution or workflow publication is authorized by this record.

## Source correction r2: inherited blocking descriptors

The original unexecuted proposal used os.Stdin/os.Stdout directly and closed
those inherited wrappers on context cancellation. Pinned Go 1.26.8
os/file_unix.go newFileFromNewFile reads descriptor flags; kindNewFile does not
select the runtime poller unless O_NONBLOCK is already present. Closing a
blocking inherited wrapper is therefore not a demonstrated interruption
mechanism. This was a source-backed concern, not a reproduced Linux hang.

The revised launcher admits both descriptor kinds and identities first, then
uses SyscallConn.Control and F_DUPFD_CLOEXEC to create owned duplicates. It sets
O_NONBLOCK before os.NewFile and requires actual
SetReadDeadline/SetWriteDeadline support before READY. The same overall context
deadline covers those wrappers; cancellation closes only owned descriptors. Once
synchronous I/O and the watcher are joined, release closes the wrappers, checks
original identity and restores/verifies exact original F_GETFL status through
the caller's live SyscallConn. Caller descriptors are never closed.

A duplicate shares its open-file description and O_NONBLOCK status. The caller
therefore grants exclusive use of stdin/stdout for the entire call. It must not
read/write, close, call Fd or mutate flags concurrently. Same-identity input and
output (including one bidirectional AF_UNIX socket duplicated into both) are
explicitly denied before mutation; ordinary separate Node socket pairs remain
supported. The transport never pretends duplicated status flags are independent.

The actual-subprocess test source starts with inherited BLOCKING fd0/fd1 from
raw pipe2 or unnamed AF_UNIX socketpairs, not only pollable os.Pipe wrappers.
Ten cases cover both transports, normal success, stalled input, filled output,
deadline and cancellation, plus exact caller identity/open/status restoration. A
separate duplicated-socket case verifies pre-mutation denial. Another actual
subprocess receives a filled, undrained blocking stderr pipe: the one bounded
raw nonblocking diagnostic write drops on EAGAIN, restores caller flags and
returns without waiting. Unsupported regular-file/TTY/network diagnostic
transports are silently dropped. Missing/truncated diagnostics never authorize
success; the parent requires complete result bytes and exit0.

The former raw kill(-pid) override is removed. Go Cmd.Wait reaps before joining
watchCtx, while raw numeric group signaling bypasses Process.Kill's PIDFD/status
protection. The fixed normalizer and public probe do not launch descendant
commands. Default CommandContext Process.Kill, Pdeathsig, WaitDelay and joins
therefore provide direct-child cleanup; arbitrary process-tree supervision is
not claimed. This change addresses source-backed ownership risk without claiming
an observed unrelated-process signal or inventing PID reuse evidence.

At the r2 source-review checkpoint these tests were unexecuted. The preserved
execution failures and the passing R3 public correction are recorded above.
Actual native/compiler and full-model proof remain unexecuted. Original proposal
patches and inventories are preserved in the ignored provenance folders.
