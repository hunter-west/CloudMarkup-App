# syntax=docker/dockerfile:1.19.0@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6
FROM golang:1.26.8-bookworm@sha256:9fdc884aacc3bec89b20ffc69f4bb369c78210e3e4f600387b5128b12c199f81 AS build
ARG TOOL
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOAMD64=v1 GOTOOLCHAIN=local GOENV=off GOWORK=off GOTELEMETRY=off GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org
COPY source.tar.gz tool.patch recipe.sh /inputs/
RUN bash /inputs/recipe.sh prepare
RUN --network=none bash /inputs/recipe.sh build
FROM scratch AS output
COPY --from=build /out/ /
