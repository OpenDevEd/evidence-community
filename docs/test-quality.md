# Test quality standard

Read this guide and use the `test-decision` skill before creating, changing,
deleting, or reviewing any test or assertion.

## First decide whether a test belongs

A changed line does not automatically require a changed test.

Do not add or change a test for work that only changes ordinary interface copy,
visual styling, comments, documentation, or internal structure while public
behavior stays the same.

Run the existing checks that cover the area. Inspect copy and visual changes in
the real browser or a screenshot. Exact wording needs an assertion only when it
is itself a lasting legal, security, accessibility, or protocol contract.

Before changing tests, answer:

1. What behavior or contract changed?
2. Which concrete defect would the test catch?
3. Why does existing coverage not catch it?
4. What is the smallest boundary where the result is visible?
5. Will the test survive harmless copy changes and internal refactoring?

If those answers are not clear, do not change the test.

## What a useful test proves

Every test needs a clear claim, a real public boundary, an independent result,
failure sensitivity, and isolated disposable state.

| Claim | Check | Observe |
|---|---|---|
| Pure calculation or validation | Unit test | Return value or error |
| Database transaction or job | Integration test | Rows, jobs, and rollback |
| Route or authentication contract | HTTP test | Status, headers, body, and saved state |
| User interaction | Browser test | Roles, labels, visible state, URL, and resulting data |
| Layout or visual styling | Screenshot or visual check | Rendered result at the needed viewport |
| Import or architecture restriction | ESLint, TypeScript, or a named static check | Exact source violation |
| Model output | Production-like evaluation set | Task quality, failure types, time, and cost |

Do not replace an integration claim with mocks. Do not use a browser when a
pure function gives the same confidence faster.

## Reject these tests

Reject or rewrite tests that scan production source and call it behavior
coverage, copy the implementation into an assertion, prove only a configured
mock, freeze CSS or ordinary wording, depend on fixed sleeps or leaked state, or
do not run in the required CI job.

Static source rules belong in lint, TypeScript, or a named static check. Do not
count them as behavior tests.

## Bad and good examples

Bad:

```ts
expect(card.textContent).not.toContain("optional");
```

This freezes ordinary wording and proves no DOI behavior.

Good: make the copy edit, run existing checks, and inspect the real page. Add
no test. If text is a fixed accessibility name or protocol error, assert that
named contract at its real boundary and explain why it must remain exact.

Bad:

```ts
provider.publish.mockResolvedValue({ id: "123" });
expect(await publishRecord()).toEqual({ id: "123" });
```

Good: keep request construction, persistence, response handling, and duplicate
protection real. Fake only the outside network and assert the saved job and
public receipt.

## Review checklist

Before committing a test change, confirm that it is needed, every assertion
names a behavior and concrete defect, mocks stop only at outside boundaries,
browser checks use user-facing locators, state is isolated and cleaned up, and
the focused and wider required checks ran without watch mode.

## Primary guides

- [Vitest: Writing Tests with AI](https://main.vitest.dev/guide/learn/writing-tests-with-ai)
- [Playwright: Best Practices](https://playwright.dev/docs/best-practices)
- [Testing Library: Guiding Principles](https://testing-library.com/docs/guiding-principles/)
- [Stryker: What is mutation testing?](https://stryker-mutator.io/docs/)
- [OpenAI: How evals drive the next chapter in AI](https://openai.com/index/evals-drive-next-chapter-of-ai/)
