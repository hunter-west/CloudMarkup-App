package compiler

import (
	"net/url"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

var s3SharedNameCharacters = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
var s3IPStyleName = regexp.MustCompile(`^[0-9]{1,3}(\.[0-9]{1,3}){3}$`)

func validS3SharedBucketName(name string) bool {
	if !s3SharedNameCharacters.MatchString(name) || strings.Contains(name, "..") || s3IPStyleName.MatchString(name) {
		return false
	}
	for _, prefix := range []string{"xn--", "sthree-", "amzn-s3-demo-"} {
		if strings.HasPrefix(name, prefix) {
			return false
		}
	}
	for _, suffix := range []string{"-s3alias", "--ol-s3", ".mrap", "--x-s3", "--table-s3", "-an"} {
		if strings.HasSuffix(name, suffix) {
			return false
		}
	}
	return true
}
func s3FilterKey(value string) (string, bool) {
	if len(value) > 1024 {
		return "", false
	}
	for _, character := range value {
		if character < 33 || character > 126 || character == '*' {
			return "", false
		}
	}
	decoded, err := url.QueryUnescape(value)
	return decoded, err == nil && utf8.ValidString(decoded) && !strings.Contains(decoded, "*")
}

type s3NotificationFilter struct {
	connection     NormalizedConnection
	prefix, suffix string
}

func s3FiltersOverlap(left, right s3NotificationFilter) bool {
	return (strings.HasPrefix(left.prefix, right.prefix) || strings.HasPrefix(right.prefix, left.prefix)) && (strings.HasSuffix(left.suffix, right.suffix) || strings.HasSuffix(right.suffix, left.suffix))
}
func (renderer *terraformRenderer) validateS3Accuracy() {
	if !isCurrentAwsCatalog(renderer.model.Provenance.Catalog) {
		return
	}
	for _, resource := range renderer.model.Resources {
		if resource.ServiceType != "aws.s3.bucket" {
			continue
		}
		if !validS3SharedBucketName(renderer.configString(resource, "bucketName")) {
			renderer.error("TARGET_S3_BUCKET_NAME_INVALID", "bucketName must be a supported general-purpose shared-namespace name. Adjacent dots, IP-style names and reserved prefixes/suffixes are unsupported; changing a name may replace the bucket.", SourceReference{Document: DocumentArchitecture, NodeID: resource.ID})
		}
	}
	connections := append([]NormalizedConnection(nil), renderer.model.Connections...)
	sort.Slice(connections, func(i, j int) bool { return compareUTF16(connections[i].ID, connections[j].ID) < 0 })
	type group struct{ bucket, event string }
	previous := make(map[group][]s3NotificationFilter)
	for _, connection := range connections {
		if err := renderer.ctx.Err(); err != nil {
			renderer.error("COMPILER_CANCELED", "S3 admission was canceled.", SourceReference{Document: DocumentArchitecture})
			return
		}
		if connection.RelationshipType != "aws.s3.notifies-lambda" {
			continue
		}
		prefix, prefixOK := s3FilterKey(renderer.connectionString(connection, "filterPrefix"))
		suffix, suffixOK := s3FilterKey(renderer.connectionString(connection, "filterSuffix"))
		if !prefixOK || !suffixOK {
			renderer.error("TARGET_S3_NOTIFICATION_FILTER_INVALID", "filterPrefix and filterSuffix must use valid percent-encoded UTF-8, with no raw non-ASCII, whitespace, control characters or wildcard asterisk; each filter is limited to 1024 characters.", SourceReference{Document: DocumentArchitecture, EdgeID: connection.ID})
			continue
		}
		event := renderer.connectionString(connection, "eventType")
		if event != "OBJECT_CREATED" && event != "OBJECT_REMOVED" {
			continue
		}
		key := group{connection.Source.NodeID, event}
		right := s3NotificationFilter{connection, prefix, suffix}
		// One stable earlier conflict per edge bounds diagnostic growth by graph size.
		for _, left := range previous[key] {
			if !s3FiltersOverlap(left, right) {
				continue
			}
			renderer.diagnostics = append(renderer.diagnostics, Diagnostic{
				Code: "TARGET_S3_NOTIFICATION_FILTERS_OVERLAP", Severity: SeverityError,
				Message: "Direct S3 notifications for the same event family have overlapping filterPrefix and filterSuffix values. Review both routes without inferring a destination or rewriting filters.",
				Source:  SourceReference{Document: DocumentArchitecture, EdgeID: right.connection.ID},
				Related: []SourceReference{{Document: DocumentArchitecture, EdgeID: left.connection.ID}},
			})
			break
		}
		previous[key] = append(previous[key], right)
	}
}
