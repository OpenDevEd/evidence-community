# Self-hosted CI

Last checked: **2026-09-24**

GitHub schedules and reports every CI job. An isolated Ubuntu 24.04 KVM guest
named `new-el-ci` executes the jobs on the development Hetzner server.
No hosted runner service is part of the workflow.

## Current runner layout

| Count | Label | CPU boundary | Memory limit | Work |
|---:|---|---:|---:|---|
| 4 | `evidence-library-light` | 2 fixed guest CPUs each | 8 GiB each | lint, types, schemas, unit tests, Fallow, the final result and release notes |
| 3 | `evidence-library-runtime` | guest CPUs 8 through 23 | 32 GiB each | Docker build and runtime acceptance |
| 1 | `evidence-library-release` | guest CPUs 8 through 23 | 32 GiB | select, publish and record the exact green runtime commit |

The guest has 24 virtual CPUs, 48 GiB of memory and a 300 GiB sparse disk. The
four light runners use guest CPUs 0 through 7. The runtime and release users
are all limited to CPUs 8 through 23, so their combined Docker work cannot use
more than those 16 cores. Their runner listeners share the
`evidence-library-heavy.slice` limit. Each user owns a separate rootless Docker
daemon and persistent BuildKit builder: `evidence-library-runtime` for tests
and `evidence-library-release` for publication.

The runtime runners are `new-el-ci-runtime`, `-2` and `-3`, run by the users
`gha-runtime`, `gha-runtime-2` and `gha-runtime-3`. A single runtime job used
about 6 GiB of memory and left the guest CPUs more than 90% idle while its
browser tests ran, so three can run at once. Each job picks free ports when it
starts, but releases them again before Docker binds them, so two jobs can rarely
pick the same port and one fails; rerun it.

Keep rootless Docker's user managers under `user.slice`. Moving a manager to
the listener slice stops Docker from creating container scopes. Put the same
`AllowedCPUs=8-23` and `MemoryMax=32G` limits on the user slice of every heavy
user instead: `gha-runtime`, `gha-runtime-2`, `gha-runtime-3` and `gha-release`.
Check them with `systemctl show user-$(id -u <user>).slice -p AllowedCPUs -p MemoryMax`.

## Isolation

- The guest has no host mount or host Docker socket.
- Runner users cannot use `sudo`.
- The guest firewall permits public internet access but denies the Hetzner host,
  private address ranges, Docker networks and cloud metadata addresses.
- Only `OpenDevEd/new-el` can use the `Evidence Library CI` runner group.
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

The workflow keeps the existing matrix and aggregate `CI` result. The runtime
job uses four Playwright workers, installs the lockfile-selected Chromium build,
and runs the complete acceptance suite. The VM already contains Chromium's
Linux packages, so the job does not need `sudo`.

`actions/setup-node` and `actions/cache` keep npm and browser downloads between
runs. The rootless Docker daemon and named BuildKit builder keep Docker layers
between runs. A failed or canceled run must still execute the acceptance
cleanup before the next runtime job.

## Runtime image build measurement

The first clean unified-image build on the release account took **146.96
seconds**. The unchanged rebuild took **4.05 seconds**, including loading the
image into rootless Docker. The resulting image was **476,081,955 bytes**. The
real publisher pushes to GHCR instead of loading locally, so registry transfer
time is added to its first publish.
