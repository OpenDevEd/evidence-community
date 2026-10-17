// Clicks from paper to paper, sweeps the pointer over list rows while chains open, closes and opens at once, and checks after
// each that the points cosmos.gl draws are where their names and lines expect them: a cancelled morph leaves them apart.
// Needs a `next dev` server (the test handle is development-only): `BASE=http://localhost:3536 node scripts/evidence-map/morph-check.mjs`.
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3536";
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
await c.addCookies([{ name: "ode_browser_check", value: "1", url: BASE }]);
const p = await c.newPage();
await p.goto(`${BASE}/evidence?paper=6WXQWQRP`);
await p.getByRole("button", { name: "Decline" }).click({ timeout: 2000 }).catch(() => {});
await p.waitForFunction(() => window.evidenceGraph?.debug().more, null, { timeout: 60000 });
await p.waitForTimeout(3000);
const settle = async (label) => { await p.waitForTimeout(2200); const d = await p.evaluate(() => window.evidenceGraph.debug()); console.log(label.padEnd(34), "mode", d.mode, "apart", d.apart.toFixed(2)); return d.apart; };
const rows = () => p.getByRole("region", { name: "Paper" }).locator("ol button");
let worst = 0;
worst = Math.max(worst, await settle("opened 6WXQWQRP"));
await rows().first().click(); worst = Math.max(worst, await settle("clicked connected row"));
// Click a row, then sweep the pointer across other rows at once, while the next chain opens.
for (let round = 0; round < 4; round++) {
  const n = await rows().count();
  await rows().nth(Math.min(n - 1, 2 + round)).click();
  for (let k = 0; k < Math.min(6, n); k++) { await rows().nth(k).hover({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(30); }
  worst = Math.max(worst, await settle(`round ${round} click + hover sweep`));
}
await p.getByRole("button", { name: "Close" }).click(); await p.waitForTimeout(80);
await p.getByRole("button", { name: /Suo et al/ }).first().click(); worst = Math.max(worst, await settle("close then open at once"));
await p.getByRole("button", { name: /^Broken/ }).first().click(); await p.getByRole("button", { name: /Liu et al/ }).first().click(); worst = Math.max(worst, await settle("switch then open at once"));
await p.getByRole("button", { name: /All checked papers/ }).first().click(); await p.getByRole("button", { name: /Pálinkás/ }).first().hover(); worst = Math.max(worst, await settle("checked view + hover"));
// A switch's dimming must finish on its own, with the pointer off the map: frames are drawn on demand, and a fade without frames
// stops partway until something else (a hover) draws them. After a switch, drawing more frames must change nothing.
await p.goto(`${BASE}/evidence?paper=DH3CLWRK`);
await p.waitForFunction(() => window.evidenceGraph?.debug().more, null, { timeout: 60000 });
await p.waitForTimeout(3000);
const canvas = { x: 330, y: 100, width: 500, height: 640 };
let stuck = 0;
for (const name of [/^Validated \d/, /^Validated \d/, /^Broken/, /^Broken/]) {
  await p.getByRole("button", { name }).first().click();
  await p.waitForTimeout(1500);
  const before = await p.screenshot({ clip: canvas });
  await p.evaluate(() => window.evidenceGraph.request(30));
  await p.waitForTimeout(800);
  const after = await p.screenshot({ clip: canvas });
  const changed = before.equals(after) ? 0 : 1;
  console.log(String(name).padEnd(34), changed ? "still fading: more frames changed the map" : "settled on its own");
  stuck += changed;
}
if (stuck) { console.log(`${stuck} switch fades stopped partway.`); process.exitCode = 1; }
console.log(worst > 0.5 ? `Points left apart by ${worst.toFixed(1)}.` : "Points land where their names and lines are.");
if (worst > 0.5) process.exitCode = 1;
await b.close();
