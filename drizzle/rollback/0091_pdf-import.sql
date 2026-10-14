-- Rollback for 0082_pdf-import. The runtime before it reads PDFs in the editor's browser and never uses these
-- tables. Dropping them loses any open import's readings; its PDFs stay in private storage under imports/.
DROP TABLE IF EXISTS "pdfImportFile";
DROP TABLE IF EXISTS "pdfImport";
