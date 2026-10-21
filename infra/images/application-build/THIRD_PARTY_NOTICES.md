# Application-build image third-party notices

The image is assembled only from the following pinned authorities:

- the official Node.js 24.18.0 Alpine 3.24 image, distributed under the Node.js
  project and bundled-component licenses;
- Alpine Linux `libcrypto3` and `libssl3` 3.5.9-r0 packages from OpenSSL 3.5.9
  (Apache-2.0), installed from checksum-bound, Alpine-signed APKs;
- pnpm 11.16.0 (MIT);
- ESLint and @eslint/js 9.39.5 (MIT);
- typescript-eslint 8.65.0 (MIT);
- TypeScript 6.0.3 (Apache-2.0);
- Vite 8.1.5 (MIT);
- Vitest 4.1.10 (MIT);
- @types/node 24.13.3 (MIT);
- AWS SDK for JavaScript DynamoDB client 3.1101.0 and its frozen transitive
  closure (Apache-2.0); and
- Trivy 0.74.0 (Apache-2.0) with a checksum-bound offline vulnerability database
  snapshot.

The credentialless materializer retains package license files in the exact
offline store/toolchain closure and records every staged byte in the context
manifest. This notice is attribution, not a substitute for those source license
files or the release review.

The base image's bundled npm/npx and Yarn package-manager distributions are
removed because the runtime admits only Cloud Markup's frozen pnpm closure.

Trivy uses the [reviewed Go source build](../go-tools/README.md), including its
exact dependency patch and Apache-2.0 license. The final runtime copies the
verified binary from credentialless preparation and performs no tool download or
source build. A current final image scan remains required for admission.
