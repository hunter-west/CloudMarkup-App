-- PostgreSQL validates trigger-record fields against the table that fired the
-- trigger. Keep table-specific NEW fields inside table-specific PL/pgSQL
-- branches when one trigger function is shared by multiple row types.

CREATE OR REPLACE FUNCTION validate_credit_grant_funding_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  grant_row credit_grants%ROWTYPE;
  funding_event_count BIGINT;
  funding_event_matches BIGINT;
BEGIN
  SELECT * INTO grant_row
  FROM credit_grants
  WHERE organization_id = NEW.organization_id
    AND credit_grant_id = NEW.credit_grant_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'usage_ledger_entry_allocations' THEN
    IF NEW.credit_adjustment_units > 0
       AND grant_row.grant_kind <> 'administrative' THEN
      RAISE EXCEPTION 'positive credit adjustment must fund an administrative grant'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF grant_row.grant_kind = 'administrative' THEN
    SELECT COUNT(*) INTO funding_event_count
    FROM usage_ledger_entry_allocations allocation
    WHERE allocation.organization_id = grant_row.organization_id
      AND allocation.credit_grant_id = grant_row.credit_grant_id
      AND allocation.credit_adjustment_units > 0;
    SELECT COUNT(*) INTO funding_event_matches
    FROM usage_ledger_entry_allocations allocation
    JOIN usage_ledger_entries event
      ON event.organization_id = allocation.organization_id
     AND event.ledger_entry_id = allocation.ledger_entry_id
    WHERE allocation.organization_id = grant_row.organization_id
      AND allocation.credit_grant_id = grant_row.credit_grant_id
      AND allocation.credit_adjustment_units = grant_row.credit_units
      AND allocation.reserved_credit_units = 0
      AND allocation.settled_credit_units = 0
      AND allocation.released_credit_units = 0
      AND allocation.expired_credit_units = 0
      AND event.entry_kind = 'adjustment'
      AND event.credit_adjustment_units = grant_row.credit_units
      AND event.billing_account_id = grant_row.billing_account_id
      AND event.recorded_by_actor_kind = grant_row.created_by_actor_kind
      AND event.recorded_by_actor_id = grant_row.created_by_actor_id
      AND event.outcome = 'compensated';
  ELSE
    SELECT COUNT(*) INTO funding_event_count
    FROM usage_ledger_entries event
    WHERE event.organization_id = grant_row.organization_id
      AND event.credit_grant_id = grant_row.credit_grant_id
      AND event.entry_kind = 'grant';
    SELECT COUNT(*) INTO funding_event_matches
    FROM usage_ledger_entries event
    WHERE event.organization_id = grant_row.organization_id
      AND event.credit_grant_id = grant_row.credit_grant_id
      AND event.entry_kind = 'grant'
      AND event.billing_account_id = grant_row.billing_account_id
      AND event.plan_version_id IS NOT DISTINCT FROM grant_row.plan_version_id
      AND event.granted_credit_units = grant_row.credit_units
      AND event.recorded_by_actor_kind = grant_row.created_by_actor_kind
      AND event.recorded_by_actor_id = grant_row.created_by_actor_id
      AND event.outcome = 'granted';
  END IF;

  IF funding_event_count <> 1 OR funding_event_matches <> 1 THEN
    RAISE EXCEPTION 'credit grant funding does not reconcile with its ledger event'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION validate_credit_grant_balance_invariant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  grant_row credit_grants%ROWTYPE;
  event_occurred_at TIMESTAMPTZ;
  funding_total NUMERIC;
  settled_total NUMERIC;
  active_reserved_total NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'usage_ledger_entry_allocations' THEN
    IF NEW.credit_adjustment_units >= 0 THEN
      RETURN NULL;
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'commercial-grant-balance:' || NEW.organization_id || ':' || NEW.credit_grant_id,
    0
  ));
  SELECT * INTO grant_row
  FROM credit_grants
  WHERE organization_id = NEW.organization_id
    AND credit_grant_id = NEW.credit_grant_id;
  IF NOT FOUND
     OR grant_row.expiration_policy_kind = 'unresolved' THEN
    RAISE EXCEPTION 'credit allocation targets an ineligible grant'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'usage_ledger_entry_allocations' THEN
    SELECT occurred_at INTO event_occurred_at
    FROM usage_ledger_entries
    WHERE organization_id = NEW.organization_id
      AND ledger_entry_id = NEW.ledger_entry_id
      AND entry_kind = 'adjustment';
  ELSE
    SELECT created_at INTO event_occurred_at
    FROM credit_reservations
    WHERE organization_id = NEW.organization_id
      AND reservation_id = NEW.reservation_id;
  END IF;
  IF NOT FOUND
     OR event_occurred_at < grant_row.starts_at
     OR (grant_row.expires_at IS NOT NULL
       AND event_occurred_at >= grant_row.expires_at)
     OR ((TG_TABLE_NAME = 'usage_ledger_entry_allocations' OR TG_OP = 'INSERT')
       AND (CURRENT_TIMESTAMP < grant_row.starts_at
         OR (grant_row.expires_at IS NOT NULL
           AND CURRENT_TIMESTAMP >= grant_row.expires_at))) THEN
    RAISE EXCEPTION 'credit allocation targets an ineligible grant'
      USING ERRCODE = '23514';
  END IF;

  SELECT (CASE WHEN grant_row.grant_kind = 'administrative'
           THEN 0 ELSE grant_row.credit_units END)
         + COALESCE(SUM(allocation.credit_adjustment_units), 0)
  INTO funding_total
  FROM usage_ledger_entry_allocations allocation
  WHERE allocation.organization_id = grant_row.organization_id
    AND allocation.credit_grant_id = grant_row.credit_grant_id;
  SELECT COALESCE(SUM(allocation.settled_credit_units), 0)
  INTO settled_total
  FROM credit_reservation_allocations allocation
  WHERE allocation.organization_id = grant_row.organization_id
    AND allocation.credit_grant_id = grant_row.credit_grant_id;
  SELECT COALESCE(SUM(allocation.reserved_credit_units), 0)
  INTO active_reserved_total
  FROM credit_reservation_allocations allocation
  JOIN credit_reservations reservation
    ON reservation.organization_id = allocation.organization_id
   AND reservation.reservation_id = allocation.reservation_id
  WHERE allocation.organization_id = grant_row.organization_id
    AND allocation.credit_grant_id = grant_row.credit_grant_id
    AND reservation.status = 'active';
  IF funding_total - settled_total - active_reserved_total < 0 THEN
    RAISE EXCEPTION 'credit allocation would overdraw its grant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
