-- Core's functions a plugin calls in its own transactions (core_publish_event,
-- core_record_audit, core_live_signal), as erxes packages/db/drizzle defines
-- them, and the core tables they write. Tests install them, so a procedure that
-- publishes runs, and a test reads its events back from core_events.
CREATE OR REPLACE FUNCTION core_publish_event(
  p_org_id text,
  p_source text,
  p_type text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_subject_type text DEFAULT NULL,
  p_subject_id text DEFAULT NULL,
  p_summary text DEFAULT NULL,
  p_link text DEFAULT NULL,
  p_notify jsonb DEFAULT NULL,
  p_dedupe_key text DEFAULT NULL,
  p_actor_user_id text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_id text;
BEGIN
  IF p_type NOT LIKE p_source || '.%' THEN
    RAISE EXCEPTION 'core_publish_event: the type must start with "%."', p_source;
  END IF;
  IF p_subject_type IS NOT NULL AND p_subject_type NOT IN ('customer', 'company') THEN
    RAISE EXCEPTION 'core_publish_event: subject type must be customer or company';
  END IF;
  PERFORM core_enter_org(p_org_id, p_source);
  INSERT INTO core_events (
    id, org_id, source, type, payload, subject_type, subject_id, summary, link, notify, dedupe_key,
    actor_type, actor_id, entity_type, entity_id, occurred_at
  ) VALUES (
    replace(gen_random_uuid()::text, '-', ''), p_org_id, p_source, p_type, coalesce(p_payload, '{}'::jsonb),
    p_subject_type, p_subject_id, p_summary, p_link, p_notify, p_dedupe_key,
    CASE WHEN p_actor_user_id IS NULL THEN 'plugin' ELSE 'user' END, coalesce(p_actor_user_id, p_source),
    p_entity_type, p_entity_id, coalesce(p_occurred_at, now())
  )
  ON CONFLICT (org_id, source, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION core_record_audit(
  p_org_id text,
  p_source text,
  p_action text,
  p_actor_user_id text DEFAULT NULL,
  p_target_type text DEFAULT NULL,
  p_target_id text DEFAULT NULL,
  p_target_label text DEFAULT NULL,
  p_changes jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
) RETURNS text
-- As 0026 set it: plugin roles reach core only through this function.
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id text := replace(gen_random_uuid()::text, '-', '');
  v_changes jsonb := NULL;
  v_other jsonb := '{}'::jsonb;
  v_metadata jsonb := p_metadata;
BEGIN
  IF p_action NOT LIKE p_source || '.%' THEN
    RAISE EXCEPTION 'core_record_audit: the action must start with "%."', p_source;
  END IF;

  IF p_changes IS NOT NULL AND jsonb_typeof(p_changes) = 'object' THEN
    SELECT
      jsonb_object_agg(key, value) FILTER (
        WHERE jsonb_typeof(value) = 'array' AND jsonb_array_length(value) = 2
      ),
      coalesce(jsonb_object_agg(key, value) FILTER (
        WHERE NOT (jsonb_typeof(value) = 'array' AND jsonb_array_length(value) = 2)
      ), '{}'::jsonb)
    INTO v_changes, v_other
    FROM jsonb_each(p_changes);
  ELSIF p_changes IS NOT NULL AND jsonb_typeof(p_changes) <> 'null' THEN
    v_other := jsonb_build_object('changes', p_changes);
  END IF;

  IF v_other <> '{}'::jsonb THEN
    v_metadata := v_other || CASE
      WHEN jsonb_typeof(p_metadata) = 'object' THEN p_metadata
      ELSE '{}'::jsonb
    END;
  END IF;

  PERFORM core_enter_org(p_org_id, p_source);
  INSERT INTO core_audit_logs (
    id, org_id, source, actor_type, actor_id, action, target_type, target_id, target_label, changes, metadata, ip, user_agent
  ) VALUES (
    v_id, p_org_id, p_source, CASE WHEN p_actor_user_id IS NULL THEN 'plugin' ELSE 'user' END,
    coalesce(p_actor_user_id, p_source), p_action, p_target_type, p_target_id, p_target_label,
    v_changes, v_metadata, p_ip, p_user_agent
  );
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION core_live_signal(p_org_id text, p_plugin text, p_topic text, p_user_ids text[] DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_plugin !~ '^[a-z][a-z0-9_]{0,39}$' OR p_topic !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' THEN
    RAISE EXCEPTION 'core_live_signal: invalid plugin or topic';
  END IF;
  PERFORM core_enter_org(p_org_id, p_plugin);
  PERFORM core_live_topic(p_org_id, 'plugin:' || p_plugin || ':' || p_topic, p_user_ids);
END $$;
CREATE OR REPLACE FUNCTION core_enter_org(p_org_id text, p_plugin text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_current text := nullif(current_setting('app.org_id', true), '');
BEGIN
  IF v_current IS NULL THEN
    PERFORM set_config('app.org_id', p_org_id, true);
  ELSIF v_current <> p_org_id THEN
    RAISE EXCEPTION 'this transaction works for organisation %, not %', v_current, p_org_id;
  END IF;
END $$;
CREATE TABLE "core_events" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"tx_id" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	"org_id" text NOT NULL,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"entity_type" text,
	"entity_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"link" text,
	"notify" jsonb,
	"dedupe_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "core_events_seq_key" ON "core_events" USING btree ("seq");
CREATE INDEX "core_events_commit_order_idx" ON "core_events" USING btree ("tx_id","seq");
CREATE INDEX "core_events_org_created_idx" ON "core_events" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
CREATE INDEX "core_events_subject_idx" ON "core_events" USING btree ("org_id","subject_type","subject_id");
CREATE UNIQUE INDEX "core_events_dedupe_key" ON "core_events" USING btree ("org_id","source","dedupe_key") WHERE "core_events"."dedupe_key" IS NOT NULL;
ALTER TABLE "core_events" ADD COLUMN "caused_by_run" text;
ALTER TABLE "core_events" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;
ALTER TABLE "core_events" ALTER COLUMN "org_id" SET DEFAULT nullif(current_setting('app.org_id', true), '');
ALTER TABLE "core_events" DROP COLUMN "seq";
ALTER TABLE "core_events" DROP COLUMN "tx_id";
SELECT core_enable_tenant_rls('core_events');
GRANT SELECT, INSERT ON core_events TO PUBLIC;
CREATE TABLE "core_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_label" text,
	"changes" jsonb,
	"metadata" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "core_audit_logs_org_created_idx" ON "core_audit_logs" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
CREATE INDEX "core_audit_logs_target_idx" ON "core_audit_logs" USING btree ("org_id","target_type","target_id");
CREATE INDEX "core_audit_logs_actor_idx" ON "core_audit_logs" USING btree ("org_id","actor_id");
ALTER TABLE "core_audit_logs" ADD COLUMN "source" text DEFAULT 'core' NOT NULL;
ALTER TABLE "core_audit_logs" ADD COLUMN "chain_seq" bigint;
ALTER TABLE "core_audit_logs" ADD COLUMN "prev_hash" text;
ALTER TABLE "core_audit_logs" ADD COLUMN "hash" text;
CREATE INDEX "core_audit_logs_org_source_idx" ON "core_audit_logs" USING btree ("org_id","source","created_at" DESC NULLS LAST);
CREATE UNIQUE INDEX "core_audit_logs_chain_key" ON "core_audit_logs" USING btree ("org_id","chain_seq");
ALTER TABLE "core_audit_logs" ALTER COLUMN "org_id" SET DEFAULT nullif(current_setting('app.org_id', true), '');
CREATE INDEX "core_audit_logs_action_trgm_idx" ON "core_audit_logs" USING gin ("action" gin_trgm_ops);
CREATE INDEX "core_audit_logs_target_label_trgm_idx" ON "core_audit_logs" USING gin ("target_label" gin_trgm_ops);
SELECT core_enable_tenant_rls('core_audit_logs');
GRANT SELECT, INSERT ON core_audit_logs TO PUBLIC;
