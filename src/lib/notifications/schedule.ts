import { CronExpressionParser } from "cron-parser";
import type { LibraryServerConfig } from "@/config/library-config/schema";

export type DigestSchedule = LibraryServerConfig["notifications"]["schedule"];
/** When digests come, as readers are told. `checked` is for a library whose digests wait for an editor: the day holds and the time does not. */
export function describeDigestSchedule(schedule: DigestSchedule, locale: string, checked = false) {
  const day = schedule.frequency === "weekly"
    ? new Date(Date.UTC(2026, 0, 4 + schedule.weekday, 12)).toLocaleDateString(locale, {weekday: "long", timeZone: "UTC"})
    : `Day ${schedule.dayOfMonth} of each month${schedule.dayOfMonth > 28 ? ", or its last day if shorter," : ""}`;
  return checked ? `${day}, once an editor has checked it` : `${day} at ${schedule.time} ${schedule.timezone}`;
}

/**
 * A zone as a reader names it, from its name alone so the server and every browser write the same text: the place for a
 * regional zone, the real offset for a fixed one (IANA's Etc/GMT+5 is five hours behind), and any other zone as configured.
 */
export function timeZoneLabel(timezone: string) {
  const [area, ...place] = timezone.split("/");
  if (area.toLowerCase() !== "etc" && place.length) return `${place.join(" ").replaceAll("_", " ")} time`;
  const fixed = /^etc\/gmt([+-])(\d+)$/i.exec(timezone);
  if (fixed && fixed[2] !== "0") return `GMT${fixed[1] === "+" ? "-" : "+"}${fixed[2]}`;
  return /^(etc\/)?(utc|uct|gmt(0|[+-]0)?|greenwich|universal|zulu)$/i.test(timezone) ? "UTC" : timezone;
}

/**
 * The days an edition covers, as readers are told. A digest of publication dates covers whole days in the library's
 * time zone, from the day its window starts to the day before the one it ends on (`publishedIn`); a digest of
 * additions covers the days its window touches. `first` and `last` are those days as YYYY-MM-DD, `label` the period in
 * words ("September 2026" for a whole month), `days` and `months` the two lines of a date tile, and `monthsYear` its
 * months with their years, both when the period crosses New Year ("Dec 2025 – Jan 2026").
 */
export type DigestPeriod = {first: string; last: string; label: string; from: string; to: string; days: string; months: string; monthsYear: string; year: string};
export function digestPeriod(start: Date, end: Date, covers: "published" | "added", timeZone: string, locale: string): DigestPeriod {
  const day = (date: Date) => date.toLocaleDateString("en-CA", {timeZone});
  const first = day(start);
  const shifted = new Date(`${day(end)}T00:00:00Z`);
  if (covers === "published") shifted.setUTCDate(shifted.getUTCDate() - 1);
  const last = shifted.toISOString().slice(0, 10);
  // The two days are calendar days, so they are written as UTC dates, never moved by a zone.
  const [a, b] = [new Date(`${first}T00:00:00Z`), new Date(`${last}T00:00:00Z`)];
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, {...options, timeZone: "UTC"});
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const monthEnd = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0)).getUTCDate();
  const wholeMonth = sameMonth && a.getUTCDate() === 1 && b.getUTCDate() === monthEnd;
  const long = format({day: "numeric", month: "long", year: "numeric"});
  const dayOnly = format({day: "numeric"});
  return {
    first, last, from: long.format(a), to: long.format(b), year: String(b.getUTCFullYear()),
    label: wholeMonth ? format({month: "long", year: "numeric"}).format(b) : long.formatRange(a, b),
    days: first === last ? dayOnly.format(a) : sameMonth ? dayOnly.formatRange(a, b) : `${dayOnly.format(a)}–${dayOnly.format(b)}`,
    months: format({month: "short"}).formatRange(a, b),
    monthsYear: format({month: "short", year: "numeric"}).formatRange(a, b),
  };
}

export function nextDigestDate(schedule: DigestSchedule, after: Date) {
  const [hour, minute] = schedule.time.split(":").map(Number);
  const days = schedule.frequency === "weekly"
    ? `* * ${schedule.weekday}`
    : `${schedule.dayOfMonth},L * *`;
  const dates = CronExpressionParser.parse(`0 ${minute} ${hour} ${days}`, {
    tz: schedule.timezone,
    currentDate: after,
  });
  // A month can have one extra candidate: its last day after the selected day.
  // Skip that candidate so day 30 never sends again on day 31.
  for (let candidate = 0; candidate < 2; candidate++) {
    const next = dates.next();
    if (schedule.frequency === "weekly" || next.getDate() <= schedule.dayOfMonth) return next.toDate();
  }
  throw new Error("Could not find the next digest date");
}
export function completedHourlyWindow(now: Date) {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
}
