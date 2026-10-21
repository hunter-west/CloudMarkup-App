CREATE TABLE organization_entitlement_snapshots (
  organization_id VARCHAR(128) PRIMARY KEY REFERENCES organizations(organization_id),
  storage_contract_version SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (storage_contract_version = 0)
);

COMMENT ON TABLE organization_entitlement_snapshots IS
  'Prompt 21 ownership placeholder only. Prompts 24A-24C must evolve this table in place before any entitlement row is written.';

CREATE TABLE usage_ledger_entries (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  ledger_entry_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 0,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, ledger_entry_id),
  UNIQUE (organization_id, idempotency_key_sha256),
  CHECK (ledger_entry_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 0),
  CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE usage_ledger_entries IS
  'Prompt 21 ownership placeholder only. Prompts 24A-24C must evolve this table in place before any usage row is written.';

CREATE TRIGGER usage_ledger_entries_are_immutable
BEFORE UPDATE OR DELETE ON usage_ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
