CREATE TABLE "reader_collection_member" (
	"collectionId" uuid NOT NULL,
	"userId" text NOT NULL,
	"role" varchar(16) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reader_collection_member_collectionId_userId_pk" PRIMARY KEY("collectionId","userId"),
	CONSTRAINT "reader_collection_member_role_valid" CHECK ("reader_collection_member"."role" in ('editor', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "reader_collection_member" ADD CONSTRAINT "reader_collection_member_collectionId_reader_collection_id_fk" FOREIGN KEY ("collectionId") REFERENCES "public"."reader_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_collection_member" ADD CONSTRAINT "reader_collection_member_userId_reader_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."reader_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reader_collection_member_userId_idx" ON "reader_collection_member" USING btree ("userId");