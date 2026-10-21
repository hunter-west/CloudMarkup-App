# EC2, EBS and Auto Scaling configuration research

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

Research reviewed October 2, 2026. This is an implementation specification for
three planned families in the 50-family coverage plan, not a declaration that
these resources are available on the canvas. Catalog 0.18.0's local FSx
correction still contains thirteen curated families.

Exa searched fifteen results across the three families and retrieved the
relevant AWS references and version-pinned Terraform documentation. Alias
results are not independent sources. Terraform Registry pages for version 6.55.0
returned only a page shell; the linked source files at the exact provider tag
supply the mapping evidence. The proposals below need executable schema,
connection, compiler and import tests before implementation.

## Common behavior and ownership

Start with explicit regional, Linux EC2 instances, regional gp3 data volumes
with one attachment, and an Auto Scaling group using an owned launch template.
These are proposed first slices. Windows, Outposts, Spot/mixed fleets,
Multi-Attach, legacy launch configurations and advanced instance replacement
policies need separate admission. Do not present an unsupported variant as a
generic configuration switch.

Use the existing Identity, Configuration, Connections, Security, Reliability,
Observability and Advanced menu groups. Show mandatory choices first and derive
provider references from typed connections. Expert settings are conditional on
the selected variant. Every connection preview must list its generated
resources, IAM changes and replacement implications before one atomic command
applies it.

Graph identity owns IaC addresses. Layout, display names and AI wording must not
change them. An instance, launch template, Auto Scaling group, data volume,
attachment and instance profile are distinct identities; shared IAM roles and
security groups cannot silently become exclusive children.

## EC2 instance and launch template

| Menu or relationship      | Proposed contract and validation                                                                                                                                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image and machine         | Require an AMI reference with Region and architecture provenance, an admitted instance type, tenancy and the intended operating-system family. AMI existence, permissions, boot mode and architecture compatibility are external readiness evidence, not facts an AI may invent.                            |
| Network                   | First slice: exactly one existing modeled subnet and one primary interface created with the instance. Attach compatible security-group IDs in that VPC. Derive placement from the subnet. Existing ENIs are a separate mutually exclusive mode.                                                             |
| Public addressing         | Default proposal is no public IPv4. Enabling it requires a public-subnet route and explicit cost/exposure review; a public address does not establish a reachable or secure endpoint.                                                                                                                       |
| Instance identity         | An EC2 role connection creates or selects an instance profile, then references its name for aws_instance. Trust must admit ec2.amazonaws.com. A role ARN is not an instance-profile name, and runtime API permissions are separate from service trust.                                                      |
| Metadata                  | Propose IMDS enabled with tokens required, metadata tags disabled, and a reviewed hop limit. Make the emitted values explicit so an AMI/account default cannot silently weaken the setting.                                                                                                                 |
| Root storage              | Model root device settings under the instance/template owner; choose encrypted gp3, an explicit size and deletion policy. Do not also render a standalone volume/attachment for that same device.                                                                                                           |
| Application artifact      | Keep user data or bootstrap source in versioned reviewed application artifacts, with content digest and no embedded secrets. An infrastructure renderer exports it; it never executes it. Container or Lambda artifacts cannot be attached as EC2 boot scripts without an explicit transformation proposal. |
| Reliability and lifecycle | Distinguish stop protection, API termination protection, root-volume retention and monitoring. Surface replacement-sensitive changes rather than promising an in-place resize/move.                                                                                                                         |
| Outputs                   | Expose instance ID, private address and only admitted optional public/DNS outputs. Connections must consume the right typed output rather than parsing names or arbitrary strings.                                                                                                                          |

The
[EC2 CloudFormation resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html)
and
[pinned aws_instance mapping](https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.55.0/website/docs/r/instance.html.markdown)
distinguish instance-profile names, security-group IDs, direct networking and
network-interface blocks. Avoid overlapping ownership of inline and standalone
network/storage resources. Review the exact selected provider fields before
using a newer documentation example.

The
[metadata options reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-ec2-instance-metadataoptions.html)
defines required/optional tokens, IPv4/IPv6 metadata endpoints and hop limits
from 1 to 64. The proposed security defaults above are product policy, not a
claim that AWS defaults are always identical.

A
[launch template](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-launchtemplate.html)
requires actual launch properties; an empty template is invalid. Preserve a
versioned reference between the template and its consumers. Its
[pinned Terraform mapping](https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.55.0/website/docs/r/launch_template.html.markdown)
must be reviewed separately from aws_instance: similar-looking blocks do not
guarantee identical field names, ownership or limits.

## EBS volumes and attachments

The first standalone volume should expose Availability Zone, size in GiB,
encryption/KMS reference, gp3 IOPS and throughput, tags and retention intent.
Snapshot-derived volumes require explicit snapshot provenance and source size.
Never suggest that reducing the size is an in-place operation.

| Constraint          | Evidence and implementation consequence                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regional gp3 size   | Current AWS volume documentation allows 1–65,536 GiB. Outposts has a different ceiling; exclude that variant from the initial regional contract.                                                                                        |
| gp3 IOPS            | AWS describes a 3,000 IOPS baseline and up to 80,000, with additional performance limited by 500 IOPS/GiB. The baseline still applies to small volumes; a naive size × 500 rule would reject valid small defaults.                      |
| gp3 throughput      | AWS describes 125–2,000 MiB/s and throughput at most IOPS × 0.25. Maximum throughput requires at least 8,000 IOPS and sufficient size. Show units and validate the tuple, not independent maxima.                                       |
| Encryption          | Propose encrypted storage. A customer-managed key must be compatible with Region, use and permissions. A visual encryption link does not itself grant the deploying principal or service access.                                        |
| Attachment          | Require a compatible EC2 instance in the same Availability Zone and an explicit device name. Reject duplicate device ownership and root/data collisions. Guest operating-system device names can differ from the requested device name. |
| Single attachment   | Exactly one instance target in the first slice. Multi-Attach is not a boolean that can be enabled on gp3.                                                                                                                               |
| Ownership           | One resource owns each volume. Instance root configuration and a standalone EBS volume cannot claim the same storage; an attachment does not transfer volume ownership.                                                                 |
| Replacement/removal | Explain that attachment changes can disrupt workloads. Export cannot prove that a guest unmounted a filesystem or that it is safe to detach a running root disk.                                                                        |

The current
[AWS gp3 guide](https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html)
and
[standalone CloudFormation volume reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html)
support the regional limits above. These are documentation findings, not a
tested promise for every account, instance, Region, IaC field or runner version.

There is a material documentation mismatch: the current
[inline instance EBS reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-ec2-instance-ebs.html)
still describes older gp3 limits, and the pinned launch-template Terraform
documentation describes a maximum throughput of 1,000 MiB/s. The
[pinned standalone EBS mapping](https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.55.0/website/docs/r/ebs_volume.html.markdown)
lists valid types and fields but does not establish all current numeric bounds.
Before enabling expanded limits, check the exact provider implementation/schema
and both generated target forms with the pinned validation toolchain. Keep
unresolved combinations explicitly unsupported; do not equate a larger AWS API
limit with verified renderer support.

[VolumeAttachment](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volumeattachment.html)
requires a volume, instance and device in compatible placement.
[Multi-Attach](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes-multi.html)
is restricted to supported io1/io2 configurations and up to sixteen Nitro
instances in the same Availability Zone; application coordination and fencing
remain necessary. Engine/operating-system/Region and modification restrictions
require a separate future resource variant and tests.

## Auto Scaling groups

| Menu or relationship     | Proposed contract and validation                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capacity                 | First slice uses instance counts. Enforce integer minimum ≤ desired ≤ maximum and declare whether desired capacity is graph-owned or externally managed. Weighted/vCPU/memory capacity belongs to a later explicit mode.                    |
| Launch source            | Exactly one owned or explicitly referenced launch template and a bound version. Do not emit a legacy launch configuration or mix an inline launch-template block with mixed-instances policy.                                               |
| Placement                | Select modeled subnets and derive compatible Availability Zones. Require a consistent Region/VPC. Do not generate an instance-per-zone graph expansion for dynamically managed capacity.                                                    |
| Load balancing           | Connect compatible target groups through one ownership mechanism. Do not combine inline target-group ARNs with a second attachment resource for the same relationship. Listener routing belongs to the load-balancer configuration.         |
| Health                   | Distinguish EC2 health from load-balancer health, health-check grace period and default instance warmup. These delays describe different decisions and must not share one ambiguous field.                                                  |
| Scaling                  | Start with explicit bounded target tracking or scheduled policies only when their metric/target contracts are implemented. Metric namespace/dimensions and units are typed; an alarm line cannot stand in for an executable scaling policy. |
| Rollout                  | Instance refresh and CloudFormation update policy need independent target mappings and explicit availability/capacity review. Changing the template version is not proof that old instances were replaced.                                  |
| Security and application | Reuse the launch template's instance profile, security groups and immutable artifact references. Changing group size never expands the IAM permissions granted to instances.                                                                |
| Observability            | Group metrics, notifications and alarms retain exact group identity and supported metric semantics. Costs and warmup impact should be explained before accepting an AI proposal.                                                            |

The
[CloudFormation Auto Scaling group reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-autoscaling-autoscalinggroup.html)
and
[launch-template setup guide](https://docs.aws.amazon.com/autoscaling/ec2/userguide/create-asg-launch-template.html)
define the launch-source and network choices. The
[pinned Terraform Auto Scaling documentation](https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/v6.55.0/website/docs/r/autoscaling_group.html.markdown)
warns that a literal $Latest template version does not trigger its instance
refresh behavior; use an explicit template-version attribute where that
ownership is intended. No AI or exporter may infer that a refresh was executed.

## Deterministic findings, AI and import acceptance

Implement separate findings with exact paths for missing/ambiguous placement,
cross-VPC security groups, AMI/type architecture mismatch, unresolved image
provenance, missing instance profile/trust, duplicate root/data ownership,
invalid gp3 performance tuples, cross-AZ attachment, duplicate device names,
unimplemented Multi-Attach, inconsistent group capacity and mutable template
version selection. Distinguish graph errors from external readiness evidence.

AI should propose secure initial values, connect known existing resources and
ask only for information that materially changes the architecture: image,
machine capacity, placement, desired availability and workload artifact.
Deterministic code derives references and generated children and rejects
unsupported fields. Do not auto-apply changes that replace an instance, detach
storage, resize a filesystem, broaden ingress or initiate a rollout.

Import must normalize Terraform and CloudFormation into the same ownership
model: instance-owned root storage, independently managed data volumes,
attachment edges, instance profiles and launch-template versions. Preserve
source addresses and reference provenance. Unsupported user data, provisioners,
dynamic expressions, external modules or unresolved account/Region values become
reviewable import findings; do not execute them or silently manufacture graph
resources.

Before marking any family implemented, add schema/connection negative cases,
provider contracts, atomic-command and inverse tests, versioned compiler goldens
for both targets, historical compatibility, AI proposal rejection, import round
trips and accessible menu/browser evidence. Validate replacement, IAM and
generated-resource lifecycle effects separately. This research does not change
catalog, connection, validator, compiler or runtime support counts.
