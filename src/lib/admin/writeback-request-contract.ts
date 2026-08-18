import { z } from "zod";

const sourceKeyList = z.array(z.string().trim().min(1).max(64)).max(100);

/** Body of `POST /api/admin/items/[key]/publish`. */
export const adminPublishRequestSchema = z
	.object({
		/** Sources this record should write to from now on. Omit to keep the stored choice. */
		sourceKeys: sourceKeyList.optional(),
	})
	.strict();

/** Body of `POST /api/admin/items/[key]/unpublish`. */
export const adminUnpublishRequestSchema = z
	.object({
		/** Selected sources that should also delete their copy. Omit to remove from every selected source. */
		removeFromSourceKeys: sourceKeyList.optional(),
	})
	.strict();

/** Body of `PUT /api/admin/items/[key]/writeback/sources`. */
export const adminWritebackSourcesRequestSchema = z
	.object({
		sourceKeys: sourceKeyList,
	})
	.strict();

export type AdminPublishRequest = z.infer<typeof adminPublishRequestSchema>;
export type AdminUnpublishRequest = z.infer<typeof adminUnpublishRequestSchema>;
export type AdminWritebackSourcesRequest = z.infer<
	typeof adminWritebackSourcesRequestSchema
>;
