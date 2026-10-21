# Third-party notices

This validation image combines exact reviewed upstream artifacts. Their
inclusion does not change Cloud Markup's validation-only authority.

| Component              | Version | Upstream                                              | License                                                        |
| ---------------------- | ------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| Node.js                | 24.18.0 | <https://github.com/nodejs/node>                      | MIT and bundled third-party notices                            |
| HashiCorp Terraform    | 1.16.2  | <https://github.com/hashicorp/terraform>              | Business Source License 1.1 and HashiCorp additional-use terms |
| Terraform AWS Provider | 6.63.0  | <https://github.com/hashicorp/terraform-provider-aws> | Mozilla Public License 2.0                                     |
| TFLint                 | 0.64.0  | <https://github.com/terraform-linters/tflint>         | Mozilla Public License 2.0                                     |
| Trivy                  | 0.74.0  | <https://github.com/aquasecurity/trivy>               | Apache License 2.0                                             |
| OpenSSL libcrypto/ssl  | 3.5.9   | <https://www.openssl.org/>                            | Apache License 2.0                                             |

Source acquisition retains the exact Terraform, TFLint and Trivy upstream
licenses. The [Go source-build recipe](../go-tools/README.md) records public
commits, the Go 1.26.8 toolchain and reviewed dependency patches. The provider
package retains its upstream license member. The final image SBOM and license
inventory must be generated and reviewed before publication.
