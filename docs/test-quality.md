# Test quality standard

This is the required standard for tests in the Evidence Library. Read it before
writing, changing, or reviewing a test. AI-generated tests are drafts. Do not
commit one until every assertion proves real behavior.

This guide applies to unit, integration, browser, worker, provider, and AI-output
tests. The commands and cleanup rules remain in `AGENTS.md`.

## What a useful test must prove

Every test must have all of these:

1. **A clear claim.** Name the behavior, input, outcome, or failure being proved.
2. **A real boundary.** Call the public function, API, page, worker, database, or
   provider boundary where that behavior can be observed.
3. **An independent result.** Check returned data, visible UI, an HTTP response,
   saved rows, emitted jobs, files, or real service state. Do not repeat the
   implementation in the assertion.
4. **Failure sensitivity.** The test must fail if the claimed behavior is
   removed or changed incorrectly. For new plain logic, see it fail before the
   implementation, then make it pass.
5. **Isolation.** The result must not depend on test order, leaked mocks, old
   cookies, old containers, wall-clock sleeps, or data left by another test.

A passing test is not useful merely because it executes code. A coverage number
also does not prove that the assertions can catch a defect. Stryker's official
mutation-testing guide makes the same distinction: a changed implementation that
still passes has exposed a weak or missing test.

## Choose the smallest honest boundary

| Claim | Use | Observe |
|---|---|---|
| Pure calculation or validation | Unit test | Exact return value or error |
| Database transaction or job creation | Integration test with the real test database | Rows, revisions, cursors, jobs, and rollback |
| Route contract or authentication | HTTP test against the running route | Status, headers, body, and saved state |
| Worker behavior | Run the real worker against disposable services | Lease, job state, retries, database rows, and provider state |
| UI behavior | Browser test | Roles, labels, text, URL, accessible state, and resulting data |
| Layout or visual styling | Screenshot or visual check | Rendered result at the required viewport |
| Static import or architecture rule | ESLint, TypeScript, or a named static check | A source violation with a useful file and line error |
| Model-generated output | Evaluation set in a production-like test harness | Task-specific quality, failure types, and cost under fixed settings |

Do not replace a higher boundary with mocks when the claim is about integration.
Do not use a full browser when a pure function gives the same confidence faster.

## Required workflow

1. Read the implementation, types, callers, nearby tests, test configuration,
   and this guide before asking an agent to write tests.
2. Write the behavior and important failures first. Include boundaries, empty
   input, invalid input, conflicts, retries, and partial failure where they can
   happen.
3. For new plain logic, run the focused test and confirm the expected failure.
   Then implement the smallest change that makes it pass and clean up both code
   and test.
4. Run the focused test without watch mode. Then run the wider checks required
   by `AGENTS.md`. Stop and clean every disposable test environment you start.
5. Review every assertion using the rejection list below. Remove duplicate,
   tautological, flaky, and implementation-only tests before committing.

Vitest's official AI testing guide specifically recommends full source and type
context, relevant existing tests, the Vitest configuration, explicit edge cases,
restrained mocking, immediate execution, and human review of every generated
test.

## Reject these tests

Reject or rewrite a test when any answer below is yes:

- Does it read production source as text and search for a function name, local
  variable, code fragment, or exact call order to claim runtime behavior?
- Does it mock the unit under test, copy its algorithm into the test, or assert
  only that its own mock returned the value it was told to return?
- Would `toBeDefined()`, `not.toThrow()`, a broad snapshot, or a call-count check
  still pass when the result is wrong?
- Does it test a CSS class, Tailwind string, inline style, DOM nesting, private
  function, or component instance instead of what a user can see or do?
- Does it use a fixed sleep, manual polling without a deadline, or
  `expect(await locator.isVisible()).toBe(true)` instead of a condition that
  waits for the real outcome?
- Can another test's cookie, mock, database row, time, random value, port,
  process, or container change the result?
- Does it pass locally but never run in the required CI job?
- Does an AI-output score give credit for an empty, refused, uncited, or plainly
  wrong answer?

Static source checks can be useful, but they must be labelled and run as static
checks. They do not prove runtime behavior and must not be counted as unit,
integration, or acceptance coverage.

## Bad and good examples

### Prove authentication at the HTTP boundary

Bad:

```ts
const source = await readFile(route, "utf8");
expect(source).toContain("await requireAdminSession(request)");
```

This can pass when the call is unreachable, ignored, or followed by code that
still serves the request. It also breaks after harmless renaming or refactoring.
The Evidence Library removed this pattern from
`tests/unit/admin-auth-routes.test.ts` on 2026-08-24.

Good:

```ts
const response = await request.get("/api/admin/items");
expect(response.status()).toBe(401);
expect(response.headers()["cache-control"]).toBe("private, no-store");
expect(await response.json()).toEqual({
  error: {
    code: "unauthorized",
    message: "Enter the admin password to continue.",
  },
});
```

`tests/e2e/admin-runtime.spec.ts` now checks the real response for every protected
admin method. `tests/unit/admin-http.test.ts` separately checks the small shared
session helper. Each test has one honest job. When a protected admin handler is
added, removed, or gains another HTTP method, update `protectedAdminRequests` in
the runtime test in the same change.

### Assert the result, not mere existence

Bad:

```ts
const record = createRecord(input);
expect(record).toBeDefined();
```

Good:

```ts
expect(createRecord(input)).toMatchObject({
  key: "ABCDEFGH",
  title: "School feeding evidence",
});
```

The first assertion accepts almost any wrong value. Vitest uses this exact class
of mistake in its review guidance for AI-generated tests.

### Test the user contract, not page structure

Bad:

```ts
await page.locator("button.rounded-md.bg-blue-600").click();
expect(await page.getByText("Published").isVisible()).toBe(true);
```

Good:

```ts
await page.getByRole("button", { name: "Publish" }).click();
await expect(page.getByText("Record published", { exact: true })).toBeVisible();
```

Playwright recommends user-facing locators and retrying web assertions. Testing
Library gives the same rule: tests give more confidence when they resemble how
the software is used.

### Do not prove a mock with the same mock

Bad:

```ts
provider.publish.mockResolvedValue({ id: "123" });
expect(await publishRecord()).toEqual({ id: "123" });
expect(provider.publish).toHaveBeenCalledOnce();
```

This proves that the mock framework returned its configured value. It does not
prove request shape, persistence, retry safety, or provider handling.

Good:

```ts
const receipt = await publishRecord(recordKey);
expect(receipt.remoteId).toBe(providerState.createdId);
expect(await loadWritebackJob(recordKey)).toMatchObject({
  state: "succeeded",
  attempts: 1,
});
```

Use a controlled fake only at an external network boundary. Keep the code that
builds the request, saves the job, handles the response, and prevents duplicates
real.

### Keep architecture rules out of behavior coverage

Bad:

```ts
const source = readFileSync("src/worker.ts", "utf8");
expect(source).not.toContain("forbiddenImport");
```

Good: add an ESLint restriction, TypeScript boundary, or named static-analysis
command that reports the exact forbidden import. Keep a source scanner only when
no parser-based rule can express the invariant, label it as a static check, and
do not claim that it proves worker behavior.

## AI-output evaluations

Normal exact assertions do not fit every model-generated answer, but vague
scores are not acceptable. OpenAI's evaluation guidance recommends a golden set,
an error taxonomy built from reviewed outputs, realistic conditions, domain
expert judgment, and continuous measurement.

For every AI-output evaluation:

1. State the exact claim and define success, failure, refusal, and insufficient
   evidence before running it.
2. Start from real tasks and expert-reviewed expected outcomes. Review at least
   50 to 100 early outputs to build the first error categories and golden set.
3. Pin and report the model, reasoning setting, prompt or harness version, tools,
   retries, token budget, wall time, and cost.
4. Score missing and invalid outputs in the denominator. Zero citations cannot
   receive perfect citation validity. A non-empty answer is not automatically a
   correct answer.
5. Inspect samples for reward hacking, contamination, refusals, broken tasks,
   flaky tools, and shortcuts. Recheck human and model graders against expert
   judgment.

Keep the evaluation environment close to the real workflow. A prompt playground
or mocked transcript does not prove the deployed research flow.

## OpenScholar examples not to copy

These examples were verified on OpenScholar `origin/dev` at commit
`cf2ebdf795536a6951764d45823e17b1f0407d1a` on 2026-08-24. They are recorded
here for later work. Do not change the OpenScholar repository as part of an
Evidence Library task.

- [`tests/credit-purchase-idempotency.test.ts`](https://github.com/OpenDevEd/openalex-count/blob/cf2ebdf795536a6951764d45823e17b1f0407d1a/tests/credit-purchase-idempotency.test.ts)
  reads
  `convex/credits/internal.ts` and searches for local names, index names, and
  outcome strings. It does not replay a payment or refund and inspect the credit
  transaction. Replace it later with real idempotency and cumulative-refund
  behavior tests.
- [`tests/search-actions-screening-export.test.ts`](https://github.com/OpenDevEd/openalex-count/blob/cf2ebdf795536a6951764d45823e17b1f0407d1a/tests/search-actions-screening-export.test.ts)
  matches the exact source form
  of helper calls and object spreads. It does not export JSON and non-JSON data
  and compare their public results.
- The last tests in
  [`tests/credit-grant-policy.test.ts`](https://github.com/OpenDevEd/openalex-count/blob/cf2ebdf795536a6951764d45823e17b1f0407d1a/tests/credit-grant-policy.test.ts)
  and
  [`tests/credit-grant-retry.test.ts`](https://github.com/OpenDevEd/openalex-count/blob/cf2ebdf795536a6951764d45823e17b1f0407d1a/tests/credit-grant-retry.test.ts)
  search implementation source. The earlier
  pure policy tests in those files are useful and should remain.
- The first test in
  [`tests/proxy-auth-policy.test.ts`](https://github.com/OpenDevEd/openalex-count/blob/cf2ebdf795536a6951764d45823e17b1f0407d1a/tests/proxy-auth-policy.test.ts)
  searches text in
  `proxy.ts`. The later `shouldProtectPath` input/output tests are useful. The
  route matcher needs an HTTP boundary test or a static configuration check.
- [`tests/debug-internal.test.ts`](https://github.com/OpenDevEd/openalex-count/blob/cf2ebdf795536a6951764d45823e17b1f0407d1a/tests/debug-internal.test.ts)
  and
  [`convex/extraction/import-boundary.test.ts`](https://github.com/OpenDevEd/openalex-count/blob/cf2ebdf795536a6951764d45823e17b1f0407d1a/convex/extraction/import-boundary.test.ts)
  enforce source architecture. Move
  them later to lint or named static checks and stop counting them as behavior
  tests.

A
[historical OpenScholar evaluation prototype](https://github.com/OpenDevEd/openalex-count/blob/d543da65b07aac5f4d24eaaf0d68fd67208df0f3/tests/evals/screening-eval.test.ts#L183-L228)
at commit `d543da65b07aac5f4d24eaaf0d68fd67208df0f3` also had invalid scoring rules:
recall accepted any non-empty answer, citation validity excluded answers with no
citations from its denominator, and zero citations could receive a perfect rate.
It is not on current `dev`. Do not reuse those scoring patterns.

These findings do not mean the OpenScholar suite is generally bad. Many of its
state, billing, and Convex tests execute behavior. The listed cases are specific
patterns to replace.

## Review checklist

Before committing a test change, answer all of these with evidence:

- What user, API, data, worker, provider, or model behavior does each new test
  prove?
- Which exact defect would make it fail?
- Did the focused test fail for the expected reason before new plain logic was
  implemented?
- Are mocks limited to boundaries outside the behavior being claimed?
- Are browser actions based on roles, labels, visible text, or explicit test
  IDs, with retrying assertions and no fixed sleeps?
- Is all state disposable, isolated, and cleaned up?
- Does the test run in the required local command and CI job?
- Did you run the focused check and every wider check required by `AGENTS.md`?

## Sources

The rules above are based on these current primary guides, checked on
2026-08-24:

- [Vitest: Writing Tests with AI](https://main.vitest.dev/guide/learn/writing-tests-with-ai)
  — context, meaningful assertions, behavior over implementation, restrained
  mocking, edge cases, immediate execution, mock cleanup, and no watch mode.
- [Playwright: Best Practices](https://playwright.dev/docs/best-practices) —
  user-visible behavior, isolation, user-facing locators, and retrying web
  assertions.
- [Testing Library: Guiding Principles](https://testing-library.com/docs/guiding-principles/)
  — test software in the way users use it.
- [Stryker: What is mutation testing?](https://stryker-mutator.io/docs/) — code
  execution and coverage are not enough when altered behavior survives the
  assertions.
- [OpenAI: How evals drive the next chapter in AI](https://openai.com/index/evals-drive-next-chapter-of-ai/)
  — golden sets, review of 50 to 100 early outputs, error taxonomies, realistic
  environments, domain experts, and continuous measurement.
- [OpenAI: A shared playbook for trustworthy third-party evaluations](https://openai.com/index/trustworthy-third-party-evaluations-foundations/)
  — explicit claims, harness and budget reporting, and validity checks for
  reward hacking, contamination, refusals, and broken tasks.
