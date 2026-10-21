# Frozen AWS model-input catalog

These two artifacts are copied byte-for-byte from public commit
`2cd491bd8c33bf75031aa0a5533687b12f4f635f`:

| Retained file                  | Original path                                                  | Canonical body SHA-256                                             |
| ------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `catalog-71-v1.json`           | `packages/provider-aws/src/compiled/catalog-v1.json`           | `7bc6db32a69c5dd33ef85e02e2ebd38bb47333670259696165149ce39bcca682` |
| `service-extension-71-v1.json` | `packages/provider-aws/src/compiled/service-extension-v1.json` | `fb4ba434f0dbaaa63543d16a886778109eb69bec730d1b2ca384d2acb32db341` |

The full artifacts retain 71 definitions, 137 relationships and 33 validation
rules, including their original schemas, ports and readiness metadata. The
current 73-definition catalog also changes ALB and existing validation rules;
removing WAF identities cannot reproduce these historical inputs.

`resolveAwsModelCatalogV1` verifies both complete canonical artifact bodies and
their exact bindings, then lazily constructs immutable read-only accessors. The
historical model-input generator verifies this catalog independently of the
current structural source. The original evaluation sources, mirrors, policies
and reports are not regenerated against current data.

These files are not an editor catalog, a native compiler registry or migration
authority. Do not run the current catalog generator or formatter over them.
Changing a historical binding requires a separately named reviewed source; never
relabel an existing model receipt or substitute a new digest.
