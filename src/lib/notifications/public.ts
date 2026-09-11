import { z } from "zod";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { notificationEdition, notificationState } from "@/db/schema/notifications";
import { describeDigestSchedule, nextDigestDate } from "./schedule";
import type { NotificationPublication } from "./types";

export type DigestSummary = {slug: string; publishedAt: string; date: string; title: string; summary: string; publicationCount: number};
export type DigestEdition = DigestSummary & {markdown: string; publications: NotificationPublication[]};
export type DigestPageData = {editions: DigestSummary[]; edition?: DigestEdition; libraryName: string; enabled: boolean; nextEdition: string | null; timezone: string; schedule: string};
function editionSummary(row: {id: string; publishedAt: Date | null; title: string | null; summary: string | null; publicationCount: number}, locale: string, timezone: string): DigestSummary {
  return {slug: row.id, publishedAt: row.publishedAt!.toISOString(), date: row.publishedAt!.toLocaleDateString(locale, {day: "numeric", month: "long", year: "numeric", timeZone: timezone}), title: row.title!, summary: row.summary!, publicationCount: row.publicationCount};
}
const visibleEdition = and(eq(notificationEdition.stream, "digest"), isNotNull(notificationEdition.publishedAt));

async function readEdition(db: Database, id: string | undefined) {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return undefined;
  const [edition] = await db.select().from(notificationEdition).where(and(visibleEdition, eq(notificationEdition.id, parsed.data))).limit(1);
  return edition;
}

function nextEditionDate(config: LibraryServerConfig, state: typeof notificationState.$inferSelect | undefined) {
  if (!config.notifications.enabled) return null;
  const now = new Date();
  const currentSchedule = state?.schedule === JSON.stringify(config.notifications.schedule);
  if (currentSchedule && state?.enabled && state.nextDigestAt && state.nextDigestAt > now) return state.nextDigestAt;
  return nextDigestDate(config.notifications.schedule, now);
}

function publicEdition(edition: typeof notificationEdition.$inferSelect | undefined, locale: string, timezone: string) {
  if (!edition) return undefined;
  return {...editionSummary({...edition, publicationCount: edition.publications.length}, locale, timezone), markdown: edition.markdown!, publications: edition.publications};
}

export async function getDigestPageData(db: Database, config: LibraryServerConfig, locale: string, id?: string): Promise<DigestPageData> {
  const rows = await db.select({id: notificationEdition.id, publishedAt: notificationEdition.publishedAt, title: notificationEdition.title, summary: notificationEdition.summary, publicationCount: sql<number>`jsonb_array_length(${notificationEdition.publications})`}).from(notificationEdition).where(visibleEdition).orderBy(desc(notificationEdition.windowEnd));
  const selected = await readEdition(db, id);
  const [state] = await db.select().from(notificationState).limit(1);
  const next = nextEditionDate(config, state);
  const {timezone} = config.notifications.schedule;
  return {editions: rows.map(row => editionSummary(row, locale, timezone)), edition: publicEdition(selected, locale, timezone), libraryName: config.identity.name, enabled: config.notifications.enabled, nextEdition: next?.toISOString() ?? null, timezone, schedule: describeDigestSchedule(config.notifications.schedule, locale)};
}
