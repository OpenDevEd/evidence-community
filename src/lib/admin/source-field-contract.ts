import { z } from "zod";

export const sourceResolutionsSchema = z.record(z.string().min(1).max(128), z.object({
  choice: z.enum(["keep", "source"]), sourceConnectionKey: z.string().min(1).max(64),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()).refine(value => Object.keys(value).length <= 200);

export type SourceFieldConflict = {
  field: string; value: unknown; sourceValue: unknown; sourceConnectionKey: string;
  sourceVersion: string | null; fingerprint: string; conflicting: boolean;
};
