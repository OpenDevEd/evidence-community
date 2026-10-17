// Checks that every camera focus on /evidence fits inside the space the panels leave, in five layouts: the whole library,
// all checked papers, a small chain, the biggest chain, a primary study, and a paper outside every chain. Needs a `next dev`
// server (the test handle is development-only): `BASE=http://localhost:3536 node scripts/evidence-map/fit-check.mjs`.
import fs from "node:fs";
import { chromium } from "playwright";
const DATA = new URL("../../public/evidence-data/aied/", import.meta.url);
const chains = JSON.parse(fs.readFileSync(new URL("chains.json", DATA), "utf8")).filter((c) => !c.outside && c.analyses).sort((a, b) => b.analyses - a.analyses);
const records = JSON.parse(fs.readFileSync(new URL("../../src/components/pages/evidence/records.json", import.meta.url), "utf8")).records;
const keys = fs.readFileSync(new URL("keys.txt", DATA), "utf8");
const K = { big: chains[0].paper, small: chains.at(-1).paper, primary: Object.entries(records).find(([, r]) => r.chain && !r.analysed && r.verdict)[0], plain: keys.slice(8 * 5000, 8 * 5000 + 8) };
const BASE = process.env.BASE ?? "http://localhost:3536";
const views = [["desktop", 1440, 900], ["laptop", 1280, 720], ["tablet", 1024, 768], ["phone", 390, 844], ["phone-landscape", 844, 390]];
const steps = [["library", "/evidence", "overview"], ["checked", "/evidence?view=checked", "chain"], ["small", `/evidence?paper=${K.small}`, "chain"], ["biggest", `/evidence?paper=${K.big}`, "chain"], ["primary", `/evidence?paper=${K.primary}`, "chain"], ["plain", `/evidence?paper=${K.plain}`, "neighbourhood"]];
const b = await chromium.launch();
const failures = [];
for (const [name, width, height] of views) {
  const c = await b.newContext({ viewport: { width, height }, isMobile: width < 900, hasTouch: width < 900 });
  await c.addCookies([{ name: "ode_browser_check", value: "1", url: BASE }]);
  const p = await c.newPage();
  await p.addInitScript(() => {
    const patch = () => { const canvas = document.querySelector("main canvas.pointer-events-none"); if (!canvas) return requestAnimationFrame(patch);
      const ctx = canvas.getContext("2d"); const clear = ctx.clearRect.bind(ctx), fill = ctx.fillText.bind(ctx);
      ctx.clearRect = (...a) => { window.__labels = []; return clear(...a); };
      ctx.fillText = (t, x, y, ...a) => { const w = ctx.measureText(t).width; const l = ctx.textAlign === "center" ? x - w / 2 : ctx.textAlign === "right" ? x - w : x; window.__labels.push({ t, l, r: l + w, y, alpha: ctx.globalAlpha }); return fill(t, x, y, ...a); }; };
    patch();
  });
  for (const [step, url, mode] of steps) {
    await p.goto(BASE + url);
    if (step === "library") await p.getByRole("button", { name: "Decline" }).click().catch(() => {});
    // The view asked for is open, its morph is done, and the zoom has held still for 600 ms.
    await p.waitForFunction((mode) => { const d = window.evidenceGraph?.debug(); if (!d?.fitted || d.animating || !(d.mode === mode || (mode === "overview" && d.mode === "nearby"))) { window.__still = null; return false; }
      const z = `${d.zoom}`; if (window.__still?.z !== z) { window.__still = { z, at: performance.now() }; return false; } return performance.now() - window.__still.at > 600; }, mode, { timeout: 60000, polling: 100 }).catch(() => failures.push(`${name} ${step}: never settled`));
    const d = await p.evaluate(() => ({ dbg: window.evidenceGraph?.debug(), labels: (window.__labels ?? []).filter((l) => l.alpha > 0.5) }));
    const f = d.dbg?.fitted;
    if (!f) { failures.push(`${name} ${step}: nothing fitted`); continue; }
    const a = f.area, xs = f.positions.map((q) => q[0]), ys = f.positions.map((q) => q[1]);
    const box = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    const out = box.left < a.left - 1 || box.right > a.right + 1 || box.top < a.top - 1 || box.bottom > a.bottom + 1;
    const paperLabels = d.labels.filter((l) => /\d{4}$|et al\./.test(l.t));
    const labelsOut = paperLabels.filter((l) => l.l < a.left - 1 || l.r > a.right + 1 || l.y < a.top - 1 || l.y > a.bottom + 1);
    const line = `${name.padEnd(16)} ${step.padEnd(8)} area ${[a.left, a.top, a.right, a.bottom].map(Math.round).join(",")} fitted ${[box.left, box.top, box.right, box.bottom].map(Math.round).join(",")} ${out ? "OUT" : "in"}; names ${paperLabels.length}, outside ${labelsOut.length}`;
    console.log(line);
    if (out || labelsOut.length) failures.push(line + " " + labelsOut.slice(0, 3).map((l) => `${l.t}@${Math.round(l.l)}-${Math.round(l.r)},${Math.round(l.y)}`).join(" "));
  }
  await c.close();
}
await b.close();
console.log(failures.length ? `${failures.length} failed:\n${failures.join("\n")}` : "Every focus fits.");
process.exitCode = failures.length ? 1 : 0;
