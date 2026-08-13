# Step prompts

## Step 01

```text
Implement plans/admin-password-access/01-admin-password-and-normal-https.md. Read plans/admin-password-access/00-README.md first. Estimate 3-5 hours and keep working without asking questions whose answers are already in the plan.

STANDING RULES
1. Reuse before building. Search for the existing admin gate, response headers, rate limiter, forms, tests, Compose file, and Coolify workflow first.
2. Delete the old Tailscale deployment and ADMIN_AUTH_BYPASS completely. Do not preserve compatibility code, fallback reads, or old docs.
3. Read the installed Next.js authentication, cookies, forms, and Route Handler docs before changing those APIs.
4. Use red, green, clean up for pure authentication logic. Add or update behavior tests with every integration change. Never test CSS class strings.
5. Do not use useEffect for authentication, forms, redirects, or copied state. Use Server Components, native forms, Route Handlers, and request-time checks.
6. Check the running Next.js app after app/component commits with `npx pm2 logs next --lines 5 --nostream`. Require a recent `✓ Compiled` and no recent compile or runtime error.
7. Use the supported Coolify API and read every saved value back. Never edit Coolify's database directly.
8. Use Fable-5 at High to review this whole completed step. Reviewers remain read-only.

EXECUTION RHYTHM
- Write a failing test for each pure password or cookie rule, make it pass, clean it up, and commit the working unit.
- For routes, forms, Compose, and deployment, add or update the exact integration test with the change and commit each complete working unit.
- Run focused checks after each unit. Run the full listed gate before push.

COMMIT DISCIPLINE
- Use only feat, fix, refactor, test, chore, docs, perf, or style prefixes.
- Add [plan-01] to every commit.
- Never commit while a relevant test is failing.
- Do not stage unrelated work from another agent.
- Push only the tested commits on the task branch.

WHEN TO STOP
- Stop only for a required API or permission that does not exist after safe checks are exhausted. Record it in plans/admin-password-access/01-BLOCKER.md.
- Do not stop for an answer already in the plan, token worry, or the urge to ask the user.
- Do not stop until the tests, build, live HTTPS checks, PDF upload, logout, and final review are complete.

DEVIATIONS
- If this plan is wrong but the better path is clear, commit safe work, update this numbered plan, commit `docs: [plan-01] revise <section> — <reason>`, then continue.
- Never change the authentication or deployment design silently.

START NOW
1. Read the plan and README.
2. Read the installed Next.js docs named there.
3. Check `git status`, the current commit, and the current deployment.
4. Start the first failing pure authentication test.

Go.
```
