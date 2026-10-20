-- Rollback for 0095_institution-locations. The runtime before it has no map of institutions; the next import after
-- going forward again looks the locations up anew.
ALTER TABLE "institutionCountry" DROP CONSTRAINT IF EXISTS "institutionCountry_location_valid";
ALTER TABLE "institutionCountry" DROP COLUMN IF EXISTS "latitude";
ALTER TABLE "institutionCountry" DROP COLUMN IF EXISTS "longitude";
