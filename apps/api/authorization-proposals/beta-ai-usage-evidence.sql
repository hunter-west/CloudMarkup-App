-- UNAPPLIED ordinary-role authority delta for migration 0140.
-- This file grants no active authority until independently admitted through the existing source/role gates.
-- Delta to the existing ordinary-role proposal, NOT a broad table grant.
-- API owns its verified request/synchronous source path; proposal role owns
-- admitted background proposal work. Neither receives new dispatch/ledger rights.
GRANT SELECT (dispatched_at,usage_recorded_at,terminal_at,usage_observed_at,
  observed_provider_request_id,observed_input_tokens,observed_output_tokens,observed_cached_input_tokens)
  ON TABLE public.beta_ai_invocations TO cloudmarkup_beta_api_runtime,cloudmarkup_beta_proposal_runtime;
GRANT UPDATE (usage_observed_at,observed_provider_request_id,observed_input_tokens,
  observed_output_tokens,observed_cached_input_tokens)
  ON TABLE public.beta_ai_invocations TO cloudmarkup_beta_api_runtime,cloudmarkup_beta_proposal_runtime;

-- Internal accounting projection only. No customer-summary API change.
GRANT SELECT (organization_id,reservation_id,project_id,job_id,purpose,request_sha256,
  state,dispatched_at,usage_recorded_at,provider_request_id,input_tokens,output_tokens,cached_input_tokens,
  usage_observed_at,observed_provider_request_id,observed_input_tokens,observed_output_tokens,observed_cached_input_tokens)
  ON TABLE public.beta_ai_invocations TO cloudmarkup_beta_billing_runtime;
-- ADDITION to the existing billing role: its frozen ACL lacks this pricing read grant;
-- no SELECT * and no added access to storage_contract_version/created_at.
GRANT SELECT (pricing_version_id,provider_key,model_key,model_version,cost_currency,
  input_micros_per_million_tokens,output_micros_per_million_tokens,cached_input_micros_per_million_tokens)
  ON TABLE public.provider_pricing_versions TO cloudmarkup_beta_billing_runtime;

-- No new DELETE grant or retention override. The five new columns follow the
-- existing invocation/financial retention, backup and authorized restore rules.
-- No backfill: old retained operational or ledger evidence is a read fallback;
-- erased/unknown history remains unknown. All previous migration bytes stay intact.
