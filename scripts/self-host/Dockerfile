# Build from the repository root. Supply reviewed immutable image references.
# Version checks bind those references to the existing toolchain pins.
ARG NODE_IMAGE
ARG GO_IMAGE
ARG CLOUDMARKUP_BROWSER_AUTH_MODE=local-owner
FROM ${GO_IMAGE} AS compiler
WORKDIR /source/services/iac-compiler
COPY services/iac-compiler/ ./
RUN test "$(go env GOVERSION)" = "go1.26.8"
RUN CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -o /out/cloudmarkup-iac ./cmd/cloudmarkup-iac

FROM ${NODE_IMAGE} AS build
ARG CLOUDMARKUP_BROWSER_AUTH_MODE=local-owner
# Select only the existing browser authentication paths; runtime settings stay private.
RUN node -e 'if (!["local-owner", "cognito"].includes(process.env.CLOUDMARKUP_BROWSER_AUTH_MODE)) { console.error("CLOUDMARKUP_BROWSER_AUTH_MODE must be local-owner or cognito."); process.exit(1); }'
WORKDIR /opt/cloudmarkup
COPY . ./
COPY --from=compiler /out/cloudmarkup-iac /opt/cloudmarkup/bin/cloudmarkup-iac
RUN test "$(node --version)" = "v24.18.0" \
    && npm install --global pnpm@11.16.0 \
    && test "$(pnpm --version)" = "11.16.0" \
    && pnpm install --frozen-lockfile
# These are the shared application artifacts, including their workspace jobs.
# Missing D source/build entry is an error; there is no demo-server fallback.
ENV VITE_CLOUDMARKUP_AUTH_MODE=${CLOUDMARKUP_BROWSER_AUTH_MODE} VITE_CLOUDMARKUP_API_BASE_URL=/api
RUN test -f apps/api/src/self-host/server.ts \
    && pnpm build:backend && pnpm build:web \
    && test -f apps/api/dist/self-host/server.js \
    && test -f apps/api/dist/persistence.js \
    && test -f apps/api/dist/self-host-owner.js \
    && test -f apps/web/dist/index.html \
    && node scripts/self-host/bootstrap.mjs inspect \
    && node scripts/self-host/stage-native-export.mjs stage

FROM ${NODE_IMAGE} AS runtime
ARG CLOUDMARKUP_BROWSER_AUTH_MODE
LABEL com.cloudmarkup.browser-auth-mode=${CLOUDMARKUP_BROWSER_AUTH_MODE}
ENV NODE_ENV=production
WORKDIR /opt/cloudmarkup
# Keep workspace links and exports intact. Image-size pruning is a later,
# measured optimization; it must not remove jobs or optional shared features.
COPY --from=build /opt/cloudmarkup/ ./
RUN groupadd --gid 10001 cloudmarkup \
    && useradd --uid 10001 --gid 10001 --no-create-home cloudmarkup \
    && mkdir -p /data/cloudmarkup/objects \
    && chown -R 10001:10001 /data/cloudmarkup \
    && chmod 0700 /data/cloudmarkup /data/cloudmarkup/objects
USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "apps/api/dist/self-host/server.js"]
