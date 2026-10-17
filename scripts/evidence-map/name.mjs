// Names the map's places from their most cited titles and distinctive words, with GPT-6 Luna through OpenRouter.
import fs from "node:fs";
const DIR = process.argv[2];
const key = fs.readFileSync("/Users/mcharrad/Documents/Github/openscholar/dev-self/.env.local", "utf8").match(/^OPENROUTER_API_KEY=(.*)$/m)[1].replace(/"/g, "").trim();
const places = JSON.parse(fs.readFileSync(`${DIR}/places-raw.json`, "utf8"));
const regionOf = new Map();
async function ask(batch, context) {
  const body = {
    model: "openai/gpt-6-luna", reasoning: { effort: "low" }, response_format: { type: "json_object" },
    messages: [{ role: "system", content: "You name areas of a map of research papers in a library about AI in education. Every paper in the library is about AI in education, so never use that phrase or 'artificial intelligence' on its own. Each name is 2 to 4 words, sentence case, plain and specific, like a heading a researcher would recognise: 'ChatGPT and academic writing', 'Knowledge tracing', 'Automated essay scoring'. Names in one batch must differ from each other. No colons, no ampersands. Answer as JSON: {\"names\": {\"<id>\": \"<name>\"}}." },
      { role: "user", content: `${context}\n\n${batch.map((p) => `id ${p.id} (${p.size} papers${p.parent ? `, inside "${p.parent}"` : ""})\ndistinctive words: ${p.terms.join(", ")}\nmost cited titles:\n- ${p.examples.slice(0, 10).join("\n- ")}`).join("\n\n")}` }],
  };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "evidence-map-mock" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json).slice(0, 400));
  console.log("cost", json.usage?.cost, "tokens", json.usage?.total_tokens);
  return JSON.parse(json.choices[0].message.content).names;
}
const regions = places.filter((p) => p.level === 1);
const names = await ask(regions, "These are the map's regions, the largest areas.");
for (const p of regions) p.name = names[p.id];
// An area's region: the region whose members it shares. Areas are laid out inside one region, so its centre lies in it.
const near = (a) => regions.reduce((best, r) => (Math.hypot(r.x - a.x, r.y - a.y) - r.radius < Math.hypot(best.x - a.x, best.y - a.y) - best.radius ? r : best));
const areas = places.filter((p) => p.level === 2).map((a) => ({ ...a, parent: near(a).name }));
for (let i = 0; i < areas.length; i += 30) {
  const batch = areas.slice(i, i + 30);
  const got = await ask(batch, "These are areas inside the regions; name what sets each apart within its region.");
  for (const a of batch) places[a.id].name = got[a.id];
}
const out = places.map(({ id, level, size, x, y, radius, name }) => ({ id, level, size, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, radius: Math.round(radius * 10) / 10, name }));
fs.writeFileSync(`${DIR}/places.json`, JSON.stringify(out));
console.log(out.filter((p) => p.level === 1).map((p) => `${p.name} (${p.size})`).join(" | "));
console.log("areas, sample:", out.filter((p) => p.level === 2).slice(0, 14).map((p) => p.name).join(" | "));
console.log("unnamed:", out.filter((p) => !p.name).length);
