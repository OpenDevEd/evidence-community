# Self-hosted CI

Last checked: **2026-08-30**

GitHub schedules and reports every CI job. An isolated Ubuntu 24.04 KVM guest
named `new-el-ci` executes the jobs on the development Hetzner server.
No hosted runner service is part of the workflow.

## Current runner layout

| Count | Label | CPU boundary | Memory limit | Work |
|---:|---|---:|---:|---|
| 4 | `evidence-library-light` | 2 fixed guest CPUs each | 8 GiB each | lint, types, schemas, unit tests, Fallow and the final result |
| 1 | `evidence-library-runtime` | guest CPUs 8 through 23 | 32 GiB | Docker build and runtime acceptance |

The guest has 24 virtual CPUs, 48 GiB of memory and a 300 GiB sparse disk. The
four light runners use guest CPUs 0 through 7. The runtime runner and its
rootless Docker daemon use CPUs 8 through 23. Docker keeps one persistent
`evidence-library-runtime` BuildKit builder.

The future image publisher gets a separate OS user, rootless Docker daemon,
BuildKit cache and GitHub runner group. Do not put it in the CI runner group.

## Isolation

- The guest has no host mount or host Docker socket.
- Runner users cannot use `sudo`.
- The guest firewall permits public internet access but denies the Hetzner host,
  private address ranges, Docker networks and cloud metadata addresses.
- Only `OpenDevEd/new-el` can use the `Evidence Library CI` runner group.
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
```

Check the guest and runner services from the Hetzner host:

```sh
ssh hetzner 'sudo virsh dominfo new-el-ci'
ssh -J hetzner ci-admin@192.168.122.185 \
  'systemctl --no-pager --type=service "actions.runner.*"'
```

The guest address comes from libvirt DHCP. Read it again instead of assuming
the example address stayed the same.

Check rootless Docker and BuildKit as the runtime user:

```sh
ssh -J hetzner ci-admin@192.168.122.185 '
  runtime_uid=$(id -u gha-runtime)
  sudo -u gha-runtime env \
    HOME=/home/gha-runtime \
    XDG_RUNTIME_DIR=/run/user/$runtime_uid \
    DOCKER_HOST=unix:///run/user/$runtime_uid/docker.sock \
    docker buildx inspect evidence-library-runtime
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
