package compiler

// exceedsJSONDepth stops descending as soon as the configured bound is
// crossed, so maliciously deep input cannot force an unbounded recursive walk
// after JSON decoding.
func exceedsJSONDepth(value any, depth int, maximum int) bool {
	if depth > maximum {
		return true
	}
	switch typed := value.(type) {
	case map[string]any:
		for _, child := range typed {
			if exceedsJSONDepth(child, depth+1, maximum) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if exceedsJSONDepth(child, depth+1, maximum) {
				return true
			}
		}
	}
	return false
}
