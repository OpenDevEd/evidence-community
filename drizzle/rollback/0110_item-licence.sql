-- Rollback for 0110_item-licence. Records' own licences are lost; their DOIs go out under the library's Zenodo licence
-- again.
ALTER TABLE "item" DROP COLUMN "licence";
