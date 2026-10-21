# Frozen AWS networking evaluation dataset v2

`model-evaluation-networking-v2.json` is the additive, content-addressed Prompt
43 networking evaluation suite. It contains exactly five synthetic cases:
private database, avoid NAT, invalid CIDR, broad ingress, and multi-AZ
requirements. Prompt 38's immutable 21-case v1 dataset remains unchanged.

The suite binds a minimum catalog authority slice for service IDs, relationship
types, configuration keys, and deterministic validation findings. The generator
checks that copied service and relationship authority against the immutable
checked AWS catalog `0.10.0` artifact before it writes or verifies the JSON
mirror. Additive current catalog releases do not silently retarget Prompt 43
evaluation authority. Unknown services, relationships, fields, findings, and
operation kinds fail closed. A catalog-supported NAT gateway can still fail the
case-specific "avoid NAT" requirement.

The built-in observations are deterministic contract-smoke data, not model or
validator Evidence. They contain no customer data, credentials, repository
content, provider access, apply authority, or deployment authority. Every case
requires reviewed operations and explicitly forbids automatic mutation.

After building `@cloudmarkup/model-gateway`, write or verify the mirror with:

```powershell
node evals/datasets-v2/generate.mjs --write
node evals/datasets-v2/generate.mjs --check
```
