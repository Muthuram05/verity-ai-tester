CREATE OR REPLACE FUNCTION immutable_run_manifest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.manifest,NEW.manifest_hash,NEW.request_hash,NEW.idempotency_key,NEW.org_id,NEW.project_id,NEW.environment_id,NEW.suite_id,NEW.actor_id)
    IS DISTINCT FROM ROW(OLD.manifest,OLD.manifest_hash,OLD.request_hash,OLD.idempotency_key,OLD.org_id,OLD.project_id,OLD.environment_id,OLD.suite_id,OLD.actor_id)
  THEN RAISE EXCEPTION 'Run manifest is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_manifest BEFORE UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION immutable_run_manifest();
CREATE OR REPLACE FUNCTION immutable_suite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Create a new suite to change its version snapshot'; END $$;
CREATE TRIGGER immutable_suite BEFORE UPDATE ON suites FOR EACH ROW EXECUTE FUNCTION immutable_suite();
INSERT INTO schema_migrations(version) VALUES(2);
