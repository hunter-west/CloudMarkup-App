#!/usr/bin/env bash
# Public, exact upstream tools only. This build context receives no credentials
# or product content. Compilation is a separate network-disabled Docker layer.
set -euo pipefail
umask 022
export GOEXPERIMENT=
case "${TOOL:-}" in
  terraform)
    source_sha=4eb4a3e57f70c6aebd4cb52ce6bb6a8f046a769afdff53a4052799dd9e06f7ec
    patch_sha=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    mod_sha=bf4bfc04a81b7b5460eb9f3745ffa65d9de3ae48277eea2d956ead1d8a4f92ce
    sum_sha=dc2cc7e9f02d385c2abbecf75428b6123df6d3cded75f2eb4bec10192a108727
    package=.
    ldflags='-s -w -buildid= -X github.com/hashicorp/terraform/version.dev=no'
    binary_sha=7c226d2a50158de8d8567e799f9dcadad9179ca4877202053ce2b1c55c8e0ee4
    ;;
  tflint)
    source_sha=cb4565109f6bc49b13d99526c4fd66aecb566549bfbd03256f0bb4c16665f4eb
    patch_sha=33cee16539c4db9a8c0067bb50ae7a45cea76801d11ef4df3a878d31e30bc774
    mod_sha=fb0a0b0526573aa98d433dfbf10f15f5f0514a89dc2ca8b1ca4cad5a04a6b08c
    sum_sha=3685615a1b678ed5dff0f0a0648f5652196c551e4ed13f9750ce06f0e83bd222
    package=.
    ldflags='-s -w -buildid='
    binary_sha=e4bf9780686a7715bcf277fada5659a1ca433bacf24289c23c75388979a34a66
    ;;
  trivy)
    source_sha=285594b257470eb444fd2836be95a835565ee600382320c977b3993d8efbb767
    patch_sha=ef1f6ca694228f165949b8916f61f0131b1c688dd70f3cc047c29e39b0ef2edc
    mod_sha=926dad0adb06c67df30013f281d1c723a1e43152fa6b3fe80abda6b0e9e8dae8
    sum_sha=c1249f51fdc8fbe1401ec57e16286c844ecaef32a3c6e8ea8ce38b48432e4b4a
    package=./cmd/trivy
    export GOEXPERIMENT=jsonv2
    ldflags='-s -w -buildid= -X github.com/aquasecurity/trivy/pkg/version/app.ver=0.74.0'
    binary_sha=2f78848b474c6f0b27d0df1833ae8fc7d297640344c6d5c7a25f63cc9e22d3dc
    ;;
  *) printf '%s\n' 'Unknown reviewed Go tool.' >&2; exit 64 ;;
esac
check_modules() {
  printf '%s  %s\n' "$mod_sha" /src/go.mod "$sum_sha" /src/go.sum | sha256sum --check --strict
}
test "$(go env GOVERSION)" = go1.26.8
case "${1:-}" in
  prepare)
    printf '%s  %s\n' "$source_sha" /inputs/source.tar.gz "$patch_sha" /inputs/tool.patch | sha256sum --check --strict
    mkdir /src
    # The archive bytes above are the exact reviewed public commit archive.
    # Extraction occurs only in the disposable builder filesystem.
    tar --extract --gzip --file /inputs/source.tar.gz --directory /src --strip-components=1 --no-same-owner --no-same-permissions
    cd /src
    if test -s /inputs/tool.patch; then
      git apply --check /inputs/tool.patch
      git apply /inputs/tool.patch
    fi
    check_modules
    # Resolve the complete module graph before network-disabled verification.
    # This downloads metadata only; compilation still uses the exact package closure.
    go list -mod=readonly -m all > /inputs/module-graph.txt
    go list -mod=readonly -deps "$package" > /inputs/compiled-imports.txt
    check_modules
    ;;
  build)
    cd /src
    export GOPROXY=off GOSUMDB=off
    check_modules
    go mod verify
    mkdir /out
    go build -mod=readonly -p 2 -trimpath -buildvcs=false -ldflags "$ldflags" -o "/out/$TOOL" "$package"
    check_modules
    sha256sum "/out/$TOOL"
    go version -m "/out/$TOOL" | tail -n 12
    printf '%s  %s\n' "$binary_sha" "/out/$TOOL" | sha256sum --check --strict
    cp LICENSE "/out/$TOOL-LICENSE.txt"
    cp /inputs/compiled-imports.txt "/out/$TOOL-imports.txt"
    go version -m "/out/$TOOL" > "/out/$TOOL-build-info.txt"
    ;;
  *) printf '%s\n' 'Unknown source-build phase.' >&2; exit 64 ;;
esac
