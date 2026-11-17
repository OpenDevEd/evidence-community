---
name: verify
description: Prove an Evidence Library change in real browsers with `npm run verify`. Use when a change touches a loading state, a dialog, sheet, popover or menu, or motion, and when reproducing a visual, loading or layout bug. Starts the acceptance fixture services with seeded records, serves production builds of this branch and of the main commit it starts from on them, checks that pages hold still in Chromium and Firefox with slow data, and stops what it started.
---

# Verify

`npm run verify` runs this worktree's library and drives it the way a person does. It replaces hand-written Playwright scripts: use it instead of building your own.

## Commands

```bash
npm run verify -- up                  # fixture services, seeded records, and production builds of this branch and its main commit
npm run verify -- shift /lib          # check a page in Chromium and Firefox, compared with main
npm run verify -- shift /lib --do "click role=button[name=\"Grid view\"]" --do "press Escape"
npm run verify -- shift /admin --as editor   # signed in to the admin
npm run verify -- shot /digests       # screenshots only
npm run verify -- status              # what runs, and whether the environment is ready
npm run verify -- down                # stop both servers and remove the fixture services
```

`npm run verify` with no command prints every option.

## How to prove a change

1. `up`. The first run starts Docker containers for Postgres, Meilisearch, Redis and the OpenScholar fake (`tests/acceptance/compose.yaml`), adds about 80 varied records, collections and digest editions (`tools/verify/seed.ts`), indexes them, and builds this branch and the main commit it starts from (its merge base with origin/main) for production. Main builds are cached per commit in `~/.cache/new-el-verify` and shared by every worktree. That takes about a minute and a half; later runs rebuild only what changed. After you change code, `up` again: `shift` refuses a build older than the code.
2. Run `shift` on every route your change affects. Add a `--do` step for each interaction you changed: the dialog you made, the filter you added, the view you restyled. Steps are `click`, `hover`, `fill <selector> => <text>`, `press <key>`, `wait <ms>`, `goto <path>`, with Playwright selectors (`text=Save`, `role=button[name="Save"]`, CSS). Both servers share one database, so give `shift` interactions that save nothing; after a flow that saves, `up --fresh` starts the data again.
3. A dialog, sheet, popover or menu whose button is on the page from the first frame can be opened while the page is still loading, before its data is in. Check that too: the same `shift` with `--early` takes the first `--do` step as soon as its target answers clicks. The page behind is still loading then, so only what happens inside the overlay is judged: what pops into it, and what moves in it once it has opened.
4. Fix every problem listed under `Fail`, then `up` and `shift` again.
5. Look at the screenshots it lists. `shift` proves the page holds still, not that it looks right.
6. `down` when you are done, unless the user wants to look at it. Then give them the branch link from `status`; `up --open` opens it in their browser once.

## Reading the result

`shift` loads the page with every fetch delayed by 600 ms, records each animation frame, and reports:

- **layout shift**: an element moved or resized after the page settled, measured within its container: content carried along by a moving container is reported once, as the container. Transforms and opacity never count, so fades and slides are fine, and neither does an element moving through its own CSS transition (a switch's thumb). A frame that slides open over five or more frames in a row, with whatever it pushes along, is an animation too: content may arrive late as long as it animates in. Covering the distance in a frame or two, jumping and then settling, going back and forth, or being pushed by rows that arrive or leave one after another is a shift. An element that draws no background, border or shadow counts only when it moves, never when it resizes: a wrapper growing around new content is seen through the content and the elements it pushes.
- **text disappeared and came back** or **showed for only N ms**: a flash. A number counting up or down in place is fine.
- **element showed for only N ms**: a blink. A placeholder replaced in the same place and size is fine.
- **popped in N ms after its dialog opened**: something arrived inside a dialog, sheet, popover or menu after it had opened, without fading in. It read its data only once it was open. Have the data there when it opens: read it where the trigger is, which is mounted while the overlay is shut, and pass it in. What can only come later, such as search results, fades in or is uncovered by a frame that grows. Judged in the step that opens the overlay, so give `shift` a `--do` step that opens each one you changed. An overlay opened after the page has settled finds its data already read, so one that can be opened sooner needs the `--early` run as well.
- **uncaught error**, a request answering HTTP 500 or more, and **never settled**.

Then it runs the same steps on main, on the same data. A problem fails the run only when main doesn't have it and it shows again on a second run of this branch: a race during loading comes and goes, and is printed as a note instead. The problems main also has are listed as not from this branch: leave them unless the user asked for them, and mention them in your report.

If a step can't run on main (it clicks something your branch adds), everything after it counts as new. If you're sure an element's movement is intended (a panel that expands when clicked), pass `--allow <selector>` and say so in your report.

## Visitors and admins

Each check answers the analytics consent dialog first, as a returning visitor has. `--as editor`, `--as creator` or `--as owner` signs in to the admin as the fake OpenScholar's user for that role, with a session the library's own Better Auth makes (`tests/e2e/admin-login.ts` does the same).

## Files

- `tools/verify/cli.ts` and `tools/verify/stack.ts`: the commands, and the fixture services and servers `up` starts. These are the library's own.
- `tools/verify/analysis.ts`, `recorder.ts`, `browser.ts`, `compare.ts` and `util.ts`: the same files as OpenScholar's `scripts/verify` (OpenDevEd/openalex-count); keep the two in step. `analysis.ts` decides what counts as a problem (tested in `tests/unit/verify.test.ts`); `recorder.ts` runs in the page.
- `tools/verify/seed.ts`: the records `up` adds. `tools/verify/compose.yaml` gives Redis a port.
- `.verify/` (ignored): the stack's ports and config, server logs, run reports and screenshots.
