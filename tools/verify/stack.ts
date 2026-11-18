// The Evidence Library's side of `npm run verify -- up`: the acceptance
// fixture services with the verify records in them, and production builds of
// this branch and of origin/main served on them from this machine.

import { execFileSync, spawn, type StdioOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { cacheFonts } from "./browser";
import { seedSql } from "./seed";
import { git, listening, members, readJson, runsNext, sleep, stopGroup, withLock, writeJson } from "./util";

const COMPOSE_FILES = ["tests/acceptance/compose.yaml", "tools/verify/compose.yaml"];
const SERVICES = ["postgres", "amber-meilisearch", "redis", "fixture", "runtime-provider-fake"];
// Builds of origin/main, one per commit and never changed once built, shared
// by every worktree of this repository.
const MAIN_CACHE = path.join(homedir(), ".cache", "new-el-verify");
export const mainDir = (sha: string) => path.join(MAIN_CACHE, `main-${sha.slice(0, 12)}`);
// The acceptance library's OpenScholar identity (tools/runRuntimeAcceptance.ts); the fake knows these.
const AMBER = {
	libraryId: "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5",
	machineCredential: "els_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	secret: "amber-acceptance-auth-secret-0000000000000000",
};
const INDIGO = { libraryId: "kg2k5yaf2g58kz9kw7h3k2j3v6zq5h4p", machineCredential: "els_ccccccccccccccccccccccccccccccccccccccccccc" };
// Files that never reach the built app; `next dev` itself rewrites AGENTS.md.
const NOT_BUILT = [":!*.md", ":!docs", ":!plans", ":!tests", ":!tools", ":!ops", ":!design-prototypes", ":!.agents", ":!.claude", ":!.github"];

type Ports = { postgres: number; meilisearch: number; fixture: number; appHttps: number; fake: number; redis: number; branch: number; main: number };
export type Server = { pid: number; port: number; url: string; log: string; built: string; cwd: string };
export type Stack = { project: string; ports: Ports; config: string; ca: string; ready?: boolean; branch?: Server; main?: Server; opened?: boolean };
export type Paths = { root: string; state: string; stackFile: string };

/** What the working tree holds that a production build bakes in: the commit, uncommitted changes and untracked files. */
export function fingerprint(root: string): string {
	const hash = createHash("sha1").update(git(["rev-parse", "HEAD"], root));
	hash.update(execFileSync("git", ["diff", "HEAD", "--", ".", ...NOT_BUILT], { cwd: root }));
	for (const name of git(["ls-files", "--others", "--exclude-standard", "--", ".", ...NOT_BUILT], root).split("\n").filter(Boolean).sort()) {
		hash.update(name);
		if (existsSync(path.join(root, name))) hash.update(readFileSync(path.join(root, name)));
	}
	return hash.digest("hex");
}

type RunOptions = { cwd: string; env?: NodeJS.ProcessEnv; input?: string; log?: string };

/** Where a command's output goes: its log file when it has one, so a long build doesn't fill memory. */
function outputTo(log: string | undefined): StdioOptions {
	if (!log) return "pipe";
	return ["pipe", openSync(log, "a"), openSync(log, "a")];
}

/** The end of a failed command's output, or a pointer to its log. */
function failure(command: string, args: string[], error: unknown, log: string | undefined): Error {
	const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
	const tail = `${stdout}${stderr}`.trim().split("\n").slice(-15).join("\n");
	const where = log ? `; see ${log}` : `:\n${tail}`;
	return new Error(`${command} ${args.join(" ")} failed${where}`);
}

/** Runs a command and fails with the end of its output, or with a pointer to its log. */
function run(command: string, args: string[], options: RunOptions) {
	try {
		return execFileSync(command, args, { cwd: options.cwd, env: options.env, input: options.input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: outputTo(options.log) });
	} catch (error) {
		throw failure(command, args, error, options.log);
	}
}

/** What `docker compose` needs to read the acceptance file, with this worktree's ports. */
function composeEnvironment(paths: Paths, ports: Ports): NodeJS.ProcessEnv {
	return {
		...process.env,
		// Persistent, so the acceptance runner's clean-up of abandoned stacks leaves this one alone.
		EVIDENCE_LIBRARY_ACCEPTANCE_OWNER_PID: String(process.pid),
		EVIDENCE_LIBRARY_ACCEPTANCE_PERSISTENT: "true",
		EVIDENCE_LIBRARY_ACCEPTANCE_OPENSCHOLAR_AMBER_LIBRARY_ID: AMBER.libraryId,
		EVIDENCE_LIBRARY_ACCEPTANCE_OPENSCHOLAR_AMBER_MACHINE_CREDENTIAL: AMBER.machineCredential,
		EVIDENCE_LIBRARY_ACCEPTANCE_OPENSCHOLAR_INDIGO_LIBRARY_ID: INDIGO.libraryId,
		EVIDENCE_LIBRARY_ACCEPTANCE_OPENSCHOLAR_INDIGO_MACHINE_CREDENTIAL: INDIGO.machineCredential,
		EVIDENCE_LIBRARY_ACCEPTANCE_RUNTIME_DIR: path.join(paths.state, "runtime"),
		EVIDENCE_LIBRARY_ACCEPTANCE_POSTGRES_PORT: String(ports.postgres),
		EVIDENCE_LIBRARY_ACCEPTANCE_AMBER_MEILI_PORT: String(ports.meilisearch),
		EVIDENCE_LIBRARY_ACCEPTANCE_FIXTURE_PORT: String(ports.fixture),
		EVIDENCE_LIBRARY_ACCEPTANCE_APP_HTTPS_PORT: String(ports.appHttps),
		EVIDENCE_LIBRARY_ACCEPTANCE_RUNTIME_PROVIDER_FAKE_PORT: String(ports.fake),
		VERIFY_REDIS_PORT: String(ports.redis),
	};
}

function compose(paths: Paths, stack: Pick<Stack, "project" | "ports">, args: string[], input?: string) {
	const files = COMPOSE_FILES.flatMap((file) => ["--file", file]);
	return run("docker", ["compose", "--project-name", stack.project, ...files, ...args], { cwd: paths.root, env: composeEnvironment(paths, stack.ports), input });
}

const hashOf = (root: string) => Number.parseInt(createHash("sha1").update(root).digest("hex").slice(0, 6), 16);

function portBlock(base: number): Ports {
	return { postgres: base, meilisearch: base + 1, fixture: base + 2, appHttps: base + 3, fake: base + 4, redis: base + 5, branch: base + 6, main: base + 7 };
}

/** Ports that stay the same for a worktree, so links keep working between runs. */
async function pickPorts(root: string): Promise<Ports> {
	for (let attempt = 0; attempt < 20; attempt++) {
		const ports = portBlock(31_000 + ((hashOf(root) + attempt) % 400) * 10);
		const busy = await Promise.all(Object.values(ports).map(listening));
		if (!busy.includes(true)) return ports;
	}
	throw new Error("No free block of ports between 31000 and 35000.");
}

/** Whether every data service of this stack is running. */
export function stackRunning(paths: Paths, stack: Stack): boolean {
	try {
		const running = compose(paths, stack, ["ps", "--status", "running", "--format", "{{.Service}}"]).split("\n");
		return SERVICES.every((service) => running.includes(service));
	} catch {
		return false;
	}
}

/** The acceptance Amber config, pointed at this machine's ports instead of the Docker network. */
function writeConfig(paths: Paths, stack: Stack) {
	const config = JSON.parse(readFileSync(path.join(paths.root, "tests/acceptance/configs/amber.json"), "utf8"));
	const { ports } = stack;
	const convex = `https://openscholar-convex.localhost:${ports.fixture}`;
	config.analytics.posthog.host = `https://collector.localhost:${ports.fixture}`;
	config.authentication = {
		...config.authentication,
		openScholar: {
			convexSiteUrl: convex,
			libraryId: AMBER.libraryId,
			libraryUrl: `https://openscholar.localhost:${ports.fixture}/evidence-libraries/amber`,
			accountUrl: `https://openscholar.localhost:${ports.fixture}/user`,
			machineCredential: AMBER.machineCredential,
			oauth: { issuer: convex, clientId: `evidence-library-${AMBER.libraryId}`, clientSecret: "amber-acceptance-oauth-client-secret" },
		},
		secret: AMBER.secret,
	};
	Object.assign(config.services.database, { url: `postgresql://library:library@127.0.0.1:${ports.postgres}/amber` });
	Object.assign(config.services.search.meilisearch!, { host: `http://127.0.0.1:${ports.meilisearch}` });
	Object.assign(config.services.redis, { url: `redis://127.0.0.1:${ports.redis}` });
	Object.assign(config.services.storage, { url: `http://127.0.0.1:${ports.fake}` });
	Object.assign(config.services.zotero, { translationUrl: `http://127.0.0.1:${ports.fake}` });
	for (const map of config.gapMaps ?? []) map.sourceUrl = String(map.sourceUrl).replace("https://fixture/", `https://localhost:${ports.fixture}/`);
	writeJson(stack.config, config);
}

const libraryEnvironment = (stack: Stack): NodeJS.ProcessEnv => ({ ...process.env, LIBRARY_CONFIG_PATH: stack.config, NODE_EXTRA_CA_CERTS: stack.ca });

async function createStack(paths: Paths): Promise<Stack> {
	const runtime = path.join(paths.state, "runtime");
	const stack: Stack = { project: `el-verify-${hashOf(paths.root).toString(16)}`, ports: await pickPorts(paths.root), config: path.join(runtime, "library.json"), ca: path.join(runtime, "root.crt") };
	mkdirSync(runtime, { recursive: true });
	writeJson(paths.stackFile, stack);
	try {
		initialize(paths, stack);
	} catch (error) {
		// A stack that stopped halfway has missing records or config; start again next time.
		await stopStack(paths, stack);
		throw error;
	}
	stack.ready = true;
	writeJson(paths.stackFile, stack);
	return stack;
}

function initialize(paths: Paths, stack: Stack) {
	console.log("Starting the fixture services (Postgres, Meilisearch, Redis, the OpenScholar fake)...");
	compose(paths, stack, ["up", "--detach", "--wait", "--wait-timeout", "180", ...SERVICES]);
	console.log("Adding the verify records...");
	compose(paths, stack, ["exec", "-T", "postgres", "psql", "--set", "ON_ERROR_STOP=1", "--quiet", "--username", "library", "--dbname", "amber"], seedSql());
	compose(paths, stack, ["cp", "fixture:/data/caddy/pki/authorities/local/root.crt", stack.ca]);
	writeConfig(paths, stack);
	console.log("Indexing them for search...");
	run("npx", ["tsx", "tools/runSearchIndexer.ts"], { cwd: paths.root, env: libraryEnvironment(stack), log: path.join(paths.state, "indexer.log") });
}

/** Whether a stack finished setting up and still runs. */
const usable = (paths: Paths, stack: Stack) => stack.ready === true && stackRunning(paths, stack);

/** The fixture services with the verify records in them, started once and kept until `down`. */
export async function ensureStack(paths: Paths, fresh: boolean): Promise<Stack> {
	const existing = readJson<Stack>(paths.stackFile);
	if (!existing) return createStack(paths);
	if (!fresh && usable(paths, existing)) return existing;
	await stopStack(paths, existing);
	return createStack(paths);
}

async function stopServer(server: Server | undefined, name: string): Promise<boolean> {
	if (!server || !runsNext(server.pid, server.port) || (await stopGroup(server.pid))) return true;
	console.log(`The ${name} server (process group ${server.pid}) is still running.`);
	return false;
}

/** Stops both servers and removes the fixture services. Keeps the stack file when a server wouldn't stop, so `down` can try again. */
export async function stopStack(paths: Paths, stack: Stack): Promise<boolean> {
	const stopped = (await stopServer(stack.branch, "branch")) && (await stopServer(stack.main, "origin/main"));
	compose(paths, stack, ["down", "--volumes", "--remove-orphans"]);
	if (!stopped) return false;
	rmSync(paths.stackFile, { force: true });
	rmSync(path.join(paths.state, "runtime"), { recursive: true, force: true });
	return true;
}

async function answers(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
		return response.status < 500;
	} catch {
		return false;
	}
}

/** Starts `next start` from a built checkout, in its own process group. */
function spawnServer(stack: Stack, cwd: string, port: number, log: string, built: string): Server {
	const out = openSync(log, "a");
	const child = spawn("npx", ["next", "start", "-p", String(port)], { cwd, env: libraryEnvironment(stack), detached: true, stdio: ["ignore", out, out] });
	child.unref();
	return { pid: child.pid!, port, url: `http://localhost:${port}`, log, built, cwd };
}

/** Waits until the server answers; fails if it exits or takes longer than two minutes. */
async function ready(server: Server) {
	for (const deadline = Date.now() + 120_000; !(await answers(`${server.url}/lib`)); await sleep(1_000)) {
		// Just started here, so any process left in its group is the server.
		if (members(server.pid).length === 0) throw new Error(`The server in ${server.cwd} exited. See ${server.log}.`);
		if (Date.now() > deadline) throw new Error(`The server in ${server.cwd} did not answer within 2 minutes. See ${server.log}.`);
	}
}

/**
 * Loads a page once in each browser, so the first check's data calls don't
 * find a cold server (they would arrive later, and group differently, than on
 * the server it is compared with) and its web fonts are already cached.
 */
async function warm(url: string) {
	const playwright = await import("@playwright/test");
	for (const type of [playwright.chromium, playwright.firefox]) {
		const browser = await type.launch();
		try {
			const context = await browser.newContext();
			await cacheFonts(context, type.name());
			const page = await context.newPage();
			await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => undefined);
		} finally {
			await browser.close();
		}
	}
}

/** Whether a server is still the build it was started for, and answering. */
async function current(server: Server | undefined, built: string, port: number): Promise<boolean> {
	return !!server && server.built === built && runsNext(server.pid, port) && (await listening(port));
}

/** Starts a server and records it at once, so `down` can stop it even if it never answers; stops it if it doesn't. */
async function start(paths: Paths, stack: Stack, slot: "branch" | "main", cwd: string, built: string) {
	// Something else answering on the port would pass for the new server.
	if (await listening(stack.ports[slot])) throw new Error(`Port ${stack.ports[slot]} is in use by another process. Stop it, or run \`npm run verify -- down\` and \`up\` again for new ports.`);
	const server = spawnServer(stack, cwd, stack.ports[slot], path.join(paths.state, `${slot}.log`), built);
	stack[slot] = server;
	writeJson(paths.stackFile, stack);
	try {
		await ready(server);
	} catch (error) {
		await stopGroup(server.pid);
		delete stack[slot];
		writeJson(paths.stackFile, stack);
		throw error;
	}
}

/** Serves `cwd`'s build on its port as `slot`, replacing an older one, and warms it. */
export async function serve(paths: Paths, stack: Stack, slot: "branch" | "main", options: { cwd: string; built: string; build: () => void | Promise<void> }) {
	if (await current(stack[slot], options.built, stack.ports[slot])) return;
	await stopServer(stack[slot], slot);
	await options.build();
	await start(paths, stack, slot, options.cwd, options.built);
	await warm(`${stack[slot]!.url}/lib`);
}

const buildId = (dir: string) => {
	try {
		return readFileSync(path.join(dir, ".next", "BUILD_ID"), "utf8");
	} catch {
		return null;
	}
};

/** A production build of this worktree, skipped when `.next` still holds the one made from the same code. */
export function buildBranch(paths: Paths, built: string) {
	const marker = path.join(paths.state, "branch-built.json");
	const last = readJson<{ built: string; buildId: string }>(marker);
	if (last?.built === built && last.buildId === buildId(paths.root)) return;
	console.log("Building this branch for production...");
	run("npm", ["run", "build"], { cwd: paths.root, log: path.join(paths.state, "branch-build.log") });
	writeJson(marker, { built, buildId: buildId(paths.root) });
}

/**
 * The main commit this branch starts from (its merge base with origin/main,
 * fetched now). Comparing with a newer main would count main's own later
 * changes as this branch's.
 */
export function mainCommit(paths: Paths, fetch = true): string {
	if (fetch) run("git", ["fetch", "--quiet", "origin", "main"], { cwd: paths.root });
	return git(["merge-base", "HEAD", "origin/main"], paths.root);
}

function createMain(paths: Paths, dir: string, sha: string) {
	const log = path.join(paths.state, "main-build.log");
	if (!existsSync(dir)) run("git", ["worktree", "add", "--detach", dir, sha], { cwd: paths.root });
	console.log(`Installing and building origin/main (${sha.slice(0, 8)}) for comparison...`);
	run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: dir, log });
	run("npm", ["run", "build"], { cwd: dir, log });
	writeJson(path.join(dir, ".verify-built"), { sha });
}

/** The main builds a live server of any worktree of this repository runs from. */
function mainsInUse(paths: Paths): Set<string> {
	const worktrees = git(["worktree", "list", "--porcelain"], paths.root).split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice(9));
	const servers = worktrees.map((root) => readJson<Stack>(path.join(root, ".verify", "stack.json"))?.main);
	return new Set(servers.filter((server): server is Server => !!server && runsNext(server.pid, server.port)).map((server) => server.cwd));
}

/**
 * Removes all but the three newest main builds, keeping any a live server runs from. The cache is shared by every
 * checkout of the repository, so only this checkout's own worktrees are removed: another clone's build (one made from
 * new-el-optimize) isn't a worktree here, and removing it failed and stopped `up`.
 */
function pruneMains(paths: Paths, keep: string) {
	const used = mainsInUse(paths).add(keep);
	const own = new Set(git(["worktree", "list", "--porcelain"], paths.root).split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice(9)));
	const builds = readdirSync(MAIN_CACHE).filter((name) => name.startsWith("main-")).map((name) => path.join(MAIN_CACHE, name));
	const newest = builds.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	for (const old of newest.slice(3).filter((dir) => !used.has(dir) && own.has(dir))) run("git", ["worktree", "remove", "--force", old], { cwd: paths.root });
}

/** A production build of origin/main at `sha` in the shared cache, made once under a lock and never changed after. Returns its folder. */
export async function buildMain(paths: Paths, sha: string): Promise<string> {
	const dir = mainDir(sha);
	await withLock(`${dir}.lock`, `the origin/main build at ${sha.slice(0, 8)}`, async () => {
		if (readJson<{ sha: string }>(path.join(dir, ".verify-built"))?.sha !== sha) createMain(paths, dir, sha);
	});
	pruneMains(paths, dir);
	return dir;
}
