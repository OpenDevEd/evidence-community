#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repository_root/.github/scripts/resolve-fallow-comparison.sh"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

git init --bare "$test_root/origin.git" >/dev/null
git init -b main "$test_root/source" >/dev/null
git -C "$test_root/source" config user.email ci@example.test
git -C "$test_root/source" config user.name CI
git -C "$test_root/source" remote add origin "$test_root/origin.git"

printf 'base\n' > "$test_root/source/file.txt"
git -C "$test_root/source" add file.txt
git -C "$test_root/source" commit -m base >/dev/null
stable_sha="$(git -C "$test_root/source" rev-parse HEAD)"
git -C "$test_root/source" tag fallow-ci-baseline-2026-08-21
git -C "$test_root/source" push origin main refs/tags/fallow-ci-baseline-2026-08-21 >/dev/null

git -C "$test_root/source" switch -c feature >/dev/null
printf 'feature\n' >> "$test_root/source/file.txt"
git -C "$test_root/source" commit -am feature >/dev/null
feature_sha="$(git -C "$test_root/source" rev-parse HEAD)"
git -C "$test_root/source" push origin feature >/dev/null

git -C "$test_root/source" switch main >/dev/null
printf 'failed push\n' >> "$test_root/source/file.txt"
git -C "$test_root/source" commit -am failed-push >/dev/null
failed_push_sha="$(git -C "$test_root/source" rev-parse HEAD)"
git -C "$test_root/source" push origin main >/dev/null

git clone "$test_root/origin.git" "$test_root/runner" >/dev/null 2>&1
git -C "$test_root/runner" checkout "$failed_push_sha" >/dev/null 2>&1
resolved_push_sha="$(
  cd "$test_root/runner"
  resolve_fallow_comparison push "" refs/tags/fallow-ci-baseline-2026-08-21
)"
test "$resolved_push_sha" = "$stable_sha"
test "$resolved_push_sha" != "$failed_push_sha"

git -C "$test_root/source" reset --hard "$stable_sha" >/dev/null
printf 'rewritten base\n' > "$test_root/source/rewritten.txt"
git -C "$test_root/source" add rewritten.txt
git -C "$test_root/source" commit -m rewritten-base >/dev/null
git -C "$test_root/source" push --force origin main >/dev/null

git -C "$test_root/runner" checkout "$feature_sha" >/dev/null 2>&1
resolved_pr_sha="$(
  cd "$test_root/runner"
  resolve_fallow_comparison pull_request main refs/tags/fallow-ci-baseline-2026-08-21
)"
test "$resolved_pr_sha" = "$stable_sha"

printf 'Fallow comparison tests passed.\n'
