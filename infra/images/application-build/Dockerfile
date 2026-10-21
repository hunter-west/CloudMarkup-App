# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

ARG TARGETOS
ARG TARGETARCH

ENV CI=1 \
    HOME=/tmp \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NO_COLOR=1 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_IGNORE_SCRIPTS=true \
    PATH=/opt/cloudmarkup/bin:/usr/local/bin:/usr/bin:/bin \
    SOURCE_DATE_EPOCH=0 \
    TZ=UTC \
    TRIVY_CACHE_DIR=/opt/cloudmarkup/trivy-cache

COPY --chmod=0444 offline/apk/libcrypto3-3.5.9-r0.apk /opt/cloudmarkup/apk/libcrypto3-3.5.9-r0.apk
COPY --chmod=0444 offline/apk/libssl3-3.5.9-r0.apk /opt/cloudmarkup/apk/libssl3-3.5.9-r0.apk

RUN test "$TARGETOS" = "linux" \
    && test "$TARGETARCH" = "amd64" \
    && test "$(sha256sum /opt/cloudmarkup/apk/libcrypto3-3.5.9-r0.apk | cut -d ' ' -f 1)" = "6632d758d8f5e9ea3b650fe966f23bbf9a202f8b8dceecac93da135dec5e3689" \
    && test "$(sha256sum /opt/cloudmarkup/apk/libssl3-3.5.9-r0.apk | cut -d ' ' -f 1)" = "05e3393fb95aa5751ca2f9d242f659f6cff82c1cc7767cc2df4a086f7ad01877" \
    && /sbin/apk add \
      --no-network \
      --no-cache \
      --repositories-file /dev/null \
      --no-scripts \
      --upgrade \
      /opt/cloudmarkup/apk/libcrypto3-3.5.9-r0.apk \
      /opt/cloudmarkup/apk/libssl3-3.5.9-r0.apk \
    && /sbin/apk info -e "libcrypto3=3.5.9-r0" \
    && /sbin/apk info -e "libssl3=3.5.9-r0" \
    && rm -rf \
      /opt/cloudmarkup/apk \
      /opt/yarn-v1.22.22 \
      /usr/local/lib/node_modules/npm \
    && rm -f \
      /usr/local/bin/docker-entrypoint.sh \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
    && test ! -e /opt/cloudmarkup/apk \
    && test ! -e /opt/yarn-v1.22.22 \
    && test ! -e /usr/local/lib/node_modules/npm \
    && test ! -e /usr/local/bin/docker-entrypoint.sh \
    && test ! -L /usr/local/bin/docker-entrypoint.sh \
    && test ! -e /usr/local/bin/npm \
    && test ! -L /usr/local/bin/npm \
    && test ! -e /usr/local/bin/npx \
    && test ! -L /usr/local/bin/npx \
    && test ! -e /usr/local/bin/yarn \
    && test ! -L /usr/local/bin/yarn \
    && test ! -e /usr/local/bin/yarnpkg \
    && test ! -L /usr/local/bin/yarnpkg \
    && test "$(node --version)" = "v24.18.0" \
    && mkdir -p /opt/cloudmarkup/bin /opt/cloudmarkup/config /opt/cloudmarkup/service /opt/cloudmarkup/toolchain /workspace \
    && chown 65532:65532 /workspace \
    && find / -xdev -type f -perm /6000 -exec chmod a-s {} +

COPY --chown=65532:65532 --chmod=0444 offline/toolchain/package.json /opt/cloudmarkup/toolchain/package.json
COPY --chown=65532:65532 --chmod=0444 offline/toolchain/pnpm-lock.yaml /opt/cloudmarkup/toolchain/pnpm-lock.yaml
COPY --chown=65532:65532 --chmod=0444 offline/toolchain/pnpm-runtime/package.json /opt/cloudmarkup/toolchain/pnpm-runtime/package.json
COPY --chown=65532:65532 --chmod=0444 offline/toolchain/pnpm-runtime/dist/pnpm.mjs /opt/cloudmarkup/toolchain/pnpm-runtime/dist/pnpm.mjs
COPY --chown=65532:65532 --chmod=0444 offline/toolchain/pnpm-runtime/dist/worker.js /opt/cloudmarkup/toolchain/pnpm-runtime/dist/worker.js
COPY --chown=65532:65532 offline/pnpm-store/ /opt/cloudmarkup/pnpm-store/
COPY --chown=65532:65532 --chmod=0444 offline/trivy-cache/metadata.json /opt/cloudmarkup/trivy-cache/db/metadata.json
COPY --chown=65532:65532 --chmod=0444 offline/trivy-cache/trivy.db /opt/cloudmarkup/trivy-cache/db/trivy.db
COPY --chown=65532:65532 --chmod=0555 offline/bin/trivy /opt/cloudmarkup/toolchain/bin/trivy
COPY --chown=65532:65532 --chmod=0444 offline/licenses/trivy-LICENSE.txt /opt/cloudmarkup/licenses/trivy-LICENSE.txt
COPY --chown=65532:65532 --chmod=0444 config/eslint.generated.mjs /opt/cloudmarkup/config/eslint.generated.mjs
COPY --chown=65532:65532 --chmod=0444 service/archive.mjs /opt/cloudmarkup/service/archive.mjs
COPY --chown=65532:65532 --chmod=0444 service/application-build-service.mjs /opt/cloudmarkup/service/application-build-service.mjs
COPY --chown=65532:65532 --chmod=0444 service/contract.mjs /opt/cloudmarkup/service/contract.mjs
COPY --chown=65532:65532 --chmod=0444 service/executor.mjs /opt/cloudmarkup/service/executor.mjs
COPY --chown=65532:65532 --chmod=0444 service/input-schema-v1.json /opt/cloudmarkup/service/input-schema-v1.json
COPY --chown=65532:65532 --chmod=0444 service/pnpm-deterministic-clock.cjs /opt/cloudmarkup/service/pnpm-deterministic-clock.cjs
COPY --chown=65532:65532 --chmod=0444 service/pnpm-store-index.mjs /opt/cloudmarkup/service/pnpm-store-index.mjs
COPY --chown=65532:65532 --chmod=0444 service/process-supervision-self-test.mjs /opt/cloudmarkup/service/process-supervision-self-test.mjs
COPY --chown=65532:65532 --chmod=0444 service/result-schema-v1.json /opt/cloudmarkup/service/result-schema-v1.json
COPY --chown=65532:65532 --chmod=0444 service/self-test.mjs /opt/cloudmarkup/service/self-test.mjs
COPY --chown=65532:65532 --chmod=0444 service/tool-self-test.mjs /opt/cloudmarkup/service/tool-self-test.mjs
COPY --chown=65532:65532 --chmod=0555 service/application-build-service /opt/cloudmarkup/bin/application-build-service
COPY --chown=65532:65532 --chmod=0555 service/eslint /opt/cloudmarkup/bin/eslint
COPY --chown=65532:65532 --chmod=0555 service/pnpm /opt/cloudmarkup/bin/pnpm
COPY --chown=65532:65532 --chmod=0555 service/trivy /opt/cloudmarkup/bin/trivy
COPY --chown=65532:65532 --chmod=0555 service/tsc /opt/cloudmarkup/bin/tsc
COPY --chown=65532:65532 --chmod=0555 service/vitest /opt/cloudmarkup/bin/vitest
COPY --chown=65532:65532 --chmod=0444 THIRD_PARTY_NOTICES.md /opt/cloudmarkup/THIRD_PARTY_NOTICES.md

RUN node /opt/cloudmarkup/service/pnpm-store-index.mjs \
      restore /opt/cloudmarkup/pnpm-store \
    && chmod 0555 \
      /opt/cloudmarkup/toolchain/pnpm-runtime \
      /opt/cloudmarkup/toolchain/pnpm-runtime/dist \
      /opt/cloudmarkup/trivy-cache \
      /opt/cloudmarkup/trivy-cache/db \
    && index_before="$(sha256sum /opt/cloudmarkup/pnpm-store/v11/index.db | cut -d ' ' -f 1)" \
    && PNPM_MAX_WORKERS=1 \
      node /opt/cloudmarkup/toolchain/pnpm-runtime/dist/pnpm.mjs install \
      --dir /opt/cloudmarkup/toolchain \
      --offline \
      --frozen-lockfile \
      --ignore-scripts \
      --strict-peer-dependencies \
      --store-dir /opt/cloudmarkup/pnpm-store \
      --ignore-workspace \
      --ignore-pnpmfile \
      --trust-lockfile \
      --frozen-store \
      --config.verify-store-integrity=true \
      --config.node-linker=hoisted \
      --config.package-import-method=copy \
      --config.bin-links=false \
      --config.prefer-symlinked-executables=false \
      --config.symlink=false \
    && test "$index_before" = "$(sha256sum /opt/cloudmarkup/pnpm-store/v11/index.db | cut -d ' ' -f 1)" \
    && test ! -e /opt/cloudmarkup/pnpm-store/v11/index.db-journal \
    && test ! -e /opt/cloudmarkup/pnpm-store/v11/index.db-shm \
    && test ! -e /opt/cloudmarkup/pnpm-store/v11/index.db-wal \
    && rm -f \
      /opt/cloudmarkup/pnpm-store/manifest-v1.json \
      /opt/cloudmarkup/pnpm-store/v11/index-v1.json \
    && test -f /opt/cloudmarkup/pnpm-store/v11/index.db \
    && test ! -e /opt/cloudmarkup/pnpm-store/manifest-v1.json \
    && test ! -e /opt/cloudmarkup/pnpm-store/v11/index-v1.json \
    && chown -R 65532:65532 /opt/cloudmarkup \
    && find /opt/cloudmarkup -xdev -type d -exec chmod 0555 {} + \
    && test -z "$(find /opt/cloudmarkup -xdev -type d ! -perm 0555 -print -quit)" \
    && test "$(stat -c '%a' /opt/cloudmarkup)" = "555" \
    && node --test /opt/cloudmarkup/service/self-test.mjs \
    && node /opt/cloudmarkup/service/tool-self-test.mjs \
    && rm -rf /tmp/cloudmarkup-trivy-cache \
    && test ! -e /tmp/cloudmarkup-trivy-cache \
    && test ! -L /opt/cloudmarkup/bin/application-build-service \
    && test -x /opt/cloudmarkup/bin/application-build-service \
    && test "$(stat -c '%a' /opt/cloudmarkup/toolchain/pnpm-runtime)" = "555" \
    && test "$(stat -c '%a' /opt/cloudmarkup/toolchain/pnpm-runtime/dist)" = "555" \
    && test "$(stat -c '%a' /opt/cloudmarkup/trivy-cache)" = "555" \
    && test "$(stat -c '%a' /opt/cloudmarkup/trivy-cache/db)" = "555" \
    && test "$(/opt/cloudmarkup/toolchain/bin/trivy --version | head -n 1)" = "Version: 0.74.0"

USER 65532:65532
WORKDIR /workspace
HEALTHCHECK NONE
ENTRYPOINT ["/opt/cloudmarkup/bin/application-build-service"]
