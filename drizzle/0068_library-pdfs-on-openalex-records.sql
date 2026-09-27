ALTER TABLE "itemFileDraft" DROP CONSTRAINT "itemFileDraft_parent_identity_fk";
--> statement-breakpoint
ALTER TABLE "itemFileDraft" ADD CONSTRAINT "itemFileDraft_parent_identity_fk" FOREIGN KEY ("parentItemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE cascade ON UPDATE no action;