import type { getPublicItemCard } from "@/lib/public-item-card";

export type NotificationPublication = {
  key: string;
  title: string;
  creators: string[];
  date: string | null;
  abstract: string | null;
  publicationType: string;
  doi: string | null;
  item: NonNullable<Awaited<ReturnType<typeof getPublicItemCard>>>;
};
export type NotificationStream = "hourly" | "digest";
/** A digest's words: what the writer returns, and what an edition publishes. */
export type DigestText = { title: string; summary: string; markdown: string };
/** Text nobody has published yet, with the editor's note that goes above it. A rewrite saved before notes existed has none. */
export type DigestDraft = DigestText & { note?: string };
/** Someone on the library's team as they were when they acted: their OpenScholar account, name and photo. */
export type DigestPerson = { id: string; name: string; photo: string | null };
/** The Editor or Owner who published an edition, as readers are told when the library names who checks its digests. */
export type DigestSigner = DigestPerson & { role: "editor" | "owner" };
/** A step in an edition's history. AI writes; the rest are a person's. */
export type DigestEventKind = "written" | "edited" | "submitted" | "withdrawn" | "returned" | "published";
