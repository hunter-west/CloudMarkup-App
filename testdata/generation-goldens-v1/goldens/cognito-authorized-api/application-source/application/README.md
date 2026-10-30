# Generated Cloud Markup application

This source tree was generated deterministically from an immutable Solution Revision. Generated files are replaceable only when their exact baseline digest matches. Files marked user-owned are never overwritten.

## Generation metadata

- Solution Revision: `solution_notes_revision_1`
- Generator: `cloudmarkup.application-generator@1.0.0` (`sha256:a102e772819d1d1657d89c422cd33d73912d62cabe4022b44e0cd3dd756af12e`)
- Template: `cloudmarkup.template.aws-lambda-notes-typescript@1.0.0` (`sha256:c7721961d935faa1e0c87b7356bc6d90112a02f3c7f716be33a648bf99740604`)
- Pattern: `cloudmarkup.pattern.aws-lambda-authenticated-notes@1.0.0` (`sha256:cbe772e0adee53da524110278fe908d726a3e8f600588364bef33ba2fa900571`)
- Runtime: `cloudmarkup.runtime.aws-lambda-nodejs24-typescript@1.0.0` (`sha256:6970ac7820ced534953ee1cda1b7fc083ab73fdb75e8c95c3c09967f4d3ff81a`)
- Catalog: `aws.cloudmarkup.notes-api-catalog@0.30.0` (`sha256:5dc9603e3df5a09835946dd11554aae5ece39803f12aee118f1227e9a591f619`)

## Workloads

- `notes_handler`: complete-supported-pattern; 1 represented operation(s).

## User-owned extension paths

- `application/src/functions/notes_handler/extensions/custom.ts` is user-owned and never regenerated; declared extension IDs: application.notes.extensions.

## Unresolved behavior

None represented by this source artifact.

## Build boundary

Prompt 29A does not install, compile, test, package, fetch, or deploy this source. The files under `application/build-contracts/` are the exact handoff to the isolated Prompt 32A builder. IAM remains derived from Architecture edges by the Terraform compiler, never from source scanning.
