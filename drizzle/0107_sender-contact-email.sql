-- A review's sender, shown to the Editors and Owners who decide it with an email they can write to (OpenDevEd/new-el#881).
-- "contactEmail" is the reader's real address from Openscholar, kept apart from "email", which stays made from the Clerk
-- user ID because sign-in matches readers by it. "addedByEmail" is the address Openscholar sends with a paper someone
-- added, for a sender who never signed in to the library.
ALTER TABLE "reader_user" ADD COLUMN "contactEmail" text;
--> statement-breakpoint
ALTER TABLE "addedPaper" ADD COLUMN "addedByEmail" varchar(320);
