-- Preserve the complete reviewed audit target-kind union when restoring the
-- billing webhook audit target introduced by migration 0008.
ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_target_kind_check,
  ADD CONSTRAINT audit_events_target_kind_check CHECK (
    target_kind IN (
      'organization',
      'membership',
      'project',
      'draft',
      'revision',
      'artifact',
      'integration',
      'billing-account',
      'installation',
      'repository',
      'preview',
      'webhook',
      'export',
      'job'
    )
  );
