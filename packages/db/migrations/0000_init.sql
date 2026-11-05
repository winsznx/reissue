CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"case_epoch" integer NOT NULL,
	"type" text NOT NULL,
	"filename" text NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"manifest" jsonb NOT NULL,
	"superseded" boolean DEFAULT false NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"sha256" text PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_ref" jsonb NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"case_epoch" integer NOT NULL,
	"validation_run_id" text NOT NULL,
	"field_key" text NOT NULL,
	"lhs_field_ref" text,
	"rhs_field_ref" text,
	"status" text NOT NULL,
	"rule_id" text NOT NULL,
	"required" boolean NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"person_display" text NOT NULL,
	"switch_participant_id" text,
	"switch_name" text,
	"platform" text NOT NULL,
	"allowed_role" text NOT NULL,
	"supplier_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"page_no" integer NOT NULL,
	"info" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text,
	"shipment_id" text NOT NULL,
	"intake_id" text,
	"version_no" integer,
	"state" text NOT NULL,
	"sha256" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"source_platform" text NOT NULL,
	"source_room_id" text,
	"source_message_id" text,
	"sender_ref" text,
	"sender_name" text,
	"received_at" timestamp with time zone NOT NULL,
	"supersedes_version_id" text,
	"page_start" integer DEFAULT 1 NOT NULL,
	"page_end" integer,
	"revision_label" text,
	"document_date" text,
	"classification_confidence" real,
	"classification_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quarantine_reason" text,
	"failure_reason" text,
	"epoch" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"logical_document_key" text NOT NULL,
	"current_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "download_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"issued_to" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extracted_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"field_path" text NOT NULL,
	"normalized_value" text NOT NULL,
	"unit" text,
	"raw_text" text NOT NULL,
	"page_no" integer NOT NULL,
	"source" jsonb NOT NULL,
	"parser" text NOT NULL,
	"confidence" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"code" text NOT NULL,
	"root_cause_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"severity" text NOT NULL,
	"responsible_role" text NOT NULL,
	"assignee" text,
	"title" text NOT NULL,
	"check_ids" jsonb NOT NULL,
	"requested_doc_type" text,
	"needs_human_fact" boolean NOT NULL,
	"opened_epoch" integer NOT NULL,
	"resolved_epoch" integer,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text,
	"job_type" text NOT NULL,
	"queue_job_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"next_run_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"last_error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"row_index" integer NOT NULL,
	"sku" text,
	"description" text NOT NULL,
	"quantity" text,
	"unit" text,
	"quantity_raw" text,
	"packages" text,
	"package_unit" text,
	"packages_raw" text,
	"unit_price" text,
	"extended_total" text,
	"net_weight" text,
	"net_weight_unit" text,
	"gross_weight" text,
	"gross_weight_unit" text,
	"cbm" text,
	"pieces_per_package" text,
	"page_no" integer NOT NULL,
	"source" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"invoice_line_id" text,
	"packing_line_id" text,
	"method" text NOT NULL,
	"confidence" real NOT NULL,
	"reviewer_confirmation" text
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_ref" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text,
	"purpose" text NOT NULL,
	"target_room_id" text NOT NULL,
	"thread_id" text,
	"content_json" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"switch_event_id" text,
	"visibility" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "room_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"switch_room_id" text NOT NULL,
	"platform" text NOT NULL,
	"intent" text NOT NULL,
	"label" text NOT NULL,
	"supplier_id" text,
	"can_receive_sensitive" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"scenario_id" text NOT NULL,
	"shipment_id" text,
	"status" text NOT NULL,
	"expected" jsonb NOT NULL,
	"observed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"case_code" text NOT NULL,
	"supplier_id" text,
	"supplier_name" text,
	"consignee" text,
	"invoice_reference" text,
	"purchase_order" text,
	"state" text NOT NULL,
	"current_epoch" integer DEFAULT 1 NOT NULL,
	"assigned_to" text,
	"conversions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mapping_overrides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ops_room_id" text,
	"ops_thread_id" text,
	"supplier_room_id" text,
	"supplier_thread_id" text,
	"paused_reason" text,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text,
	"switch_room_id" text NOT NULL,
	"thread_id" text,
	"message_id" text NOT NULL,
	"sender" text NOT NULL,
	"sender_name" text NOT NULL,
	"body" text NOT NULL,
	"classification" text NOT NULL,
	"stated_value" text,
	"related_issue_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"reminder_policy" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "switch_cursors" (
	"connection_key" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"room_id" text NOT NULL,
	"cursor" bigint,
	"generation" integer,
	"server_version" text,
	"state" text NOT NULL,
	"last_connected_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "switch_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"connection_key" text NOT NULL,
	"switch_event_sequence" bigint,
	"message_id" text,
	"room_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"issue_ids" jsonb NOT NULL,
	"kind" text NOT NULL,
	"assignee" text NOT NULL,
	"requested_action" text NOT NULL,
	"status" text NOT NULL,
	"epoch" integer NOT NULL,
	"switch_room_id" text,
	"switch_message_id" text,
	"result" jsonb,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"case_sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"input_epoch" integer NOT NULL,
	"input_version_ids" jsonb NOT NULL,
	"tested_fields" integer NOT NULL,
	"results_json" jsonb NOT NULL,
	"model_id" text,
	"timings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_sha256_blobs_sha256_fk" FOREIGN KEY ("sha256") REFERENCES "public"."blobs"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_tokens" ADD CONSTRAINT "download_tokens_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_matches" ADD CONSTRAINT "line_matches_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bindings" ADD CONSTRAINT "room_bindings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bindings" ADD CONSTRAINT "room_bindings_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_messages" ADD CONSTRAINT "supplier_messages_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_runs" ADD CONSTRAINT "validation_runs_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_epoch_type" ON "artifacts" USING btree ("shipment_id","case_epoch","type");--> statement-breakpoint
CREATE UNIQUE INDEX "events_shipment_seq" ON "case_events" USING btree ("shipment_id","sequence");--> statement-breakpoint
CREATE INDEX "checks_run" ON "checks" USING btree ("validation_run_id");--> statement-breakpoint
CREATE INDEX "checks_shipment_epoch" ON "checks" USING btree ("shipment_id","case_epoch");--> statement-breakpoint
CREATE INDEX "contacts_participant" ON "contacts" USING btree ("switch_participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_version_page" ON "document_pages" USING btree ("version_id","page_no");--> statement-breakpoint
CREATE INDEX "versions_shipment" ON "document_versions" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "versions_sha" ON "document_versions" USING btree ("shipment_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_shipment_key" ON "documents" USING btree ("shipment_id","logical_document_key");--> statement-breakpoint
CREATE INDEX "fields_version" ON "extracted_fields" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_shipment_root" ON "issues" USING btree ("shipment_id","root_cause_key");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_code" ON "issues" USING btree ("shipment_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "lines_version_row" ON "line_items" USING btree ("version_id","row_index");--> statement-breakpoint
CREATE INDEX "matches_shipment_epoch" ON "line_matches" USING btree ("shipment_id","epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user" ON "memberships" USING btree ("tenant_id","user_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_dedupe" ON "outbox_messages" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "outbox_state" ON "outbox_messages" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "room_bindings_room" ON "room_bindings" USING btree ("switch_room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_tenant_code" ON "shipments" USING btree ("tenant_id","case_code");--> statement-breakpoint
CREATE INDEX "shipments_state" ON "shipments" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "shipments_refs" ON "shipments" USING btree ("tenant_id","invoice_reference","purchase_order");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_messages_message" ON "supplier_messages" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "switch_events_dedupe" ON "switch_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "tasks_shipment" ON "tasks" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "validation_runs_shipment" ON "validation_runs" USING btree ("shipment_id");