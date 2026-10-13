import { describe, expect, it } from "vitest";
import { digestPeriod } from "@/lib/notifications/schedule";

// A digest by publication date counts records dated from the day its window starts up to the day before it ends
// (`publishedIn`), so the days readers are told must stop there too.
describe("digestPeriod", () => {
  const days = (start: string, end: string, covers: "published" | "added", zone = "UTC") => {
    const {first, last} = digestPeriod(new Date(start), new Date(end), covers, zone, "en-GB");
    return [first, last];
  };

  it("ends a month's digest on the month's last day, not the day its window closes", () => {
    expect(days("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z", "published")).toEqual(["2026-09-01", "2026-09-30"]);
  });

  it("starts a scheduled digest on the day its window opens, whatever the hour", () => {
    expect(days("2026-09-29T13:50:51Z", "2026-10-05T09:00:00Z", "published")).toEqual(["2026-09-29", "2026-10-04"]);
  });

  it("keeps the last day across a clock change in the library's zone", () => {
    // Midnight on 30 March in London is 23:00 UTC the day before, after the clocks went forward on the 29th.
    expect(days("2026-03-01T00:00:00Z", "2026-03-29T23:00:00Z", "published", "Europe/London")).toEqual(["2026-03-01", "2026-03-29"]);
  });

  it("names both years on a period that crosses New Year", () => {
    expect(digestPeriod(new Date("2025-12-29T00:00:00Z"), new Date("2026-01-05T00:00:00Z"), "published", "UTC", "en-GB").monthsYear).toMatch(/^Dec 2025\s?–\s?Jan 2026$/);
  });

  it("covers the day an additions digest closes on", () => {
    expect(days("2026-09-29T13:50:51Z", "2026-10-05T09:00:00Z", "added")).toEqual(["2026-09-29", "2026-10-05"]);
  });
});
