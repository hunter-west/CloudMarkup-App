# Pure reviewed graph preparation

Shared provider-neutral catalog, placement, configuration and workload command
preparation extracted from the editor. These functions have no React, browser
state, persistence, network, model, clock or random dependencies. Callers supply
reviewed catalog/resolver ports and deterministic IDs; returned commands are
untrusted until domain application and complete validation succeed. AWS proposal
composition lives in the AWS provider, authorization in the API host. Existing
editor module paths re-export these exact functions for compatibility.
