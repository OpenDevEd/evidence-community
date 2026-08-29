---
name: blacksmith-testbox
description: Use Blacksmith Testbox only to reproduce a CI-only failure or run a focused check that needs the CI environment. It is not the default local test runner.
---

# Blacksmith Testbox

Use this only after a local focused check cannot reproduce the problem or the
required service exists only in CI.

## Before starting

1. Read `.github/workflows/blacksmith-testbox.yml` and the relevant job in
   `.github/workflows/ci.yml`.
2. Run `blacksmith testbox --help` to confirm the installed CLI syntax.
3. Name the one failing CI job or unavailable service that requires Testbox.

Do not warm a Testbox for routine coding, linting, type checks, unit tests, or
documentation changes.

## Run a focused reproduction

Always run the Blacksmith command from the repository root. File sync mirrors
the current repository tree.

```sh
blacksmith testbox warmup blacksmith-testbox.yml
blacksmith testbox run --id <id> "<smallest command that reproduces the failure>"
```

Reuse the same warm Testbox while fixing that failure. If a dependency manifest
changed, run the matching install command in the Testbox before the check.

Download only the artifact needed to diagnose the failure:

```sh
blacksmith testbox download --id <id> <remote-path> <local-path>
```

## Completion

Stop the Testbox when the investigation ends:

```sh
blacksmith testbox stop --id <id>
```

Report the Testbox ID, exact command, result, and why a local check was not
enough. The final merge gate remains GitHub CI on the exact PR head.
