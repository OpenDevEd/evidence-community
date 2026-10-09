// Small helpers `npm run verify` shares. OpenScholar and the Evidence Library
// run the same file; keep them in step.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

export function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function readJson<T>(file: string): T | null {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as T;
	} catch {
		return null;
	}
}

export function writeJson(file: string, value: unknown) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The commands of the processes in a process group: the npx launcher a server was started with and the server under it. */
export function members(group: number): string[] {
	const table = execFileSync("ps", ["-ax", "-o", "pgid=,command="], { encoding: "utf8" });
	return table.split("\n").flatMap((line) => {
		const match = line.trim().match(/^(\d+)\s+(.*)$/);
		return match && Number(match[1]) === group ? [match[2]] : [];
	});
}

/**
 * Whether a process group still runs the Next.js server it was recorded for.
 * A pid can be reused after a crash or a reboot, so a group that no longer
 * runs Next.js is never signalled.
 */
export const runsNext = (group: number) => members(group).some((command) => /\bnext\b/.test(command));

export function listening(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = net.connect(port, "127.0.0.1");
		socket.once("connect", () => (socket.destroy(), resolve(true)));
		socket.once("error", () => resolve(false));
	});
}

async function signalGroup(group: number, signal: NodeJS.Signals): Promise<boolean> {
	try {
		process.kill(-group, signal);
	} catch {
		// The group is already gone.
	}
	for (let waited = 0; waited < 10_000 && members(group).length > 0; waited += 250) await sleep(250);
	return members(group).length === 0;
}

/** Stops a whole process group, so a server whose launcher already exited stops too. Returns whether it is gone. */
export async function stopGroup(group: number): Promise<boolean> {
	return (await signalGroup(group, "SIGTERM")) || (await signalGroup(group, "SIGKILL"));
}

/** Fails with a message instead of waiting forever on a page that stopped answering. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	promise.catch(() => {});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} seconds.`)), ms);
	});
	// A finished check clears its limit, so the process can exit.
	return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** A file-name-safe form of a route or step, for run folders and screenshots. */
export const slug = (text: string) => text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "home";
