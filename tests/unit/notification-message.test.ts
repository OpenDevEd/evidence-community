import {expect, it} from "vitest";
import {libraryConfigSchema} from "@/config/library-config/schema";
import {maximalLibraryConfig} from "../fixtures/library-config";
import {notificationMessage, type EmailEdition} from "@/lib/notifications/message";
import {renderLibraryInvitation} from "@/lib/emails/library-template";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
const subscriber = {email: "reader@example.org", token: "reader-secret", digest: true, instant: false, confirmedAt: null};

it("keeps confirmation, preference and unsubscribe links specific to the recipient and library", async () => {
  const confirmation = await notificationMessage(config, subscriber, null, "confirmation:reader");
  const prefix = `${config.identity.baseUrl}/${config.localization.defaultLocale}/digests/`;
  expect(confirmation.html).toContain(`${prefix}confirm?token=reader-secret`);
  expect(confirmation.html).toContain(`${prefix}preferences?token=reader-secret`);
  expect(confirmation.html).toContain(`${prefix}unsubscribe?token=reader-secret`);
  expect(confirmation.text).toContain(`${prefix}confirm?token=reader-secret`);
  expect(confirmation.headers["List-Unsubscribe"]).toBe(`<${prefix}unsubscribe?token=reader-secret>`);
  const preferences = await notificationMessage(config, {...subscriber, confirmedAt: new Date()}, null, "preferences:reader");
  expect(preferences.html).not.toContain(`${prefix}confirm?`);
  expect(preferences.html).toContain(`${prefix}preferences?token=reader-secret`);
});

it("renders every publication and digest citation with absolute links while escaping untrusted metadata", async () => {
  const publication = {key: "ABCDEFGH", title: 'Report <script>alert(1)</script>', creators: ['Someone <img src=x>'], abstract: 'Abstract <iframe src=x>', publicationType: "Report"};
  const edition: EmailEdition = {id: "saved-edition", title: 'A <script>title</script>', stream: "hourly", windowStart: new Date("2026-09-07"), windowEnd: new Date("2026-09-14"), markdown: null, publications: [publication]};
  const hourly = await notificationMessage(config, subscriber, edition, "hourly:reader");
  expect(hourly.html).toContain(`${config.identity.baseUrl}/lib/ABCDEFGH`);
  expect(hourly.html).toContain('Report &lt;script&gt;alert(1)&lt;/script&gt;');
  expect(hourly.html).toContain('Someone &lt;img src=x&gt;');
  expect(hourly.html).not.toMatch(/<(script|iframe)\b/);
  const digest = await notificationMessage(config, subscriber, {...edition, stream: "digest", markdown: '## Finding\n\nSee [1](/lib/ABCDEFGH). <script>bad()</script>\n\n[bad](javascript:alert(1))'}, "digest:reader");
  expect(digest.html).toContain(`href="${config.identity.baseUrl}/lib/ABCDEFGH"`);
  expect(digest.html).toContain(`/digests/saved-edition`);
  expect(digest.html).not.toMatch(/<script\b|href="javascript:/);
  expect(digest.text).toContain(`${config.identity.baseUrl}/lib/ABCDEFGH`);
});

it("uses the actual invitation role and destination without inserting the library name as HTML", () => {
  const html = renderLibraryInvitation({identity: {name: '<script>Library</script>', baseUrl: "https://library.example", logoUrl: 'https://library.example/logo.png', accent: '#f58220'}, role: "creator", acceptUrl: "https://openscholar.example/evidence-libraries"});
  expect(html).toContain('href="https://openscholar.example/evidence-libraries"');
  expect(html).toContain('Creator');
  expect(html).not.toContain('Editor');
  expect(html).toContain('&lt;script&gt;Library&lt;/script&gt;');
  expect(html).not.toContain('<script>');
});
