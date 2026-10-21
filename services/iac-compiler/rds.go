package compiler

import (
	_ "embed"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

const serviceRdsInstance = "aws.rds.db-instance"
const serviceRdsSubnetGroup = "aws.rds.db-subnet-group"
const serviceRdsParameterGroup = "aws.rds.db-parameter-group"
const rdsSubnetBinding = "aws.rds.subnet-group-uses-subnet"
const rdsSubnetGroupBinding = "aws.rds.instance-uses-subnet-group"
const rdsParameterBinding = "aws.rds.instance-uses-parameter-group"
const rdsGroupBinding = "aws.rds.instance-uses-security-group"

var rdsContracts = map[string]ecsBinding{
	rdsSubnetBinding:      {serviceRdsSubnetGroup, "subnet", serviceSubnet, "rds-subnet-group", 16, 128},
	rdsSubnetGroupBinding: {serviceRdsSubnetGroup, "instance", serviceRdsInstance, "subnet-group", 128, 1},
	rdsParameterBinding:   {serviceRdsParameterGroup, "instance", serviceRdsInstance, "parameter-group", 128, 1},
	rdsGroupBinding:       {serviceRdsInstance, "security-group", serviceSecurityGroup, "rds-instance", 5, 128},
}

// Reviewed local literal field contract; focused tests prove exact source drift.
//
//go:embed internal/contracts/rds-configuration-v1.json
var rdsConfigurationJSON []byte
var rdsSchemas = func() map[string]map[string]ecsField {
	var m map[string]map[string]ecsField
	if json.Unmarshal(rdsConfigurationJSON, &m) != nil {
		panic("invalid reviewed RDS schema")
	}
	return m
}()

func init() {
	for s, tf := range map[string]string{serviceRdsInstance: "aws_db_instance", serviceRdsSubnetGroup: "aws_db_subnet_group", serviceRdsParameterGroup: "aws_db_parameter_group"} {
		terraformResourceTypeByService[s] = tf
	}
	for s, cf := range map[string]string{serviceRdsInstance: "AWS::RDS::DBInstance", serviceRdsSubnetGroup: "AWS::RDS::DBSubnetGroup", serviceRdsParameterGroup: "AWS::RDS::DBParameterGroup"} {
		cloudFormationResourceTypeByService[s] = cf
	}
	for rel, c := range rdsContracts {
		networkingRelationshipContracts[rel] = networkContract(c.source, c.source+"."+c.sourcePort, c.target, c.target+"."+c.targetPort, c.sourceMax, c.targetMax)
		terraformRelationshipSupport[rel] = struct{}{}
	}
}
func (r *terraformRenderer) validateRdsFields(n NormalizedResource) bool {
	schema := rdsSchemas[n.ServiceType]
	keys := []string{}
	for k := range schema {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if !r.validateConfiguration(n, n.ServiceType+".configuration", keys) {
		return false
	}
	ok := true
	for _, k := range keys {
		s := schema[k]
		v := n.Configuration.Values[k]
		valid := v.Kind == s.Type
		var value any
		switch s.Type {
		case "string":
			value = r.configString(n, k)
			t := r.configString(n, k)
			valid = valid && (s.Pattern == "" || regexp.MustCompile(s.Pattern).MatchString(t)) && (s.MinLength == nil || len(utf16.Encode([]rune(t))) >= *s.MinLength) && (s.MaxLength == nil || len(utf16.Encode([]rune(t))) <= *s.MaxLength)
		case "integer":
			f := r.configNumber(n, k)
			value = f
			valid = valid && !math.IsNaN(f) && !math.IsInf(f, 0) && f == math.Trunc(f) && (s.Minimum == nil || f >= *s.Minimum) && (s.Maximum == nil || f <= *s.Maximum)
		case "boolean":
			value = r.configBool(n, k)
			valid = valid && (s.Const == nil || value == *s.Const)
		}
		if len(s.Enum) > 0 {
			found := false
			for _, e := range s.Enum {
				if e == value {
					found = true
				}
			}
			valid = valid && found
		}
		if !valid {
			r.error("TARGET_RDS_FIELD_INVALID", "Supply every exact reviewed literal field with admitted bounds/modes; reference values and unknown properties are unsupported.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID, Path: "$.semantic.configuration.values." + k})
			ok = false
		}
	}
	return ok
}

func (r *terraformRenderer) rdsGroupVpc(n NormalizedResource) (string, bool) {
	if n.ServiceType != serviceRdsSubnetGroup {
		return "", false
	}
	subnets := r.relatedResources(n.ID, rdsSubnetBinding, false)
	if len(subnets) < 2 || len(subnets) > 16 {
		return "", false
	}
	vpc := ""
	zones := map[string]bool{}
	zoneNames := map[string]bool{}
	seen := map[string]bool{}
	for _, s := range subnets {
		network, ok := r.networkVPCID(s)
		if !ok || s.ServiceType != serviceSubnet || seen[s.ID] || s.Parent == nil {
			return "", false
		}
		seen[s.ID] = true
		if vpc != "" && vpc != network {
			return "", false
		}
		vpc = network
		az, ok := r.resourceByID(s.Parent.NodeID)
		if !ok || az.ServiceType != serviceAvailabilityZone {
			return "", false
		}
		zone := r.configString(az, "zoneName")
		if !strings.HasPrefix(zone, r.model.Provenance.Region) || !regexp.MustCompile("^[a-z]$").MatchString(strings.TrimPrefix(zone, r.model.Provenance.Region)) {
			return "", false
		}
		zones[az.ID] = true
		zoneNames[zone] = true
	}
	return vpc, len(zones) >= 2 && len(zoneNames) >= 2
}
func rdsMinutes(t string) int {
	a := strings.Split(t, ":")
	if len(a) != 2 {
		return -10000
	}
	h, e1 := strconv.Atoi(a[0])
	m, e2 := strconv.Atoi(a[1])
	if e1 != nil || e2 != nil {
		return -10000
	}
	return h*60 + m
}
func rdsWindowsValid(backup, maintenance string) bool {
	b := strings.Split(backup, "-")
	m := strings.Split(maintenance, "-")
	if len(b) != 2 || len(m) != 2 || len(m[0]) != 9 || len(m[1]) != 9 || m[0][:3] != m[1][:3] {
		return false
	}
	bs, be, ms, me := rdsMinutes(b[0]), rdsMinutes(b[1]), rdsMinutes(m[0][4:]), rdsMinutes(m[1][4:])
	return be-bs >= 30 && be-bs <= 120 && me-ms >= 30 && me-ms <= 120 && !(bs < me && ms < be)
}
func (r *terraformRenderer) validateRdsModel() {
	reject := func(n NormalizedResource, code, msg string) {
		r.error("TARGET_RDS_"+code, msg, SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
	names := map[string]bool{}
	for _, n := range r.model.Resources {
		if _, ok := rdsSchemas[n.ServiceType]; !ok {
			continue
		}
		if !isCurrentAwsCatalog(r.model.Provenance.Catalog) {
			reject(n, "CATALOG_UNSUPPORTED", "RDS requires the exact reviewed catalog successor.")
			continue
		}
		if n.Parent != nil || n.ResourceType != n.ServiceType || !rdsUser(n) {
			reject(n, "OWNERSHIP_INVALID", "Require exact reviewed user-owned root resources; imports/generated/adopted configurations are unsupported.")
		}
		for _, external := range r.model.ExternalResources {
			for _, ref := range external.ArchitectureNodes {
				if ref.NodeID == n.ID {
					reject(n, "EXTERNAL_UNSUPPORTED", "External ownership needs a separate reviewed database contract.")
				}
			}
		}
		if !r.validateRdsFields(n) {
			continue
		}
		key := "name"
		if n.ServiceType == serviceRdsInstance {
			key = "identifier"
		}
		name := r.configString(n, key)
		identity := n.ServiceType + ":" + name
		if names[identity] {
			reject(n, "NAME_DUPLICATE", "Names must be unique within each native type and modeled Region.")
		}
		names[identity] = true
		if n.ServiceType != serviceRdsInstance && strings.HasPrefix(name, "default") {
			reject(n, "NAME_RESERVED", "Default native group names are unsupported.")
		}
		if n.ServiceType == serviceRdsSubnetGroup {
			if _, ok := r.rdsGroupVpc(n); !ok {
				reject(n, "SUBNETS_INVALID", "Require 2-16 distinct canonical subnets in one VPC/Region across at least two distinct declared AZs.")
			}
		}
		if n.ServiceType == serviceRdsInstance {
			subnetGroups := r.relatedResources(n.ID, rdsSubnetGroupBinding, true)
			parameters := r.relatedResources(n.ID, rdsParameterBinding, true)
			groups := r.relatedResources(n.ID, rdsGroupBinding, false)
			network := ""
			ok := false
			if len(subnetGroups) == 1 {
				network, ok = r.rdsGroupVpc(subnetGroups[0])
			}
			if len(subnetGroups) != 1 || len(parameters) != 1 || parameters[0].ServiceType != serviceRdsParameterGroup || !ok || len(groups) < 1 || len(groups) > 5 {
				reject(n, "DEPENDENCIES_INVALID", "Require one exact subnet group, PostgreSQL 16 TLS parameter group and 1-5 same-VPC security groups.")
			}
			seen := map[string]bool{}
			for _, g := range groups {
				gv, gok := r.networkVPCID(g)
				if seen[g.ID] || g.ServiceType != serviceSecurityGroup || !gok || !ok || gv != network {
					reject(n, "CROSS_VPC_INVALID", "Every distinct security group must match the subnet group's canonical VPC/Region.")
				}
				seen[g.ID] = true
			}
			username, db := strings.ToLower(r.configString(n, "masterUsername")), strings.ToLower(r.configString(n, "databaseName"))
			if rdsReserved[username] || rdsReserved[db] || username == "rdsadmin" || strings.HasPrefix(username, "pg_") || db == "rdsadmin" || db == "postgres" || db == "template0" || db == "template1" {
				reject(n, "NAME_RESERVED", "Use explicit non-system database and master usernames.")
			}
			if !rdsWindowsValid(r.configString(n, "backupWindow"), r.configString(n, "maintenanceWindow")) {
				reject(n, "WINDOWS_INVALID", "Use same-day UTC backup and same-weekday maintenance windows of 30-120 minutes without overlap.")
			}
		}
	}
}
func (r *terraformRenderer) rdsWarnings(n NormalizedResource) {
	if n.ServiceType == serviceRdsInstance {
		r.warning("RDS_READINESS_EXTERNAL", "Export describes retained private PostgreSQL infrastructure only. Review actual Region/engine/class/CA/capacity, provisioning/service-linked-role authority, managed-secret readiness, TLS clients, backups, maintenance/replacement, final-snapshot-name availability and paid-resource cleanup externally. No database, data or business runtime is provisioned or verified.", SourceReference{Document: DocumentArchitecture, NodeID: n.ID})
	}
}

func rdsUser(n NormalizedResource) bool {
	return n.Lifecycle.Ownership == "user" && (n.Lifecycle.Origin == "user" || n.Lifecycle.Origin == "template" || n.Lifecycle.Origin == "ai-accepted" || n.Lifecycle.Origin == "migration")
}

// PostgreSQL 16 reserved identifiers; static local copy with source drift evidence.
//
//go:embed internal/contracts/rds-postgres-reserved-v1.json
var rdsReservedJSON []byte
var rdsReserved = func() map[string]bool {
	var words []string
	if json.Unmarshal(rdsReservedJSON, &words) != nil {
		panic("invalid reviewed RDS reserved names")
	}
	m := map[string]bool{}
	for _, w := range words {
		m[w] = true
	}
	return m
}()
