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
  const edition: EmailEdition = {id: "saved-edition", title: 'A <script>title</script>', stream: "hourly", windowStart: new Date("2026-09-07"), windowEnd: new Date("2026-09-14"), markdown: null, note: null, checkedBy: null, publications: [publication], publicationCount: 1};
  const hourly = await notificationMessage(config, subscriber, edition, "hourly:reader");
  expect(hourly.html).toContain(`${config.identity.baseUrl}/lib/ABCDEFGH`);
  expect(hourly.html).toContain('Report &lt;script&gt;alert(1)&lt;/script&gt;');
  expect(hourly.html).toContain('Someone &lt;img src=x&gt;');
  expect(hourly.html).not.toMatch(/<(script|iframe)\b/);
  const capped = await notificationMessage(config, subscriber, {...edition, publicationCount: 3}, "hourly:reader");
  expect(capped.html).toContain("And 2 more in the library.");
  expect(capped.text).toContain("And 2 more in the library.");
  const digest = await notificationMessage(config, subscriber, {...edition, stream: "digest", markdown: '## Finding\n\nSee [1](/lib/ABCDEFGH). <script>bad()</script>\n\n[bad](javascript:alert(1))'}, "digest:reader");
  expect(digest.html).toContain(`href="${config.identity.baseUrl}/lib/ABCDEFGH"`);
  expect(digest.html).toContain(`/digests/saved-edition`);
  expect(digest.html).not.toMatch(/<script\b|href="javascript:/);
  expect(digest.text).toContain(`${config.identity.baseUrl}/lib/ABCDEFGH`);
});

it("signs a digest with who checked it and their note only when the library names them", async () => {
  const edition: EmailEdition = {id: "saved-edition", title: "August", stream: "digest", windowStart: new Date("2026-09-07"), windowEnd: new Date("2026-09-14"), markdown: "## Finding\n\nText.", publications: [], publicationCount: 1,
    note: "Start with <the> Kenya study.\nIt is short.", checkedBy: {id: "user_editor", name: "Gugulethu <Dube>", photo: "https://img.example/gugu.png?a=1&b=2", role: "editor"}};
  const named = libraryConfigSchema.parse({...maximalLibraryConfig, notifications: {attribution: true}});
  const signed = await notificationMessage(named, subscriber, edition, "digest:reader");
  expect(signed.html).toContain("Start with &lt;the&gt; Kenya study.<br>It is short.");
  expect(signed.html).toContain("<strong style=\"color:#202822\">Gugulethu &lt;Dube&gt;</strong> &nbsp;Editor");
  expect(signed.html).toContain('src="https://img.example/gugu.png?a=1&amp;b=2"');
  expect(signed.html).not.toContain("user_editor");
  expect(signed.text).toContain("Start with <the> Kenya study.\nIt is short.\nGugulethu <Dube>, Editor\n\n## Finding");
  // Without a note the person is still named, and a digest nobody checked says so.
  const checked = await notificationMessage(named, subscriber, {...edition, note: null}, "digest:reader");
  expect(checked.html).toContain("Checked by <strong");
  expect(checked.text).toContain("Checked by Gugulethu <Dube>");
  const unchecked = await notificationMessage(named, subscriber, {...edition, checkedBy: null}, "digest:reader");
  expect(unchecked.html).toContain("Written by AI");
  expect(unchecked.html).not.toContain("Kenya study");
  // A library that does not name who checks its digests shows none of it.
  const plain = await notificationMessage(config, subscriber, edition, "digest:reader");
  expect(plain.html).not.toMatch(/Gugulethu|Kenya study|Written by AI|Checked by/);
  expect(plain.text).not.toMatch(/Gugulethu|Kenya study|Written by AI|Checked by/);
});

it("uses the actual invitation role and destination without inserting the library name as HTML", () => {
  const html = renderLibraryInvitation({identity: {name: '<script>Library</script>', baseUrl: "https://library.example", logoUrl: 'https://library.example/logo.png', accent: '#f58220'}, role: "creator", acceptUrl: "https://openscholar.example/evidence-libraries"});
  expect(html).toContain('href="https://openscholar.example/evidence-libraries"');
  expect(html).toContain('Creator');
  expect(html).not.toContain('Editor');
  expect(html).toContain('&lt;script&gt;Library&lt;/script&gt;');
  expect(html).not.toContain('<script>');
});
