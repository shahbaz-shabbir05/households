CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"doctor_id" uuid,
	"scheduled_on" text NOT NULL,
	"scheduled_at_time" text,
	"location" text,
	"reason" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"outcome_notes" text,
	"follow_up_on" text,
	"remind_days_before" integer DEFAULT 1 NOT NULL,
	"reminder_sent_on" text,
	"series_id" uuid,
	"occurrence_date" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "appointments_status_chk" CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
	CONSTRAINT "appointments_time_chk" CHECK ("appointments"."scheduled_at_time" IS NULL OR "appointments"."scheduled_at_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "appointments_follow_up_chk" CHECK ("appointments"."follow_up_on" IS NULL OR "appointments"."follow_up_on" >= "appointments"."scheduled_on")
);
--> statement-breakpoint
CREATE TABLE "doctors" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"specialty" text,
	"clinic" text,
	"phone" text,
	"address" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "medicine_doses" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"medicine_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"scheduled_on" text NOT NULL,
	"scheduled_at_time" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"recorded_at" timestamp with time zone,
	"recorded_by_member_id" uuid,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medicine_doses_status_chk" CHECK (status IN ('due', 'taken', 'skipped', 'missed')),
	CONSTRAINT "medicine_doses_recorded_chk" CHECK (("medicine_doses"."status" IN ('taken', 'skipped')) = ("medicine_doses"."recorded_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "medicines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dose_text" text NOT NULL,
	"frequency_text" text,
	"instructions" text,
	"reminder_times" text[] DEFAULT '{}'::text[] NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"quantity_remaining" numeric(10, 2),
	"refill_threshold" numeric(10, 2),
	"refill_notified_on" text,
	"prescribed_by_doctor_id" uuid,
	"series_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "medicines_period_chk" CHECK ("medicines"."end_date" IS NULL OR "medicines"."end_date" >= "medicines"."start_date"),
	CONSTRAINT "medicines_quantity_chk" CHECK ("medicines"."quantity_remaining" IS NULL OR "medicines"."quantity_remaining" >= 0)
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_series_id_recurring_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicine_doses" ADD CONSTRAINT "medicine_doses_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicine_doses" ADD CONSTRAINT "medicine_doses_medicine_id_medicines_id_fk" FOREIGN KEY ("medicine_id") REFERENCES "public"."medicines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicine_doses" ADD CONSTRAINT "medicine_doses_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicine_doses" ADD CONSTRAINT "medicine_doses_recorded_by_member_id_household_members_id_fk" FOREIGN KEY ("recorded_by_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_prescribed_by_doctor_id_doctors_id_fk" FOREIGN KEY ("prescribed_by_doctor_id") REFERENCES "public"."doctors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_series_id_recurring_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_schedule_idx" ON "appointments" USING btree ("household_id","scheduled_on") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "appointments_member_idx" ON "appointments" USING btree ("household_id","member_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "appointments_upcoming_global_idx" ON "appointments" USING btree ("scheduled_on") WHERE status = 'scheduled' AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_series_occurrence_uq" ON "appointments" USING btree ("series_id","occurrence_date") WHERE series_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "doctors_household_idx" ON "doctors" USING btree ("household_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "doctors_name_uq" ON "doctors" USING btree ("household_id",lower("name")) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "medicine_doses_uq" ON "medicine_doses" USING btree ("medicine_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "medicine_doses_day_idx" ON "medicine_doses" USING btree ("household_id","scheduled_on","status");--> statement-breakpoint
CREATE INDEX "medicine_doses_member_idx" ON "medicine_doses" USING btree ("member_id","scheduled_on");--> statement-breakpoint
CREATE INDEX "medicine_doses_due_global_idx" ON "medicine_doses" USING btree ("scheduled_at") WHERE status = 'due';--> statement-breakpoint
CREATE INDEX "medicines_member_idx" ON "medicines" USING btree ("household_id","member_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "medicines_active_idx" ON "medicines" USING btree ("household_id","end_date") WHERE deleted_at IS NULL;