DROP TABLE "status";--> statement-breakpoint
CREATE TABLE "status" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"totalRecords" integer DEFAULT 0 NOT NULL,
	"totalItems" integer DEFAULT 0 NOT NULL,
	"databaseUpdatedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "status_singleton" CHECK ("status"."id" = 1)
);--> statement-breakpoint
INSERT INTO "status" ("id") VALUES (1) ON CONFLICT DO NOTHING;
