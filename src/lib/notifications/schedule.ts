import { CronExpressionParser } from "cron-parser";
import type { LibraryServerConfig } from "@/config/library-config/schema";

export type DigestSchedule = LibraryServerConfig["notifications"]["schedule"];
export function describeDigestSchedule(schedule: DigestSchedule, locale: string) {
  const day = schedule.frequency === "weekly"
    ? new Date(Date.UTC(2026, 0, 4 + schedule.weekday, 12)).toLocaleDateString(locale, {weekday: "long", timeZone: "UTC"})
    : `Day ${schedule.dayOfMonth} of each month${schedule.dayOfMonth > 28 ? ", or its last day if shorter," : ""}`;
  return `${day} at ${schedule.time} ${schedule.timezone}`;
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
