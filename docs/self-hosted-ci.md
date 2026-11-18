# Self-hosted CI

Last checked: **2026-10-08**

GitHub schedules and reports every CI job. An isolated Ubuntu 24.04 KVM guest
named `new-el-ci` executes the jobs on the development Hetzner server.
No hosted runner service is part of the workflow.

## Current runner layout

| Count | Label | CPU boundary | Memory limit | Work |
|---:|---|---:|---:|---|
| 4 | `evidence-library-light` | any guest CPU | 8 GiB each | static checks with Fallow, unit tests, the final result and release notes |
| 1 | `evidence-library-runtime` | any guest CPU, 6 cores at most | 32 GiB | Docker build, runtime acceptance and the database integration tests |
| 1 | `evidence-library-release` | any guest CPU, 6 cores at most | 32 GiB | select, publish and record the exact green runtime commit |

The guest has 8 virtual CPUs (24 until 2026-10-08), 48 GiB of memory and a 300 GiB sparse disk.
While no job runs, the `ci-idle-reclaim.timer` drops the guest's file cache every five
minutes, and virtio free page reporting hands that memory back to the host.
No runner is pinned to CPUs. A job running alone uses every idle CPU, and when
jobs compete the kernel shares CPU time between `system.slice` (the light
runners), `user.slice` (rootless Docker) and `evidence-library-heavy.slice`
(the heavy runner listeners), so the light runners still get about a third of
the guest. Until 2026-09-28 each light runner was pinned to two CPUs, and the
unit tests took 264 seconds instead of 82 on six.

The runtime runner is `new-el-ci-runtime`, run by `gha-runtime`. Each heavy user owns a
separate rootless Docker daemon and persistent BuildKit builder: `evidence-library-runtime`
for tests and `evidence-library-release` for publication. One runtime job needs the
whole 8-vCPU guest: when three ran at once, each took three times as long and
timed out, so `new-el-ci-runtime-2` and `-3` (users `gha-runtime-2` and `-3`) stay
registered but their services are disabled. Rootless Docker daemons hand out
host ports without seeing each other's bindings, so CI containers publish a
port the guest reports free instead of a random one.

Keep rootless Docker's user managers under `user.slice`. Moving a manager to
the listener slice stops Docker from creating container scopes. Put the
`CPUQuota=600%`, `AllowedCPUs=0-7` and `MemoryMax=32G` limits on the user slice of every heavy
user instead: `gha-runtime`, `gha-runtime-2`, `gha-runtime-3` and `gha-release`.
Check them with `systemctl show user-$(id -u <user>).slice -p AllowedCPUs -p CPUQuotaPerSecUSec -p MemoryMax`.

## Isolation

- The guest has no host mount or host Docker socket.
- Runner users cannot use `sudo`.
- The guest firewall permits public internet access but denies the Hetzner host,
  private address ranges, Docker networks and cloud metadata addresses.
- Only `Openscholar-ai/evidence-community` can use the `Evidence Library CI` runner group.
- Only `.github/workflows/runtime-image.yml` from the default branch can use
  the separate `Evidence Library Release` runner group.
- Pull requests from another repository do not receive a self-hosted job.
- Test jobs receive `contents: read` and no deployment credentials.

The organization currently uses a GitHub plan that does not support branch
protection or rulesets for this private repository. GitHub runs CI, but it
cannot require a green result before merge. The integration owner must check
the aggregate `CI` result for the exact head until the organization moves to
GitHub Team.

## Normal operation

Find the guest address and list its runners:

```sh
ssh hetzner 'sudo virsh domifaddr new-el-ci --source lease'
gh api orgs/OpenDevEd/actions/runner-groups/6/runners \
  --jq '.runners[] | [.name, .status, .busy] | @tsv'
gh api orgs/OpenDevEd/actions/runner-groups/7/runners \
  --jq '.runners[] | [.name, .status, .busy] | @tsv'
```

Check the guest and runner services from the Hetzner host:

```sh
ssh hetzner 'sudo virsh dominfo new-el-ci'
ssh -J hetzner ci-admin@192.168.122.185 \
  'systemctl --no-pager --type=service "actions.runner.*"'
```

The guest address comes from libvirt DHCP. Read it again instead of assuming
the example address stayed the same.

Check rootless Docker and BuildKit for each runtime user:

```sh
ssh -J hetzner ci-admin@192.168.122.185 '
  for user in gha-runtime gha-runtime-2 gha-runtime-3; do
    uid=$(id -u $user)
    echo "== $user"
    sudo -u $user env \
      HOME=/home/$user \
      XDG_RUNTIME_DIR=/run/user/$uid \
      DOCKER_HOST=unix:///run/user/$uid/docker.sock \
      docker buildx inspect evidence-library-runtime
  done
'
```

Check the separate release cache the same way:

```sh
ssh -J hetzner ci-admin@192.168.122.185 '
  release_uid=$(id -u gha-release)
  sudo -u gha-release env \
    HOME=/home/gha-release \
    XDG_RUNTIME_DIR=/run/user/$release_uid \
    DOCKER_HOST=unix:///run/user/$release_uid/docker.sock \
    docker buildx inspect evidence-library-release
'
```

Do not run a global Docker prune. Inspect the named builder first and remove
only a cache or container that belongs to this CI guest.

## CI behavior

A pull request uses two light runners and one runtime runner:

- `Static checks` installs dependencies, then runs Fallow, lint, the type check
  (TypeScript 7) and the generated-schema check at the same time. Fallow and ESLint
  keep their caches in the runner user's `~/.cache`, so a warm run reads only
  what changed.
- `Unit tests` runs Vitest. Files share one module graph per worker unless they
  mock a module or need jsdom; see `vitest.config.ts`.
- `Runtime and integration` builds the image and runs the acceptance suite with
  four Playwright workers. On a pull request it runs the smoke scope: Amber alone,
  its API checks, and the browser tests tagged `@smoke`. On `main`, the nightly
  run (02:23 UTC, which runs this job alone) and a dispatched run it runs everything: both libraries, every
  browser spec and the publication interface, with the Indigo browser suite in the
  background while the Amber checks run. A failed nightly run reopens or opens
  "[EL-15] Nightly CI fails on main". The database integration tests run beside
  it against their own PostgreSQL container. The deployment checks (the repository
  Compose stack and a root-owned config) run on `main` and on pull requests that
  change a deployment file.

The aggregate `CI` job records the tree a passing pull request run tested as an
artifact named `ci-passed-<tree>`. A push to `main` whose tree matches skips the
static checks and unit tests and still runs the full runtime suite, whose success
publishes the runtime image.

Each runner user keeps its last two installed dependency trees under
`~/.cache/evidence-library-install`, keyed by Node's version and the Git
hashes of `package.json`, `package-lock.json`, `patches` and
`packages/evidence-library-core`. A matching job copies the tree as hard links
in about 3 seconds instead of running `npm ci` for about 45. The npm download
cache stays on the runner's disk, so `actions/setup-node` does not restore it.

The acceptance image skips the Next.js type check (`SKIP_BUILD_TYPECHECK=1`)
because `Static checks` runs the same type check. The Compose files set
`start_interval: 1s`, so a service counts as healthy about a second after it is
ready instead of at Docker's default five-second probe.

Playwright's browsers stay in each runner user's `~/.cache/ms-playwright`, so
the runtime job downloads Chromium only when the lockfile selects a new build.
The rootless Docker daemon and named BuildKit builder keep Docker layers
between runs. A failed or canceled run must still execute the acceptance
cleanup before the next runtime job.

## Runtime image build measurement

The first clean unified-image build on the release account took **146.96
seconds**. The unchanged rebuild took **4.05 seconds**, including loading the
image into rootless Docker. The resulting image was **476,081,955 bytes**. The
real publisher pushes to GHCR instead of loading locally, so registry transfer
time is added to its first publish.
