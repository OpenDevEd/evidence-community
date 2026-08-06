CREATE TABLE "sourceFileCleanup" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sourceFileCleanup_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sourceConnectionKey" varchar(64) NOT NULL,
	"objectPath" varchar(1024) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sourceFileCleanup_connection_path_unique" UNIQUE("sourceConnectionKey","objectPath"),
	CONSTRAINT "sourceFileCleanup_attempts_nonnegative" CHECK ("sourceFileCleanup"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sourceFileCleanup" ADD CONSTRAINT "sourceFileCleanup_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "sourceFileCleanup_connection_created_idx" ON "sourceFileCleanup" USING btree ("sourceConnectionKey","createdAt");