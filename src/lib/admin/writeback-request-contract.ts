import { z } from "zod";

const sourceKey = z.string().trim().min(1).max(64);
const sourceKeyList = z.array(sourceKey).max(100);

export function readAdminSourceKey(searchParams: URLSearchParams) {
	return sourceKey.parse(searchParams.get("source"));
}

/** Body of `POST /api/admin/items/[key]/unpublish`. */
export const adminUnpublishRequestSchema = z
	.object({
		/** Selected sources that should also delete their copy. Omit to remove from every selected source. */
		removeFromSourceKeys: sourceKeyList.optional(),
		/** Withdraws a record with a real DOI, with the reason its tombstone gives readers. */
		withdrawal: z.object({ reason: z.string().trim().min(1).max(1000) }).strict().optional(),
	})
	.strict();

/** Body of `PUT /api/admin/items/[key]/writeback/sources`. */
export const adminWritebackSourcesRequestSchema = z
	.object({
		sourceKeys: sourceKeyList,
	})
	.strict();

/** Body of `POST /api/admin/items/[key]/writeback/resolve?source=<key>`. */
export const adminWritebackResolveRequestSchema = z
	.object({
		choice: z.enum(["load-remote", "send-local"]),
	})
	.strict();

export type AdminWritebackResolveRequest = z.infer<
	typeof adminWritebackResolveRequestSchema
>;
export type AdminUnpublishRequest = z.infer<typeof adminUnpublishRequestSchema>;
export type AdminWritebackSourcesRequest = z.infer<
	typeof adminWritebackSourcesRequestSchema
>;
