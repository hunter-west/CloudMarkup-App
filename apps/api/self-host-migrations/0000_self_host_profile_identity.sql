-- Standalone profile identity, never a hosted migration or an activation marker.
-- The reviewed operator must already own this database. No login is provisioned.
DO $self_host_profile_admission$
BEGIN
  IF session_user <> 'cloudmarkup_admin' OR current_user <> 'cloudmarkup_admin'
    OR pg_catalog.current_database() <> 'cloudmarkup'
    OR pg_catalog.current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
    OR pg_catalog.current_setting('session_replication_role') <> 'origin'
    OR pg_catalog.current_setting('createrole_self_grant') <> ''
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('rdsadmin','rds_superuser'))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_database d ON d.datdba=r.oid
      WHERE r.rolname='cloudmarkup_admin' AND d.datname=pg_catalog.current_database()
        AND r.rolcanlogin AND r.rolcreaterole AND NOT r.rolsuper AND NOT r.rolbypassrls
        AND NOT r.rolinherit AND NOT r.rolcreatedb AND NOT r.rolreplication
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='cloudmarkup_owner' AND rolsuper AND rolcanlogin)
    OR EXISTS(SELECT 1 FROM public.cloudmarkup_schema_migrations)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND c.relkind IN ('r','p','v','m','S','f')
        AND c.oid <> 'public.cloudmarkup_schema_migrations'::regclass)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')
  THEN RAISE EXCEPTION 'Fresh standalone PostgreSQL17 profile required' USING ERRCODE='42501'; END IF;
END;
$self_host_profile_admission$;

CREATE TABLE public.cloudmarkup_installation_profile (
  singleton boolean PRIMARY KEY CHECK(singleton),
  profile_id text NOT NULL CHECK(profile_id='cloudmarkup-standalone-pg17-v1'),
  profile_version integer NOT NULL CHECK(profile_version=1),
  engine_major integer NOT NULL CHECK(engine_major=17),
  schema_owner text NOT NULL CHECK(schema_owner='cloudmarkup_admin'),
  bootstrap_grantor text NOT NULL CHECK(bootstrap_grantor='cloudmarkup_owner')
);
ALTER TABLE public.cloudmarkup_installation_profile OWNER TO cloudmarkup_admin;
REVOKE ALL ON TABLE public.cloudmarkup_installation_profile FROM PUBLIC;
INSERT INTO public.cloudmarkup_installation_profile
  VALUES(true,'cloudmarkup-standalone-pg17-v1',1,17,'cloudmarkup_admin','cloudmarkup_owner');

CREATE FUNCTION public.cloudmarkup_self_host_profile_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Installation profile is immutable' USING ERRCODE='42501';
END;
$$;
REVOKE ALL ON FUNCTION public.cloudmarkup_self_host_profile_immutable_v1() FROM PUBLIC;
CREATE TRIGGER self_host_profile_immutable BEFORE UPDATE OR DELETE ON public.cloudmarkup_installation_profile
  FOR EACH ROW EXECUTE FUNCTION public.cloudmarkup_self_host_profile_immutable_v1();
