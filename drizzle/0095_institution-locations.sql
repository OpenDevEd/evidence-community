-- Where each OpenAlex institution is, as OpenAlex places it (its city), so the map can show where authors work. Both
-- are set or neither: an institution an editor gave a country by hand has no location.
ALTER TABLE "institutionCountry" ADD COLUMN "latitude" double precision;
--> statement-breakpoint
ALTER TABLE "institutionCountry" ADD COLUMN "longitude" double precision;
--> statement-breakpoint
ALTER TABLE "institutionCountry" ADD CONSTRAINT "institutionCountry_location_valid" CHECK (
	("latitude" IS NULL) = ("longitude" IS NULL)
	AND "latitude" BETWEEN -90 AND 90
	AND "longitude" BETWEEN -180 AND 180
);
