CREATE INDEX "adminItemListProjection_year_cursor_asc_idx" ON "adminItemListProjection" USING btree (coalesce("year", 2147483647),"key");--> statement-breakpoint
CREATE INDEX "adminItemListProjection_year_cursor_desc_idx" ON "adminItemListProjection" USING btree (coalesce("year", -2147483648) DESC,"key" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "adminItemListProjection_page_count_cursor_asc_idx" ON "adminItemListProjection" USING btree (coalesce("pageCount", 2147483647),"key");--> statement-breakpoint
CREATE INDEX "adminItemListProjection_page_count_cursor_desc_idx" ON "adminItemListProjection" USING btree (coalesce("pageCount", -2147483648) DESC,"key" DESC NULLS FIRST);
