CREATE TABLE "event_participants" (
	"event_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_participants_event_id_member_id_pk" PRIMARY KEY("event_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"event_type" text DEFAULT 'other' NOT NULL,
	"start_date" text NOT NULL,
	"start_time" text,
	"end_date" text,
	"end_time" text,
	"is_all_day" boolean DEFAULT true NOT NULL,
	"location" text,
	"created_by_member_id" uuid,
	"series_id" uuid,
	"occurrence_date" text,
	"is_detached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "events_type_chk" CHECK (event_type IN ('birthday', 'anniversary', 'wedding', 'school', 'gathering', 'religious', 'holiday', 'trip', 'meeting', 'appointment', 'personal', 'other')),
	CONSTRAINT "events_order_chk" CHECK ("events"."end_date" IS NULL OR "events"."end_date" >= "events"."start_date"),
	CONSTRAINT "events_all_day_chk" CHECK (NOT "events"."is_all_day" OR "events"."start_time" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity_type" text,
	"entity_id" uuid,
	"remind_at" timestamp with time zone NOT NULL,
	"remind_on_date" text NOT NULL,
	"remind_at_time" text NOT NULL,
	"assignee_member_id" uuid,
	"created_by_member_id" uuid,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"fired_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"series_id" uuid,
	"occurrence_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "reminders_status_chk" CHECK (status IN ('pending', 'sent', 'snoozed', 'dismissed', 'missed')),
	CONSTRAINT "reminders_priority_chk" CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "reminders_entity_chk" CHECK ("reminders"."entity_type" IS NULL OR "reminders"."entity_type" IN ('task', 'event', 'reminder', 'bill', 'expense', 'inventory_item', 'shopping_list', 'appointment', 'medicine', 'medicine_dose', 'document', 'asset', 'maintenance_record', 'household_member', 'household', 'contact', 'note'))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"assignee_member_id" uuid,
	"created_by_member_id" uuid,
	"due_date" text,
	"due_time" text,
	"start_date" text,
	"estimated_minutes" integer,
	"completed_at" timestamp with time zone,
	"completed_by_member_id" uuid,
	"series_id" uuid,
	"occurrence_date" text,
	"is_detached" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "tasks_status_chk" CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "tasks_priority_chk" CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "tasks_category_chk" CHECK (category IN ('chore', 'cleaning', 'shopping', 'school', 'work', 'family', 'maintenance', 'finance', 'health', 'personal', 'other')),
	CONSTRAINT "tasks_completed_chk" CHECK ("tasks"."status" <> 'completed' OR "tasks"."completed_at" IS NOT NULL),
	CONSTRAINT "tasks_due_time_chk" CHECK ("tasks"."due_time" IS NULL OR "tasks"."due_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_member_id_household_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_series_id_recurring_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_assignee_member_id_household_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_created_by_member_id_household_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_series_id_recurring_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_member_id_household_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_member_id_household_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_member_id_household_members_id_fk" FOREIGN KEY ("completed_by_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_series_id_recurring_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_participants_member_idx" ON "event_participants" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "events_range_idx" ON "events" USING btree ("household_id","start_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("household_id","event_type") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_series_occurrence_uq" ON "events" USING btree ("series_id","occurrence_date") WHERE series_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reminders_household_idx" ON "reminders" USING btree ("household_id","status","remind_at") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "reminders_pending_global_idx" ON "reminders" USING btree ("remind_at") WHERE status = 'pending' AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_series_occurrence_uq" ON "reminders" USING btree ("series_id","occurrence_date") WHERE series_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("household_id","status","due_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("household_id","assignee_member_id","status","due_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "tasks_category_idx" ON "tasks" USING btree ("household_id","category") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_series_occurrence_uq" ON "tasks" USING btree ("series_id","occurrence_date") WHERE series_id IS NOT NULL;