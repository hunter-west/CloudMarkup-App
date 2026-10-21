package compiler

import (
	"github.com/zclconf/go-cty/cty"
)

func (r *terraformRenderer) renderEbsResource(n NormalizedResource) {
	block := r.resourceBlock(n)
	b := block.Body()
	dnsLifecycle(b, false)
	if n.ServiceType == serviceEbsVolume {
		z := r.elbOne(n, ebsZone, false)
		b.SetAttributeValue("availability_zone", cty.StringVal(r.configString(z, "zoneName")))
		b.SetAttributeValue("size", cty.NumberIntVal(int64(r.configInt(n, "sizeGiB"))))
		b.SetAttributeValue("type", cty.StringVal("gp3"))
		b.SetAttributeValue("iops", cty.NumberIntVal(3000))
		b.SetAttributeValue("throughput", cty.NumberIntVal(125))
		b.SetAttributeValue("encrypted", cty.BoolVal(true))
		b.SetAttributeValue("multi_attach_enabled", cty.BoolVal(false))
		if key := r.elbOne(n, ebsKey, false); key.ID != "" {
			b.SetAttributeRaw("kms_key_id", r.resourceAttributeTokens(key.ID, "arn"))
		}
		b.SetAttributeRaw("tags", r.namedNetworkTags(r.configString(n, "name")))
	} else {
		volume := r.elbOne(n, ebsOwner, false)
		instance := r.elbOne(n, ebsInstance, false)
		b.SetAttributeRaw("volume_id", r.resourceAttributeTokens(volume.ID, "id"))
		b.SetAttributeRaw("instance_id", r.resourceAttributeTokens(instance.ID, "id"))
		b.SetAttributeValue("device_name", cty.StringVal(r.configString(n, "deviceName")))
		b.SetAttributeValue("force_detach", cty.BoolVal(false))
		b.SetAttributeValue("skip_destroy", cty.BoolVal(true))
		b.SetAttributeValue("stop_instance_before_detaching", cty.BoolVal(false))
	}
	appendBlock(r.file("ebs.tf"), block)
	r.ebsWarning(n)
}
func (r *cloudFormationRenderer) renderEbsResource(n NormalizedResource) {
	h := &terraformRenderer{model: r.model, limits: r.limits}
	p := map[string]any{}
	res := cloudFormationResource{Type: cloudFormationResourceTypeByService[n.ServiceType], Properties: p, Metadata: r.resourceMetadata(n), DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain"}
	if n.ServiceType == serviceEbsVolume {
		z := h.elbOne(n, ebsZone, false)
		p["AvailabilityZone"] = r.configString(z, "zoneName")
		p["Size"] = r.configInt(n, "sizeGiB")
		p["VolumeType"] = "gp3"
		p["Iops"] = 3000
		p["Throughput"] = 125
		p["Encrypted"] = true
		p["MultiAttachEnabled"] = false
		p["Tags"] = r.namedTagList(r.configString(n, "name"))
		if key := h.elbOne(n, ebsKey, false); key.ID != "" {
			p["KmsKeyId"] = r.resourceAttribute(key.ID, "arn")
		}
	} else {
		volume := h.elbOne(n, ebsOwner, false)
		instance := h.elbOne(n, ebsInstance, false)
		p["VolumeId"] = r.resourceAttribute(volume.ID, "id")
		p["InstanceId"] = r.resourceAttribute(instance.ID, "id")
		p["Device"] = r.configString(n, "deviceName")
	}
	r.addResource(r.logicalIDs[n.ID], res, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	h.ebsWarning(n)
	r.diagnostics = append(r.diagnostics, h.diagnostics...)
}
