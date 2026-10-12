-- Rollback for 0088_item-study-type. Editors' corrections of study types are lost; readers see the reading's type again.
ALTER TABLE "item" DROP COLUMN "studyType";
