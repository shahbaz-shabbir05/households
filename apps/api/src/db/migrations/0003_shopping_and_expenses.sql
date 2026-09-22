CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"spent_on" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"subcategory" text,
	"paid_by_member_id" uuid,
	"for_member_id" uuid,
	"payment_method" text DEFAULT 'cash' NOT NULL,
	"merchant" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "expenses_amount_chk" CHECK ("expenses"."amount_minor" >= 0),
	CONSTRAINT "expenses_currency_chk" CHECK ("expenses"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "expenses_category_chk" CHECK (category IN ('groceries', 'utilities', 'rent', 'education', 'medical', 'transport', 'clothing', 'household', 'entertainment', 'dining', 'travel', 'gifts', 'personal', 'subscriptions', 'maintenance', 'other')),
	CONSTRAINT "expenses_payment_method_chk" CHECK (payment_method IN ('cash', 'bank_transfer', 'debit_card', 'credit_card', 'easypaisa', 'jazzcash', 'cheque', 'other'))
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text DEFAULT 'grocery' NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"unit" text DEFAULT 'piece' NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"min_quantity" numeric(12, 3),
	"location" text,
	"expiry_date" text,
	"brand" text,
	"preferred_brand" text,
	"estimated_price_minor" bigint,
	"restock_interval_days" integer,
	"last_purchased_on" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "inventory_kind_chk" CHECK (kind IN ('grocery', 'supply')),
	CONSTRAINT "inventory_category_chk" CHECK (category IN ('dairy', 'bakery', 'produce', 'meat', 'pantry', 'frozen', 'beverages', 'snacks', 'spices', 'cleaning', 'toiletries', 'baby', 'pet', 'stationery', 'tools', 'other')),
	CONSTRAINT "inventory_unit_chk" CHECK (unit IN ('piece', 'pack', 'kg', 'g', 'litre', 'ml', 'dozen', 'bottle', 'box', 'bag', 'can', 'roll', 'metre', 'other')),
	CONSTRAINT "inventory_quantity_chk" CHECK ("inventory_items"."quantity" >= 0),
	CONSTRAINT "inventory_min_quantity_chk" CHECK ("inventory_items"."min_quantity" IS NULL OR "inventory_items"."min_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shopping_list_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"inventory_item_id" uuid,
	"name_snapshot" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'piece' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"is_purchased" boolean DEFAULT false NOT NULL,
	"actual_price_minor" bigint,
	"notes" text,
	"added_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_list_items_quantity_chk" CHECK ("shopping_list_items"."quantity" > 0),
	CONSTRAINT "shopping_list_items_unit_chk" CHECK (unit IN ('piece', 'pack', 'kg', 'g', 'litre', 'ml', 'dozen', 'bottle', 'box', 'bag', 'can', 'roll', 'metre', 'other')),
	CONSTRAINT "shopping_list_items_priority_chk" CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "shopping_list_items_price_chk" CHECK ("shopping_list_items"."actual_price_minor" IS NULL OR "shopping_list_items"."actual_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"store" text,
	"status" text DEFAULT 'open' NOT NULL,
	"shopper_member_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "shopping_lists_status_chk" CHECK (status IN ('open', 'completed', 'archived')),
	CONSTRAINT "shopping_lists_completed_chk" CHECK ("shopping_lists"."status" <> 'completed' OR "shopping_lists"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "shopping_trips" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"household_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"expense_id" uuid,
	"shopper_member_id" uuid,
	"store" text,
	"total_minor" bigint,
	"items_purchased" integer DEFAULT 0 NOT NULL,
	"shopped_on" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_member_id_household_members_id_fk" FOREIGN KEY ("paid_by_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_for_member_id_household_members_id_fk" FOREIGN KEY ("for_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_added_by_member_id_household_members_id_fk" FOREIGN KEY ("added_by_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_shopper_member_id_household_members_id_fk" FOREIGN KEY ("shopper_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_trips" ADD CONSTRAINT "shopping_trips_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_trips" ADD CONSTRAINT "shopping_trips_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_trips" ADD CONSTRAINT "shopping_trips_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_trips" ADD CONSTRAINT "shopping_trips_shopper_member_id_household_members_id_fk" FOREIGN KEY ("shopper_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_period_idx" ON "expenses" USING btree ("household_id","spent_on" DESC NULLS LAST) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("household_id","category","spent_on") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "expenses_payer_idx" ON "expenses" USING btree ("household_id","paid_by_member_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "inventory_household_idx" ON "inventory_items" USING btree ("household_id","kind","category") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "inventory_low_idx" ON "inventory_items" USING btree ("household_id") WHERE deleted_at IS NULL AND min_quantity IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inventory_expiry_idx" ON "inventory_items" USING btree ("household_id","expiry_date") WHERE deleted_at IS NULL AND expiry_date IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_name_uq" ON "inventory_items" USING btree ("household_id",lower("name")) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "shopping_list_items_list_idx" ON "shopping_list_items" USING btree ("list_id","category");--> statement-breakpoint
CREATE INDEX "shopping_list_items_inventory_idx" ON "shopping_list_items" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE INDEX "shopping_lists_status_idx" ON "shopping_lists" USING btree ("household_id","status") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "shopping_trips_household_idx" ON "shopping_trips" USING btree ("household_id","shopped_on" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_trips_expense_uq" ON "shopping_trips" USING btree ("expense_id") WHERE expense_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_trips_list_uq" ON "shopping_trips" USING btree ("list_id");