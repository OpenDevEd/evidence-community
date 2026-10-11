import type { getPublicItemCard } from "@/lib/public-item-card";

/** The most characters a digest's text may have. The editor checks it too, before a page is left. */
export const MOST_TEXT = 50_000;

export type NotificationPublication = {
  key: string;
  title: string;
  creators: string[];
  date: string | null;
  abstract: string | null;
  publicationType: string;
  doi: string | null;
  /** Its title, abstract or OpenAlex type suggests a meta-analysis or a review. Absent from editions listed before records were marked. */
  candidate?: boolean;
  /** What reading it found, once it has been read. */
  kind?: PublicationKind;
  item: NonNullable<Awaited<ReturnType<typeof getPublicItemCard>>>;
};
/** What a likely review turned out to be when its title and abstract were read. */
export type PublicationKind = "meta-analysis" | "review" | "study";
export type NotificationStream = "hourly" | "digest";
/** A digest's words: what the writer returns, and what an edition publishes. */
export type DigestText = { title: string; summary: string; markdown: string };
/** Text nobody has published yet, with the editor's note that goes above it. A rewrite saved before notes existed has none. */
export type DigestDraft = DigestText & { note?: string };
/** Someone on the library's team as they were when they acted: their OpenScholar account, name and photo. */
export type DigestPerson = { id: string; name: string; photo: string | null };
/**
 * The Editor or Owner who published an edition, as readers are told when the library names who checks its digests.
 * An edition published by the first release of the admin has no role recorded.
 */
export type DigestSigner = DigestPerson & { role?: "editor" | "owner" };
/** A signer's role as readers see it under their name. */
export const DIGEST_SIGNER_ROLE = { editor: "Editor", owner: "Owner" } as const satisfies Record<NonNullable<DigestSigner["role"]>, string>;
/** A step in an edition's history. AI writes; the rest are a person's. */
export type DigestEventKind = "written" | "edited" | "submitted" | "withdrawn" | "returned" | "published";
