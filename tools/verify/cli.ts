// `npm run verify -- <command>`: start this worktree's library on the
// acceptance fixture services, prove a change in real browsers against a
// build of origin/main on the same data, and stop what it started. The verify
// skill (.agents/skills/verify/SKILL.md) says when to use each command.
//
// analysis, recorder, browser, compare, hook and util are the same files as
// OpenScholar's scripts/verify; this file and stack.ts are the library's own.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { BrowserContext, Page } from "@playwright/test";

import { earlyStep, open, parseStep, type RunOptions } from "./browser";
import { compare, printShots, report, type Comparison } from "./compare";
import { hookStop, offFile } from "./hook";
import { COVER_PATH } from "./seed";
import { buildBranch, buildMain, ensureStack, fingerprint, mainCommit, mainDir, serve, stackRunning, stopStack, type Paths, type Stack } from "./stack";
import { git, readJson, runsNext, withLock, withTimeout, writeJson } from "./util";

const ROOT = git(["rev-parse", "--show-toplevel"], process.cwd());
const COVER_PAGE = readFileSync(path.join(ROOT, "tools/verify/cover.svg"));
const STATE = path.join(ROOT, ".verify");
const PATHS: Paths = { root: ROOT, state: STATE, stackFile: path.join(STATE, "stack.json") };
const LAST_PASS = path.join(STATE, "last-pass.json");
const OFF = path.join(STATE, "off");
// Files a person sees: components, styles and pages, and the .ts modules
// beside components and styles. Route handlers and other .ts files under
// src/app are not.
const USER_FACING = /^src\/((app|components|styles)\/.+\.(tsx|css)|(components|styles)\/.+\.ts)$/;
// Code that holds something that opens over the page: a dialog, popover or menu.
const OVERLAY_CODE = /<\w*(Modal|Popover|Dropdown|Drawer)\w*[\s>]|role="(dialog|alertdialog|menu)"/;
// Elements whose movement is their job: progress bars, Next's dev badge, and
// anything a page marks with data-verify-ignore.
const ALWAYS_ALLOWED = ["[role=progressbar]", "[data-verify-ignore]", "nextjs-portal"];
// The fake OpenScholar's admin users (tests/e2e/admin-login.ts).
const ADMINS: Record<string, string> = { editor: "user_acceptance_admin", creator: "user_acceptance_creator", owner: "user_acceptance_owner" };

type Values = Record<string, string | boolean | string[] | undefined>;

const running = (server: Stack["branch"]) => !!server && runsNext(server.pid, server.port);
// Only one run at a time changes this worktree's servers.
const locked = <T>(run: () => Promise<T>) => withLock(path.join(STATE, "lock"), "this worktree's other verify run", run);

async function serveMain(stack: Stack) {
	const sha = mainCommit(PATHS);
	await serve(PATHS, stack, "main", { cwd: mainDir(sha), built: sha, build: () => buildMain(PATHS, sha).then(() => undefined) });
}

async function up(values: Values) {
	mkdirSync(STATE, { recursive: true });
	const stack = await ensureStack(PATHS, values.fresh === true);
	const built = fingerprint(ROOT);
	await serve(PATHS, stack, "branch", { cwd: ROOT, built, build: () => buildBranch(PATHS, built) });
	if (values.base !== "none") await serveMain(stack);
	console.log(`Branch: ${stack.branch!.url}`);
	if (stack.main) console.log(`main (${stack.main.built.slice(0, 8)}, where this branch starts): ${stack.main.url}`);
	if (values.open) openOnce(stack);
}

function openOnce(stack: Stack) {
	if (stack.opened) return;
	execFileSync("open", [`${stack.branch!.url}/lib`]);
	writeJson(PATHS.stackFile, { ...stack, opened: true });
	console.log("Opened it in the default browser. Later messages end with the link instead of opening it again.");
}

async function down() {
	const stack = readJson<Stack>(PATHS.stackFile);
	if (!stack) return console.log("Nothing is running from this worktree.");
	if (await stopStack(PATHS, stack)) return console.log("Stopped the servers and removed the fixture services.");
	console.log(`Kept ${PATHS.stackFile} so \`down\` can try again.`);
	process.exitCode = 1;
}

function describeServer(name: string, server: Stack["branch"], stale: boolean) {
	if (!running(server)) return `${name}: not running`;
	return `${name}: ${server!.url}${stale ? " (older than your changes)" : ""}`;
}

function environmentProblems(): string[] {
	try {
		execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "ignore" });
		return [];
	} catch {
		return ["Docker is not running."];
	}
}

async function browserProblems(): Promise<string[]> {
	const { chromium, firefox } = await import("@playwright/test");
	return [chromium, firefox].filter((browser) => !existsSync(browser.executablePath())).map((browser) => `Playwright's ${browser.name()} is not installed. Run \`npx playwright install ${browser.name()}\`.`);
}

function printStack(stack: Stack) {
	console.log(`Fixture services: ${stackRunning(PATHS, stack) ? "running" : "not running"} (${stack.project})`);
	console.log(describeServer("Branch", stack.branch, stack.branch?.built !== fingerprint(ROOT)));
	console.log(describeServer("main", stack.main, false));
}

async function status() {
	const stack = readJson<Stack>(PATHS.stackFile);
	if (stack) printStack(stack);
	else console.log("Nothing is running. Start it with `npm run verify -- up`.");
	const problems = [...environmentProblems(), ...(await browserProblems())];
	console.log(problems.length === 0 ? "Environment: ready." : problems.map((problem) => `Problem: ${problem}`).join("\n"));
	if (problems.length > 0) process.exitCode = 1;
}

/**
 * Answers the analytics consent dialog the way a returning visitor already
 * has, so it doesn't cover the page being checked (tests/e2e/consent.ts).
 */
async function answerConsent(page: Page, origin: string) {
	await withTimeout(open(page, `${origin}/lib`), 90_000, `Opening ${origin}/lib`);
	const decline = page.getByRole("dialog").getByRole("button", { name: "Decline", exact: true });
	await decline.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
	if (!(await decline.isVisible())) return;
	await decline.click();
	await page.getByRole("dialog").waitFor({ state: "detached", timeout: 10_000 }).catch(() => undefined);
}

/** A real library session for one of the fake OpenScholar's admin users, made the way tests/e2e/admin-login.ts makes it. */
async function adminCookies(stack: Stack, role: string) {
	const clerkUserId = ADMINS[role];
	if (!clerkUserId) throw new Error(`--as takes one of: ${Object.keys(ADMINS).join(", ")}.`);
	const config = JSON.parse(readFileSync(stack.config, "utf8"));
	const { mintReaderSessionCookies } = await import("../readerTestSession");
	const target = { databaseUrl: config.services.database.url, secret: config.authentication.secret, libraryBaseUrl: config.identity.baseUrl };
	const { cookies } = await mintReaderSessionCookies(target, clerkUserId, { name: `Verify ${role}`, cookieDomain: "localhost" });
	return cookies.map((cookie) => ({ ...cookie, sameSite: cookie.sameSite ?? ("Lax" as const) }));
}

async function prepareFor(stack: Stack, role: string | undefined): Promise<RunOptions["prepare"]> {
	const cookies = role ? await adminCookies(stack, role) : [];
	return async (context: BrowserContext, page: Page, origin: string) => {
		await context.addCookies(cookies);
		// The seeded PDFs' first pages (seed.ts). Served from here, they come as late as the page's data.
		await context.route(`**${COVER_PATH}**`, (route) => route.fulfill({ contentType: "image/svg+xml", body: COVER_PAGE }));
		await answerConsent(page, origin);
	};
}

function runningStack(): Stack {
	const stack = readJson<Stack>(PATHS.stackFile);
	if (!stack || !running(stack.branch)) throw new Error("Nothing is running from this worktree. Start it with `npm run verify -- up`.");
	return stack;
}

function liveStack(target: string): Stack {
	const stack = runningStack();
	if (stack.branch!.built !== fingerprint(ROOT)) throw new Error("The running build is older than your changes. Run `npm run verify -- up` again, then check.");
	if (!target.startsWith("/")) throw new Error("Give a path that starts with /, such as /lib.");
	return stack;
}

/** The server running the main commit this branch starts from. */
function mainServer(stack: Stack): string {
	if (!running(stack.main)) throw new Error("The main build isn't running. Run `npm run verify -- up` (or pass --base none).");
	if (stack.main!.built !== mainCommit(PATHS, false)) throw new Error("This branch now starts from a different main commit. Run `npm run verify -- up` to build it, then check.");
	return stack.main!.url;
}

/** The server to compare with: origin/main for shift, none for shot or --base none. */
const baseFor = (stack: Stack, values: Values, mode: string) => (mode === "shift" && values.base !== "none" ? mainServer(stack) : null);

const number = (value: unknown, fallback: number) => Number(value ?? fallback);
const list = (value: unknown) => (value as string[] | undefined) ?? [];

async function optionsFor(stack: Stack, values: Values, mode: string): Promise<RunOptions> {
	const shift = mode === "shift";
	const steps = list(values.do).map(parseStep);
	if (values.early === true) earlyStep(steps);
	return {
		steps,
		early: values.early === true,
		slow: number(values.slow, shift ? 600 : 0),
		quietMs: number(values.quiet, 1_500),
		viewport: { width: number(values.width, 1440), height: number(values.height, 900) },
		allow: [...ALWAYS_ALLOWED, ...list(values.allow)].flatMap((selector) => [selector, `${selector} *`]).join(", "),
		full: values.full === true,
		analyze: shift,
		prepare: await prepareFor(stack, values.as as string | undefined),
	};
}

const DEFAULT_BROWSERS = { shift: "chromium,firefox", shot: "chromium" };

async function comparisonFor(target: string, values: Values, mode: "shift" | "shot"): Promise<Comparison> {
	const stack = liveStack(target);
	return {
		local: stack.branch!.url,
		base: baseFor(stack, values, mode),
		baseName: `main (${stack.main?.built.slice(0, 8)})`,
		target,
		browsers: String(values.browser ?? DEFAULT_BROWSERS[mode]).split(","),
		options: await optionsFor(stack, values, mode),
		runsDir: path.join(STATE, "runs"),
	};
}

function recordPass(comparison: Comparison, built: string, opened: number) {
	// Code changed during the check isn't in the build it checked.
	if (fingerprint(ROOT) !== built) return console.log("The code changed during the check, so no pass is recorded. Run `npm run verify -- up`, then check again.");
	const steps = comparison.options.steps.map((step) => step.label);
	writeJson(LAST_PASS, { at: Date.now(), head: git(["rev-parse", "HEAD"], ROOT), target: comparison.target, steps, browsers: comparison.browsers, opened });
	rmSync(OFF, { recursive: true, force: true });
}

async function drive(target: string, values: Values, mode: "shift" | "shot") {
	const built = fingerprint(ROOT);
	const comparison = await comparisonFor(target, values, mode);
	const outcome = await compare(comparison);
	if (mode === "shot") return printShots(outcome.shots);
	if (report(comparison, outcome)) recordPass(comparison, built, outcome.opened);
	else process.exitCode = 1;
}

function skip(reason: string) {
	if (!reason.trim()) throw new Error('Say why: npm run verify -- skip "<reason>".');
	writeJson(LAST_PASS, { at: Date.now(), head: git(["rev-parse", "HEAD"], ROOT), skipped: reason });
	console.log(`Recorded: ${reason}`);
}

/** The user said not to verify: the stop hook stays quiet in this session (Claude Code names it) until a check passes. */
function off(words: string) {
	if (!words.trim()) throw new Error("Give the user's words: npm run verify -- off \"<their words>\".");
	const session = process.env.CLAUDE_CODE_SESSION_ID ?? null;
	writeJson(offFile(OFF, session), { at: Date.now(), session, words });
	console.log(`Recorded: the stop hook stays quiet for the rest of this session. ${words}`);
}

const HELP = `Usage: npm run verify -- <command>

  up [--open] [--fresh]    Start the acceptance fixture services with the verify records, and serve
                           production builds of this branch and of the main commit it starts from on
                           them, each on its own port. Rebuilds what changed. --fresh starts the data
                           again; --open opens the branch in the default browser once; --base none
                           skips main.
  down                     Stop both servers and remove the fixture services.
  status                   Show what runs and check the environment.
  shift <path> [options]   Load <path> in Chromium and Firefox with data slowed by 600ms, then do the
                           same on main, and fail on any layout shift, flash or page error that main
                           doesn't have and that shows again on a second run. Writes screenshots.
  shot <path> [options]    Screenshots only (Chromium, no slowdown).
  skip "<reason>"          Record why this change needs no browser check.
  off "<the user's words>" The user said not to verify: the stop hook stays quiet for the rest of
                           this session, until a shift passes again.

Options for shift and shot:
  --do "<step>"            Repeat for each action: click <selector>, hover <selector>,
                           fill <selector> => <text>, press <key>, wait <ms>, goto <path>.
                           Selectors are Playwright selectors: css, text=..., role=button[name="Save"].
                           Steps run on both servers, which share one database: keep them to
                           interactions that save nothing, or run \`up --fresh\` afterwards.
  --as <role>              Sign in to the admin as editor, creator or owner (the fake OpenScholar's users).
  --browser <list>         chromium,firefox (shift default) or one of them.
  --slow <ms>              Delay for every fetch and picture (shift default 600, 0 to turn off).
  --allow <selector>       An element whose movement is intended, such as an expanding panel.
  --width <px> --height <px>  Viewport, default 1440x900. Use 390 x 844 for a phone.
  --full                   Full-page screenshots.
  --quiet <ms>             How long the page must hold still to count as settled (default 1500).
  --base none              Don't compare with main.
  --early                  Take the first --do step as soon as its target answers clicks, before the
                           page's data has arrived, and judge only what happens in the dialog, sheet,
                           popover or menu it opens. For anything a person can open while the page loads.`;

const COMMANDS: Record<string, (values: Values, rest: string[]) => unknown> = {
	up: (values) => locked(() => up(values)),
	down: () => locked(() => down()),
	status: () => status(),
	shift: (values, rest) => drive(rest[0] ?? "", values, "shift"),
	shot: (values, rest) => drive(rest[0] ?? "", values, "shot"),
	skip: (_, rest) => skip(rest.join(" ")),
	off: (_, rest) => off(rest.join(" ")),
	hook: (_, rest) => rest[0] === "stop" && hookStop({ root: ROOT, baseBranch: "origin/main", userFacing: USER_FACING, overlay: OVERLAY_CODE, lastPassFile: LAST_PASS, offDir: OFF, start: "npm run verify -- up" }),
};

const OPTIONS = {
	open: { type: "boolean" },
	fresh: { type: "boolean" },
	do: { type: "string", multiple: true },
	browser: { type: "string" },
	slow: { type: "string" },
	allow: { type: "string", multiple: true },
	width: { type: "string" },
	height: { type: "string" },
	as: { type: "string" },
	full: { type: "boolean" },
	quiet: { type: "string" },
	base: { type: "string" },
	early: { type: "boolean" },
} as const;

async function main() {
	const { values, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS });
	const [command, ...rest] = positionals;
	const run = COMMANDS[command ?? ""];
	if (run) return run(values, rest);
	console.log(HELP);
	process.exitCode = command ? 1 : 0;
}

main().catch((error: Error) => {
	console.error(error.message);
	process.exitCode = 1;
});
