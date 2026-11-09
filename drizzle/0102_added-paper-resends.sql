-- The later requests that sent an added paper again after its review was returned or withdrawn (OpenDevEd/new-el#780),
-- so replaying any of them leaves a later return or withdrawal as it is, as replaying the first request does.
ALTER TABLE "addedPaper" ADD COLUMN "resendRequestIds" varchar(128)[] DEFAULT '{}' NOT NULL;
