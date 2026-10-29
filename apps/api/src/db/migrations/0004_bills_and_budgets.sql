CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bill_type" text DEFAULT 'utility' NOT NULL,
	"provider_id" uuid,
	"account_number" text,
	"period_start" text,
	"period_end" text,
	"issue_date" text,
	"due_date" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"paid_amount_minor" bigint,
	"paid_on" text,
	"payment_method" text,
	"expense_id" uuid,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"expense_category" text DEFAULT 'utilities' NOT NULL,
	"owner_member_id" uuid,
	"remind_days_before" bigint DEFAULT 3 NOT NULL,
	"reminder_sent_on" text,
	"series_id" uuid,
	"occurrence_date" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "bills_type_chk" CHECK (bill_type IN ('utility', 'rent', 'subscription', 'fee', 'insurance', 'other')),
	CONSTRAINT "bills_status_chk" CHECK (status IN ('upcoming', 'due', 'overdue', 'paid', 'cancelled')),
	CONSTRAINT "bills_expense_category_chk" CHECK (expense_category IN ('groceries', 'utilities', 'rent', 'education', 'medical', 'transport', 'clothing', 'household', 'entertainment', 'dining', 'travel', 'gifts', 'personal', 'subscriptions', 'maintenance', 'other')),
	CONSTRAINT "bills_payment_method_chk" CHECK ("bills"."payment_method" IS NULL OR payment_method IN ('cash', 'bank_transfer', 'debit_card', 'credit_card', 'easypaisa', 'jazzcash', 'cheque', 'other')),
	CONSTRAINT "bills_amount_chk" CHECK ("bills"."amount_minor" >= 0),
	CONSTRAINT "bills_currency_chk" CHECK ("bills"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "bills_paid_chk" CHECK (("bills"."status" = 'paid') = ("bills"."paid_on" IS NOT NULL)),
	CONSTRAINT "bills_period_chk" CHECK ("bills"."period_end" IS NULL OR "bills"."period_start" IS NULL OR "bills"."period_end" >= "bills"."period_start")
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"category" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"starts_on" text NOT NULL,
	"ends_on" text,
	"warn_at_percent" bigint DEFAULT 80 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "budgets_category_chk" CHECK ("budgets"."category" IS NULL OR category IN ('groceries', 'utilities', 'rent', 'education', 'medical', 'transport', 'clothing', 'household', 'entertainment', 'dining', 'travel', 'gifts', 'personal', 'subscriptions', 'maintenance', 'other')),
	CONSTRAINT "budgets_amount_chk" CHECK ("budgets"."amount_minor" > 0),
	CONSTRAINT "budgets_warn_chk" CHECK ("budgets"."warn_at_percent" > 0 AND "budgets"."warn_at_percent" <= 100),
	CONSTRAINT "budgets_period_chk" CHECK ("budgets"."ends_on" IS NULL OR "budgets"."ends_on" >= "budgets"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"utility_kind" text,
	"account_number" text,
	"phone" text,
	"website" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "providers_utility_kind_chk" CHECK ("providers"."utility_kind" IS NULL OR utility_kind IN ('electricity', 'gas', 'water', 'internet', 'mobile', 'telephone', 'tv', 'waste', 'security', 'other'))
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "bill_id" uuid;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_owner_member_id_household_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_series_id_recurring_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bills_due_idx" ON "bills" USING btree ("household_id","status","due_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "bills_type_idx" ON "bills" USING btree ("household_id","bill_type") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "bills_provider_idx" ON "bills" USING btree ("household_id","provider_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "bills_unpaid_global_idx" ON "bills" USING btree ("due_date") WHERE paid_on IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bills_series_occurrence_uq" ON "bills" USING btree ("series_id","occurrence_date") WHERE series_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_category_uq" ON "budgets" USING btree ("household_id",coalesce("category", '__overall__')) WHERE ends_on IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "budgets_household_idx" ON "budgets" USING btree ("household_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "providers_name_uq" ON "providers" USING btree ("household_id",lower("name")) WHERE deleted_at IS NULL;