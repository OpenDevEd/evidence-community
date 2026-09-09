import { describe, expect, it } from "vitest";
import { completedHourlyWindow, nextDigestDate } from "@/lib/notifications/schedule";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { minimalLibraryConfig } from "../fixtures/library-config";

describe("library notification schedules", () => {
  it("uses the configured weekday, local time and timezone", () => {
    expect(nextDigestDate({weekday: 5, time: "09:15", timezone: "Asia/Kolkata"}, new Date("2026-09-09T10:00:00Z")).toISOString()).toBe("2026-09-11T03:45:00.000Z");
    expect(nextDigestDate({weekday: 1, time: "17:30", timezone: "UTC"}, new Date("2026-09-09T10:00:00Z")).toISOString()).toBe("2026-09-14T17:30:00.000Z");
  });
  it("runs once when the local clock repeats and moves a nonexistent time forward", () => {
    const schedule = {weekday: 0, time: "01:30", timezone: "Europe/London"};
    const spring = nextDigestDate(schedule, new Date("2026-03-27T12:00:00Z"));
    expect(spring.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(nextDigestDate(schedule, spring).toISOString()).toBe("2026-04-05T00:30:00.000Z");
    const autumn = nextDigestDate(schedule, new Date("2026-10-23T12:00:00Z"));
    expect(autumn.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(nextDigestDate(schedule, autumn).toISOString()).toBe("2026-11-01T01:30:00.000Z");
  });
  it("does not include the currently open hourly window", () => {
    expect(completedHourlyWindow(new Date("2026-09-09T10:59:59.999Z")).toISOString()).toBe("2026-09-09T10:00:00.000Z");
  });
  it("rejects an invalid schedule or enabled delivery without SMTP", () => {
    for (const weekly of [{weekday: 7}, {time: "25:00"}, {timezone: "Not/AZone"}]) {
      expect(libraryConfigSchema.safeParse({...minimalLibraryConfig, notifications: {weekly}}).success).toBe(false);
    }
    expect(libraryConfigSchema.safeParse({...minimalLibraryConfig, notifications: {enabled: true}, email: {}}).success).toBe(false);
  });
});
