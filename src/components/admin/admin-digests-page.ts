import { createContext } from "react";
import type { AdminRecordState } from "@/lib/admin/types";
import type { AdminDigestsQuery } from "@/lib/notifications/editorial";

export type DigestShow = AdminDigestsQuery["show"];

/**
 * The digests page as the admin's navigation needs it: whether it is the page on show, how many digests wait for an
 * Editor or Owner, which of them are listed, and what opens the page or narrows its list.
 */
export const DigestsPage = createContext<{ selected: boolean; waiting: number; show: DigestShow; onOpen: () => void; onShow: (show: DigestShow) => void } | null>(null);

/**
 * The state filter carried from records to digests and back. Both have drafts and published; a state only one of
 * them has, such as Deleted or In review, falls back to everything.
 */
export const digestShowFor = (state: AdminRecordState | "all" | null): DigestShow => (state === "draft" || state === "published" ? state : "all");
export const recordStateFor = (show: DigestShow): AdminRecordState | "all" => (show === "draft" || show === "published" ? show : "all");
