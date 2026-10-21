# Reviewed Go validation tools

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

This recipe replaces vulnerable upstream release binaries with reproducible
Linux amd64 builds of exact public source commits. It is part of credentialless
image preparation before AWS OIDC. It has no customer content, AWS credentials,
GitHub token, deployment authority, plugins or user-provided build flags.

| Tool      | Version | Commit                                   | Changes                                                              |
| --------- | ------- | ---------------------------------------- | -------------------------------------------------------------------- |
| Terraform | 1.16.2  | 82e042fb6372443813f6759056308d6adc642fa1 | Go 1.26.8; upstream dependencies unchanged                           |
| TFLint    | 0.64.0  | 15c65a33b322750f6131e286cd9597896299ba32 | Go 1.26.8; reviewed x/crypto, x/mod, gRPC and required closure patch |
| Trivy     | 0.74.0  | e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994 | Go 1.26.8, jsonv2; reviewed gRPC and required closure patch          |

The Dockerfile pins the actual Go image digest. recipe.sh verifies complete
source archives, exact patches and module manifests. Only public module
acquisition uses network access. Compilation uses a separate network-disabled
layer, readonly module resolution, CGO disabled, trimpath and no VCS/build ID.
The final layer checks the expected binary SHA-256 before exporting any output.
No test, go generate, install hook or source-provided shell command is executed.

[scripts/beta-go-tool-builds.mjs](../../../scripts/beta-go-tool-builds.mjs)
checks the recipe files, source bytes and output binaries/licenses again. It
uses a private build context and Docker configuration. Its closed tool set
cannot be extended by an acquisition descriptor. The same verified Trivy output
is reused across both image contexts within one preparation run.

The builder retains import lists and Go build metadata as supplemental evidence.
Only binary and upstream license outputs enter runtime contexts. Runtime egress
remains denied, and source-build binaries still require final image scans and
isolated self-tests. No image is admitted solely by a source-build checksum.

Current measured evidence and remaining admission checks are in the runner plan.
