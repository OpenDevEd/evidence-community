# Evidence map: data build

`/evidence` draws AIED's citation graph with the evidence checks from the citation-map JSON laid over it. The data is
built offline into `public/evidence-data/aied/` and `src/components/pages/evidence/records.json`, and only the library
whose address matches the data's (`aied.openscholar.ai`) shows the map, its buttons and its checks.

1. `node scripts/evidence-map/tunnel.mjs`: read-only access to AIED's database on `localhost:55446` and its search on
   `localhost:7716`. It finds AIED's search server again after a redeploy. Stop it by its PID when done.
2. `node scripts/evidence-map/export.cjs` (with `config/library.local.json` pointing at those ports): exports the graph,
   only records a reader can find, to `/tmp/evidence-data/aied-{nodes,edges,meta,doi}.csv`. Topic names come from
   `aied-topics.csv`.
3. `node --max-old-space-size=12288 scripts/evidence-map/build.mjs public/evidence-data/aied "<citation-map.json>"`:
   communities, layout, Hilbert renumbering and the binary columns, about 35 seconds, the same map every run. Needs
   `graphology`, `graphology-layout-forceatlas2` and `graphology-communities-louvain`, installed outside the app.
4. `node scripts/evidence-map/name.mjs public/evidence-data/aied`: names the regions and areas with GPT-6 Luna through
   OpenRouter (6 calls, under a cent). Only needed when the layout changed (`places-raw.json` differs).

Checks, against a `next dev` server (their test handle is development-only):

- `BASE=http://localhost:<port> node scripts/evidence-map/fit-check.mjs`: every camera focus fits beside the panels in
  five layouts.
- `BASE=http://localhost:<port> node scripts/evidence-map/morph-check.mjs`: points land where their names and lines are
  after rapid clicks and hovers, and a switch's fade finishes without a hover.

These scripts run by hand to rebuild the data; they never ship in the app, so `.fallowrc.json` leaves this folder out of the code-quality gate.
