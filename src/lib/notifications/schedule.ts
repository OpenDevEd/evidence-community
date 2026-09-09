import { CronExpressionParser } from "cron-parser";
import type { LibraryServerConfig } from "@/config/library-config/schema";

export type DigestSchedule = LibraryServerConfig["notifications"]["weekly"];
export function nextDigestDate(schedule: DigestSchedule, after: Date) {
  const [hour, minute] = schedule.time.split(":").map(Number);
  return CronExpressionParser.parse(`0 ${minute} ${hour} * * ${schedule.weekday}`, {
    tz: schedule.timezone,
    currentDate: after,
  }).next().toDate();
}
export function completedHourlyWindow(now: Date) {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
}
