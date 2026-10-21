# syntax=docker/dockerfile:1.19.0@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6

FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

ARG TARGETOS
ARG TARGETARCH

COPY --chmod=0444 offline/apk/libcrypto3-3.5.9-r0.apk /tmp/cloudmarkup-apk/libcrypto3-3.5.9-r0.apk
COPY --chmod=0444 offline/apk/libssl3-3.5.9-r0.apk /tmp/cloudmarkup-apk/libssl3-3.5.9-r0.apk

RUN /sbin/apk add \
      --no-network \
      --no-cache \
      --repositories-file /dev/null \
      --no-scripts \
      --upgrade \
      /tmp/cloudmarkup-apk/libcrypto3-3.5.9-r0.apk \
      /tmp/cloudmarkup-apk/libssl3-3.5.9-r0.apk \
    && /sbin/apk info -e "libcrypto3=3.5.9-r0" \
    && /sbin/apk info -e "libssl3=3.5.9-r0" \
    && rm -rf /tmp/cloudmarkup-apk \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    && rm -rf /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && rm -f /usr/local/bin/docker-entrypoint.sh \
    && test ! -e /usr/local/lib/node_modules/npm \
    && test ! -e /usr/local/bin/npm \
    && test ! -e /usr/local/bin/npx \
    && test ! -e /opt/yarn-v1.22.22 \
    && test ! -e /usr/local/bin/yarn \
    && test ! -e /usr/local/bin/yarnpkg \
    && test ! -e /usr/local/bin/docker-entrypoint.sh \
    && test "$TARGETOS" = "linux" \
    && test "$TARGETARCH" = "amd64" \
    && test "$(node --version)" = "v24.18.0" \
    && mkdir -p /workspace \
    && chown 65532:65532 /workspace \
    && find / -xdev -type f \( -perm -4000 -o -perm -2000 \) -exec chmod a-s {} +

COPY --chmod=0555 offline/bin/trivy /opt/cloudmarkup/tools/trivy
COPY --chmod=0555 offline/bin/terraform /opt/cloudmarkup/tools/terraform
COPY --chmod=0555 offline/bin/tflint /opt/cloudmarkup/tools/tflint
COPY --chmod=0444 offline/provider-mirror/registry.terraform.io/hashicorp/aws/terraform-provider-aws_6.63.0_linux_amd64.zip /opt/cloudmarkup/provider-mirror/registry.terraform.io/hashicorp/aws/terraform-provider-aws_6.63.0_linux_amd64.zip
COPY --chmod=0444 offline/trivy-cache/metadata.json /opt/cloudmarkup/trivy-cache/db/metadata.json
COPY --chmod=0444 offline/trivy-cache/trivy.db /opt/cloudmarkup/trivy-cache/db/trivy.db
COPY --chmod=0444 offline/.terraform.lock.hcl /opt/cloudmarkup/policy/.terraform.lock.hcl
COPY --chmod=0444 offline/terraform.rc /opt/cloudmarkup/policy/terraform.rc
COPY --chmod=0444 offline/tool-binaries-v1.json /opt/cloudmarkup/policy/tool-binaries-v1.json
COPY --chmod=0444 offline/provider-mirror/index-v1.json /opt/cloudmarkup/policy/provider-mirror-index-v1.json
COPY --chmod=0444 offline/acquisition-v1.json /opt/cloudmarkup/policy/acquisition-v1.json
COPY --chmod=0555 service/terraform-validation-service /opt/cloudmarkup/bin/terraform-validation-service
COPY --chmod=0555 service/terraform-validation-stage /opt/cloudmarkup/bin/terraform-validation-stage
COPY --chmod=0444 service/runtime.cjs /opt/cloudmarkup/bin/runtime.cjs
COPY --chmod=0444 schemas/service-error-v1.schema.json /opt/cloudmarkup/schemas/service-error-v1.schema.json
COPY --chmod=0444 schemas/self-test-result-v1.schema.json /opt/cloudmarkup/schemas/self-test-result-v1.schema.json
COPY --chmod=0444 THIRD_PARTY_NOTICES.md /opt/cloudmarkup/licenses/THIRD_PARTY_NOTICES.md
COPY --chmod=0444 offline/licenses/terraform-LICENSE.txt /opt/cloudmarkup/licenses/terraform-LICENSE.txt
COPY --chmod=0444 offline/licenses/tflint-LICENSE.txt /opt/cloudmarkup/licenses/tflint-LICENSE.txt
COPY --chmod=0444 offline/licenses/trivy-LICENSE.txt /opt/cloudmarkup/licenses/trivy-LICENSE.txt
COPY --chmod=0444 self-test/run.mjs /opt/cloudmarkup/self-test/run.mjs
COPY --chmod=0444 self-test/fixtures/accepted/versions.tf /opt/cloudmarkup/self-test/fixtures/accepted/versions.tf
COPY --chmod=0444 self-test/fixtures/syntax-failure/main.tf /opt/cloudmarkup/self-test/fixtures/syntax-failure/main.tf
COPY --chmod=0444 self-test/fixtures/missing-provider/versions.tf /opt/cloudmarkup/self-test/fixtures/missing-provider/versions.tf

RUN find /opt/cloudmarkup -xdev -type d -exec chmod 0555 {} + \
    && test -z "$(find /opt/cloudmarkup -xdev -type d ! -perm 0555 -print -quit)" \
    && test "$(stat -c '%a' /opt/cloudmarkup)" = "555" \
    && test "$(stat -c '%a' /opt/cloudmarkup/self-test)" = "555" \
    && test "$(stat -c '%a' /opt/cloudmarkup/policy)" = "555" \
    && test "$(stat -c '%a' /opt/cloudmarkup/provider-mirror)" = "555" \
    && test "$(stat -c '%a' /opt/cloudmarkup/trivy-cache)" = "555" \
    && test "$(node --version)" = "v24.18.0" \
    && test "$(/opt/cloudmarkup/tools/terraform version | head -n 1)" = "Terraform v1.16.2" \
    && test "$(/opt/cloudmarkup/tools/tflint --version | head -n 1)" = "TFLint version 0.64.0" \
    && test "$(/opt/cloudmarkup/tools/trivy --version | head -n 1)" = "Version: 0.74.0" \
    && test ! -e /usr/local/lib/node_modules/npm \
    && test ! -e /usr/local/bin/npm \
    && test ! -e /usr/local/bin/npx \
    && test ! -e /opt/yarn-v1.22.22 \
    && test ! -e /usr/local/bin/yarn \
    && test ! -e /usr/local/bin/yarnpkg \
    && test ! -e /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
    TZ=UTC \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

USER 65532:65532
WORKDIR /workspace
HEALTHCHECK NONE
ENTRYPOINT ["/opt/cloudmarkup/bin/terraform-validation-service"]
