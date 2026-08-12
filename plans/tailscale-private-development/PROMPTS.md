# Execution prompts

## 01 — Private deployment and admin access

```text
Implement plans/tailscale-private-development/01-private-deployment-and-admin-access.md. Read plans/tailscale-private-development/00-README.md first. This step blocks further OpenScholar Evidence Library interface work. Estimate 2-4 hours and keep working without asking questions whose answers are already in the plan.

STANDING RULES
1. Reuse the existing Compose, admin bypass, runtime routing, probe, and search-worker contracts. Keep the private file compatible with Coolify 4.1.2: ordinary YAML only, no custom tags, and normal private service networking. Keep Tailscale Serve on its supported loopback target and use the checked repo-owned forwarder. Do not build a second login or admin gate.
2. Make a clean breaking change. Do not add a public fallback, compatibility URL, Funnel path, or dead deployment file.
3. Read current official Tailscale and Coolify docs before changing their configuration. Check the installed code and live deployment instead of guessing.
4. Use red, green, clean up for the deployment contract checker. Test parsed behavior and live results, never YAML formatting or CSS classes.
5. Never enable ADMIN_AUTH_BYPASS while a public hostname or host port reaches the web container. Keep the Tailscale key runtime-only; allow Coolify's build-time Compose render without copying the key into the image build.
6. Keep production tenants and shared production services out of scope.
7. Commit each green unit. Run the live deployment checks before reporting success.
8. Use other agents for broad research. Have Fable High review this completed step, not each line change.

EXECUTION RHYTHM
- Start with failing pure deployment-contract tests.
- Make the smallest repository-owned Compose and Serve change that passes.
- Add the operating guide and probes after the contract is green.
- Commit each working unit.
- Push the `openscholar` branch, read back the remote commit hash, then change the isolated Coolify application and deploy that commit.
- Delete the exact production `SERVICE_URL_WEB` and `SERVICE_FQDN_WEB` records by UUID, read back that both are absent, confirm `docker_compose_domains` is empty, stop the old stack, and verify the old public route is gone before deploying the Compose file that enables the bypass.
- Prove both sides: the Tailnet path works and the public path cannot route to the stack.

COMMIT DISCIPLINE
- Use conventional commit prefixes.
- Include [plan-01] in every implementation commit.
- Stage named files only. Preserve unrelated work.
- Never use hook bypass flags and never commit failing checks.
- Commit a plan correction before code that depends on it.

WHEN TO STOP
- Stop for a real missing API or permission only after safe checks are exhausted. Record the blocker in plans/tailscale-private-development/01-BLOCKER.md.
- Do not stop for an answer already in the plan, token concern, or the urge to ask the user.
- Do not stop after tests alone. The private browser path, admin API, Serve status, worker health, and public denial must all pass.

DEVIATIONS
- If the plan is wrong and the better path is clear, commit safe work, update this plan, commit the plan change, then continue.
- Do not change direction silently.
- Do not hide a missing access boundary with an application-only check.

START NOW
1. Read AGENTS.md, the README, and the numbered plan.
2. Check git status, branch, HEAD, origin/openscholar, and the live Coolify application.
3. Read the current official Tailscale Docker, Serve, and Coolify Compose docs.
4. Start the failing deployment-contract test.
5. Continue through the deployment and Fable review.

Go.
```
