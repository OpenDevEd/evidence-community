-- Rollback for 0103_topic-delivery-attachments. An older runtime builds a record's delivery without its PDF, so an
-- attachment change only sends the record again as it was. That changes no data, so rolling the release back needs no
-- change here. Keep the function: the PDFs reach OpenScholar again when the release returns.
SELECT 1;
