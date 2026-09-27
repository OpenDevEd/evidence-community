import { describe, expect, it } from "vitest";
import { completedHourlyWindow, nextDigestDate, timeZoneLabel } from "@/lib/notifications/schedule";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { minimalLibraryConfig } from "../fixtures/library-config";

describe("library notification schedules", () => {
  it("names a regional zone by its place and a fixed zone by its real offset", () => {
    expect(timeZoneLabel("Africa/Casablanca")).toBe("Casablanca time");
    expect(timeZoneLabel("America/North_Dakota/Center")).toBe("North Dakota Center time");
    // IANA's Etc/GMT+5 is five hours behind GMT, the reverse of its name.
    expect(timeZoneLabel("Etc/GMT+5")).toBe("GMT-5");
    expect(timeZoneLabel("Etc/GMT-3")).toBe("GMT+3");
    expect(timeZoneLabel("UTC")).toBe("UTC");
    expect(timeZoneLabel("Etc/GMT+0")).toBe("UTC");
    // A daylight-saving alias has no single offset, so it stays as configured.
    expect(timeZoneLabel("CST6CDT")).toBe("CST6CDT");
  });
  it("uses the configured weekday, local time and timezone", () => {
    expect(nextDigestDate({frequency: "weekly" as const, weekday: 5, time: "09:15", timezone: "Asia/Kolkata"}, new Date("2026-09-09T10:00:00Z")).toISOString()).toBe("2026-09-11T03:45:00.000Z");
    expect(nextDigestDate({frequency: "weekly" as const, weekday: 1, time: "17:30", timezone: "UTC"}, new Date("2026-09-09T10:00:00Z")).toISOString()).toBe("2026-09-14T17:30:00.000Z");
  });
  it("runs once when the local clock repeats and moves a nonexistent time forward", () => {
    const schedule = {frequency: "weekly" as const, weekday: 0, time: "01:30", timezone: "Europe/London"};
    const spring = nextDigestDate(schedule, new Date("2026-03-27T12:00:00Z"));
    expect(spring.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(nextDigestDate(schedule, spring).toISOString()).toBe("2026-04-05T00:30:00.000Z");
    const autumn = nextDigestDate(schedule, new Date("2026-10-23T12:00:00Z"));
    expect(autumn.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(nextDigestDate(schedule, autumn).toISOString()).toBe("2026-11-01T01:30:00.000Z");
  });
  it.each([
    [30, "2026-02-01T00:00:00Z", "2026-02-28T09:15:00.000Z"],
    [31, "2028-02-01T00:00:00Z", "2028-02-29T09:15:00.000Z"],
    [31, "2026-04-01T00:00:00Z", "2026-04-30T09:15:00.000Z"],
    [30, "2026-01-30T09:15:00Z", "2026-02-28T09:15:00.000Z"],
    [31, "2026-12-31T09:15:00Z", "2027-01-31T09:15:00.000Z"],
    [1, "2026-09-01T09:14:59Z", "2026-09-01T09:15:00.000Z"],
  ])("schedules monthly day %i after %s at %s", (dayOfMonth, after, expected) => {
    expect(nextDigestDate({frequency: "monthly", dayOfMonth, time: "09:15", timezone: "UTC"}, new Date(after)).toISOString()).toBe(expected);
  });
  it("keeps monthly dates in the selected timezone and runs once across clock changes", () => {
    const schedule = {frequency: "monthly" as const, dayOfMonth: 29, time: "01:30", timezone: "Europe/London"};
    const spring = nextDigestDate(schedule, new Date("2026-03-01T00:00:00Z"));
    expect(spring.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(nextDigestDate(schedule, spring).toISOString()).toBe("2026-04-29T00:30:00.000Z");
    const autumnSchedule = {...schedule, dayOfMonth: 25};
    const autumn = nextDigestDate(autumnSchedule, new Date("2026-10-01T00:00:00Z"));
    expect(autumn.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(nextDigestDate(autumnSchedule, autumn).toISOString()).toBe("2026-11-25T01:30:00.000Z");
    expect(nextDigestDate({...schedule, dayOfMonth: 31, time: "00:15", timezone: "Pacific/Auckland"}, new Date("2026-04-01T00:00:00Z")).toISOString()).toBe("2026-04-29T12:15:00.000Z");
  });
  it("does not include the currently open hourly window", () => {
    expect(completedHourlyWindow(new Date("2026-09-09T10:59:59.999Z")).toISOString()).toBe("2026-09-09T10:00:00.000Z");
  });
  it("rejects an invalid schedule or enabled delivery without SMTP", () => {
    for (const weekly of [{frequency: "weekly" as const, weekday: 7}, {frequency: "weekly", weekday: 1, time: "25:00"}, {frequency: "weekly", weekday: 1, timezone: "Not/AZone"}]) {
      expect(libraryConfigSchema.safeParse({...minimalLibraryConfig, notifications: {schedule: weekly}}).success).toBe(false);
    }
    for (const dayOfMonth of [0, 32, 1.5]) {
      expect(libraryConfigSchema.safeParse({...minimalLibraryConfig, notifications: {schedule: {frequency: "monthly", dayOfMonth}}}).success).toBe(false);
    }
    expect(libraryConfigSchema.parse({...minimalLibraryConfig, notifications: {schedule: {frequency: "monthly", dayOfMonth: 31}}}).notifications.schedule).toEqual({frequency: "monthly", dayOfMonth: 31, time: "09:00", timezone: "UTC"});
    expect(libraryConfigSchema.safeParse({...minimalLibraryConfig, notifications: {enabled: true}, email: {}}).success).toBe(false);
  });
});
