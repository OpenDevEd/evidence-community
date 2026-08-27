---
name: test-decision
description: Decide whether a test change is justified before creating, editing, deleting, or reviewing any test file or assertion. Must be used whenever an agent is about to touch tests, even if the user did not ask for tests, and for requests mentioning tests, coverage, assertions, Vitest, Playwright, specs, regression tests, or TDD.
---

# Test decision

Use this gate before touching any test file or assertion.

## Read the repository rule

Read `docs/test-quality.md` and the test section of `AGENTS.md`. If either file
is absent, use this skill as the minimum rule.

## Decide before editing

Classify the change:

1. Behavior, data, authentication, API, accessibility, worker, provider, or
   other lasting contract.
2. New or changed plain logic.
3. Copy, visual style, comments, documentation, or a refactor that preserves
   public behavior.

For class 3, do not create or change a test. Run relevant existing checks. Use
the real browser or a screenshot for copy and visual work.

The only exact-text exception is wording that is itself a lasting legal,
security, accessibility, or protocol contract. Record that contract in the test
name or a short comment. Ordinary product copy is not an exact-text contract.

For classes 1 and 2, answer all five questions before touching tests:

1. What behavior or contract changed?
2. Which concrete defect will this test catch?
3. Why does existing coverage not catch it?
4. What is the smallest honest boundary where the result is visible?
5. Will the test survive harmless copy changes and internal refactoring?

If any answer is missing, do not edit the test. Read more code or use existing
verification instead.

Use red → green → clean up for new plain logic. For integrated behavior, test
the real boundary and state rather than a copied implementation or self-proving
mock.

## Reject copy fossils

Bad:

```ts
expect(card.textContent).not.toContain("optional");
```

This freezes ordinary wording and proves no DOI behavior.

Good: change the copy, run existing checks, and inspect the rendered card. Add
no test.

A justified exact-text assertion names the durable contract it protects, such
as an accessible control name or a protocol error consumed by a client.

## Report the decision

Before implementation, say one of:

- `Test change: yes — <behavior and defect>.`
- `Test change: no — <copy/style/docs/refactor>; using <existing check and real verification>.`

Do not add a test merely because tests are generally good, a line changed, or a
coverage tool reports an uncovered line.
