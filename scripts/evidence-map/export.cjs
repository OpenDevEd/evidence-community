// Read-only re-export of AIED's graph for the evidence map, the same queries as scripts/evidence-map/export-*.sql.
const { Client } = require("pg");
const fs = require("fs");
const c = require(process.cwd() + "/config/library.local.json");
const url = JSON.stringify(c.services).match(/postgres(ql)?:\/\/[^"]+/)[0];
const inner = (file) => fs.readFileSync(file, "utf8").trim().replace(/^COPY \(/, "").replace(/\) TO STDOUT WITH \(FORMAT csv\);$/, "");
const cell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const DOI = `SELECT i."key", lower(regexp_replace(i."DOI", '^https?://(dx\\.)?doi\\.org/', '')), coalesce(substring(i."date" from '(\\d{4})'), ''),
  left(regexp_replace(coalesce(i."title", ''), '\\s+', ' ', 'g'), 200),
  coalesce(nullif(i."creators"->0->>'lastName', ''), substring(i."creators"->0->>'name' from '(\\S+)\\s*$'), ''),
  coalesce(jsonb_array_length(i."creators"), 0)
  FROM "item" i WHERE coalesce(i."DOI", '') <> '' AND coalesce(i."deleted", 0) <> 1
  AND NOT EXISTS (SELECT 1 FROM "itemToTag" t WHERE t."itemKey" = i."key" AND lower(t."tagName") = ANY($1))
  AND NOT EXISTS (SELECT 1 FROM "itemReading" r WHERE r."itemKey" = i."key" AND r."screenedOut")`;
(async () => {
  const db = new Client({ connectionString: url }); await db.connect();
  await db.query("SET default_transaction_read_only = on");
  // The library's hidden tags, as its public search leaves them out.
  const hidden = (c.content?.tags?.hidden ?? []).map((tag) => tag.toLowerCase());
  console.log("hidden tags", hidden);
  const jobs = [["nodes", inner("scripts/evidence-map/export-nodes.sql")], ["edges", inner("scripts/evidence-map/export-edges.sql")], ["meta", inner("scripts/evidence-map/export-meta.sql")], ["doi", DOI]];
  for (const [name, sql] of jobs) {
    const t = Date.now();
    const { rows } = await db.query({ text: sql, values: [hidden], rowMode: "array" });
    fs.writeFileSync(`/tmp/evidence-data/aied-${name}.csv`, rows.map((r) => r.map(cell).join(",")).join("\n") + "\n");
    console.log(name, rows.length, `${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  await db.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
