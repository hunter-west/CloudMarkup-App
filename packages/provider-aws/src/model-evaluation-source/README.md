# Frozen AWS model-input catalog

The original 71-definition artifacts are copied byte-for-byte from public commit
`2cd491bd8c33bf75031aa0a5533687b12f4f635f`:

| Retained file                  | Original path                                                  | Canonical body SHA-256                                             |
| ------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `catalog-71-v1.json`           | `packages/provider-aws/src/compiled/catalog-v1.json`           | `7bc6db32a69c5dd33ef85e02e2ebd38bb47333670259696165149ce39bcca682` |
| `service-extension-71-v1.json` | `packages/provider-aws/src/compiled/service-extension-v1.json` | `fb4ba434f0dbaaa63543d16a886778109eb69bec730d1b2ca384d2acb32db341` |

The full artifacts retain 71 definitions, 137 relationships and 33 validation
rules, including their original schemas, ports and readiness metadata. The
current 73-definition catalog also changes ALB and existing validation rules;
removing WAF identities cannot reproduce these historical inputs.

The separately frozen regional WAF evaluation input 1.8.0 retains these exact
73-definition artifacts from local checkpoint
`07715a4b2d505b1873cfa24e05218f662e8f4ccb`:

| Retained file                  | Original path                                                  | Canonical body SHA-256                                             |
| ------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `catalog-73-v1.json`           | `packages/provider-aws/src/compiled/catalog-v1.json`           | `8e9b1b23bbcdf723352044baddd8e79468d70ed5a719af914036992daf91fb94` |
| `service-extension-73-v1.json` | `packages/provider-aws/src/compiled/service-extension-v1.json` | `f6e84fdf8253117361ba1ca6dcd18f7183f2cdbf693b5ea95d7b0c562337b5e1` |

They contain 73 definitions, 139 relationships and 34 validation rules. The
current EC2/EBS capability wording correction changes the installed digest; it
does not rewrite this frozen input or its source/dataset/mirror commitments.

`resolveAwsModelCatalogV1` verifies each complete canonical artifact body and
their exact bindings, then lazily constructs immutable read-only accessors. The
historical model-input generator verifies this catalog independently of the
current structural source. The original evaluation sources, mirrors, policies
and reports are not regenerated against current data.

These files are not an editor catalog, a native compiler registry or migration
authority. Do not run the current catalog generator or formatter over them.
Changing a historical binding requires a separately named reviewed source; never
relabel an existing model receipt or substitute a new digest.
