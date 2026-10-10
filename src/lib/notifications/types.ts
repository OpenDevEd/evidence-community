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
