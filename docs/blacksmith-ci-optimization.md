# Blacksmith CI optimization

Last checked: **2026-08-23**

## Result

Runtime acceptance keeps the same full application, worker, database, search,
file, provider-fixture, desktop, and mobile coverage. The workflow now:

- uses a 4-vCPU Blacksmith runner instead of 8 vCPU;
- runs CI browser tests with four Playwright workers;
- keeps the local admin browser suite at one worker for stability;
- builds the app, search worker, and publication worker together with Buildx
  Bake;
- keeps Blacksmith's existing dependency and Docker layer caches; and
- writes and verifies one JUnit report for each Playwright invocation so
  Blacksmith Test Analytics has stable durations and retry data.

No test was removed, skipped, mocked differently, or moved out of the required
aggregate `CI` gate.

## Measured runs

The comparison uses the runtime job duration shown by GitHub. Blacksmith bills
x64 use in 2-vCPU minutes, so estimated billed compute is
`wall minutes × vCPU / 2`.

| Change | Runner | Runtime job | 2-vCPU minutes | Proof |
|---|---:|---:|---:|---|
| Original workflow | 8 vCPU | 6m46s | 27.07 | [run 32636706666](https://github.com/OpenDevEd/new-el/actions/runs/32636706666) |
| Four Playwright workers | 8 vCPU | 5m14s | 20.93 | [run 32638297024](https://github.com/OpenDevEd/new-el/actions/runs/32638297024) |
| One Bake build | 8 vCPU | 4m29s | 17.93 | [run 32639483974](https://github.com/OpenDevEd/new-el/actions/runs/32639483974) |
| Smaller runner, first run | 4 vCPU | 4m22s | 8.73 | [run 32639763309](https://github.com/OpenDevEd/new-el/actions/runs/32639763309) |
| Smaller runner, confirmation | 4 vCPU | 4m37s | 9.23 | [run 32640010414](https://github.com/OpenDevEd/new-el/actions/runs/32640010414) |
| JUnit reporting | 4 vCPU | 4m24s | 8.80 | [run 32640329085](https://github.com/OpenDevEd/new-el/actions/runs/32640329085) |
| Final JUnit self-check | 4 vCPU | 4m25s | 8.83 | [run 32640946590](https://github.com/OpenDevEd/new-el/actions/runs/32640946590) |

The four successful final-shape 4-vCPU samples range from 4m22s to 4m37s, with
a 4m25s median. Compared with the 6m46s baseline, the median is 34.9% faster
and uses 67.4% fewer billed compute minutes. The admin suite fell from about
2m29s to 39-48 seconds in the measured Bake runs and completed without retries.

[Final branch run 32640946590](https://github.com/OpenDevEd/new-el/actions/runs/32640946590)
passed every required lane and the aggregate `CI` gate at commit `f73dbb63`.
It wrote and validated all 12 Playwright JUnit reports.

One intentionally strict run failed after all application tests passed:
[run 32640649654](https://github.com/OpenDevEd/new-el/actions/runs/32640649654)
proved that separate Playwright commands clean their shared default result
folder. Each invocation now has its own artifact and JUnit folder. Failed or
canceled runs are excluded from performance totals.

## Normal developer workflow

Use the fast local branch gate during development:

```sh
npm run check:changed
```

Run the complete local acceptance suite once before pushing a change that
affects the browser, runtime configuration, database, workers, search, files,
or provider flows:

```sh
npm run test:acceptance
```

The local command deliberately keeps the large admin browser suite at one
worker. Do not set `CI=true` or `PLAYWRIGHT_WORKERS=4` locally unless you are
deliberately stress-testing the machine. A normal local acceptance run with
prebuilt Bake images passed in 5m53s. A local four-worker stress run exposed
resource-related browser timeouts, which is why local and Blacksmith worker
counts are intentionally different.

GitHub remains the required merge proof. Read the exact runtime job and final
aggregate `CI` job. Use Blacksmith Testbox only to reproduce a clean-Linux or
GitHub-only failure. Do not make Testbox the normal development loop.

## Why these choices stay

### Existing caches

The repository uses upstream `actions/setup-node` and `actions/cache`.
Blacksmith redirects those actions to its colocated dependency cache without a
workflow fork or extra charge. The pinned `useblacksmith/setup-docker-builder`
action supplies the persistent BuildKit cache. Related Docker targets keep one
cache key because they share the same Dockerfile and layers.

Sources: [Blacksmith dependency cache](https://docs.blacksmith.sh/blacksmith-caching/dependencies-actions),
[Blacksmith Docker cache](https://docs.blacksmith.sh/blacksmith-caching/docker-builds).

### Buildx Bake

`docker-bake.acceptance.hcl` defines the existing app, search-indexer, and
publication-worker targets as one group. `docker buildx bake --load` lets
BuildKit schedule shared work together and loads all three images for the
disposable Compose runtime.

Source: [Docker Buildx Bake](https://docs.docker.com/build/bake/).

### Runner size

Blacksmith charges proportionally by vCPU. One 8-vCPU wall minute costs four
2-vCPU minutes; one 4-vCPU wall minute costs two. Two independent 4-vCPU runs
and the JUnit run all passed without retries, while wall time stayed within
eight seconds of the 8-vCPU Bake result.

Source: [Blacksmith runner sizes and billing units](https://docs.blacksmith.sh/blacksmith-runners/overview).

### Test Analytics

Blacksmith can best-effort parse Playwright logs, but its documented reliable
path is JUnit XML. The acceptance runner gives every Playwright invocation a
unique result folder and fails if a report is missing or invalid. Blacksmith
detects the XML without an upload action.

Sources: [Blacksmith Test Analytics](https://docs.blacksmith.sh/blacksmith-observability/test-analytics),
[Playwright JUnit reporter](https://playwright.dev/docs/test-reporters#junit-reporter).

## Do not add now

- Do not add Sticky Disks. Cache restore and Chromium installation were not the
  bottleneck, and Sticky Disks add beta storage cost.
- Do not export BuildKit cache with `cache-from` or `cache-to`. Blacksmith's
  persistent builder already owns this cache and preserves cache mounts.
- Do not split the three related images across cache keys.
- Do not shard the acceptance suite across paid runners. The current single
  runner is faster and cheaper than the baseline without duplicating service
  startup.
- Do not use ARM for this gate. It would change the tested architecture.
- Do not increase the runner size without a measured regression.

## Ongoing checks

1. Review the Blacksmith Tests and Metrics views when runtime acceptance exceeds
   six minutes or a test retries. Fix the changed phase instead of raising the
   timeout or runner size first.
2. Re-run two sequential 4-vCPU benchmarks after major Dockerfile, Next.js,
   Playwright, or service-topology changes. Compare wall time and billed compute.
3. Confirm in the Blacksmith account that Faster Container Init has reached the
   organization. Blacksmith says it is free and needs no repository change, but
   rollout status cannot be proved from this repository.
4. Keep failed and canceled runs out of cache and timing comparisons. Blacksmith
   commits persistent Docker cache changes only after a successful job.

Source: [Blacksmith Faster Container Init](https://docs.blacksmith.sh/blacksmith-caching/docker-container-caching).
