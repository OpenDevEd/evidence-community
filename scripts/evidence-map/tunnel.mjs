// Read-only access to AIED for building the map: its database on localhost:55446 and its search on localhost:7716.
//
// AIED's search runs in a container that gets a new internal address on every redeploy, so a fixed ssh tunnel goes dead and
// every paper on the map comes back blank. This proxy looks the container up by name, carries each connection over one shared
// ssh connection, and looks it up again whenever a connection is refused.
//
// `node scripts/evidence-map/tunnel.mjs` (stop it with Ctrl-C or by its PID; it closes the shared ssh connection on exit).
import { spawn, execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";

const run = promisify(execFile);
const HOST = "hetzner";
const SOCKET = `/tmp/evidence-ssh-${process.pid}.sock`;
const LIBRARY = "6wcwcpzb2qe7hwwg7x3nu0lq";
const log = (...words) => console.log(new Date().toISOString().slice(11, 19), ...words);

// One shared ssh connection; each proxied connection is a channel on it, so opening one costs no new login.
// If it drops (a network change, the laptop asleep), it is opened again.
let master = null, stopping = false;
const connect = () => {
	master = spawn("ssh", ["-M", "-S", SOCKET, "-N", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2", HOST], { stdio: "inherit" });
	master.on("exit", (code) => { if (stopping) return; log("shared ssh connection ended", code, "- opening it again"); setTimeout(connect, 2000); });
};
connect();
await new Promise((ready) => setTimeout(ready, 2500));

/** The internal address of the library's container whose name starts so, on the library's own network. */
async function addressOf(prefix) {
	const script = `for c in $(sudo -n docker ps --format "{{.Names}}" | grep "^${prefix}"); do sudo -n docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}={{$v.IPAddress}} {{end}}' $c; done`;
	const { stdout } = await run("ssh", ["-S", SOCKET, HOST, script]);
	const address = stdout.match(new RegExp(`(?:^|\\s)${LIBRARY}=(\\S+)`))?.[1];
	if (!address) throw new Error(`no running container named ${prefix}*: ${stdout.trim() || "nothing"}`);
	return address;
}

/** A local port carried to a target; a target given by container name is looked up again when it refuses a connection. */
function forward(port, label, target) {
	// A first guess for a container, for testing the look-up: `EVIDENCE_SEARCH_GUESS=10.0.74.250`.
	let address = target.address ?? (target.container && process.env.EVIDENCE_SEARCH_GUESS) ?? null;
	let looking = null;
	const lookUp = () => (looking ??= addressOf(target.container).then((found) => { if (found !== address) log(label, "now at", found); address = found; return found; }).finally(() => { looking = null; }));
	// A connection's opening bytes are kept until the far side answers, so a request sent to a dead address is sent again.
	const open = async (client, sent, retried = false) => {
		const to = address ?? (await lookUp());
		const channel = spawn("ssh", ["-S", SOCKET, "-W", `${to}:${target.port}`, HOST], { stdio: ["pipe", "pipe", "pipe"] });
		let spoke = false, refused = "";
		for (const chunk of sent) channel.stdin.write(chunk);
		const relay = (chunk) => { if (!spoke) sent.push(chunk); channel.stdin.write(chunk); };
		client.on("data", relay);
		channel.stdout.once("data", () => { spoke = true; sent.length = 0; });
		channel.stdout.on("data", (chunk) => client.write(chunk));
		channel.stderr.on("data", (text) => { refused += text; });
		channel.on("exit", () => {
			client.off("data", relay);
			if (!spoke && target.container && !retried && /refused|failed|No route|timed out/i.test(refused)) {
				address = null;
				log(label, "refused at", to, "- looking it up again");
				lookUp().then(() => open(client, sent, true), (error) => { log(label, String(error)); client.destroy(); });
				return;
			}
			client.end();
		});
		const close = () => channel.kill();
		client.once("close", close);
		client.once("error", close);
		client.once("end", () => channel.stdin.end());
	};
	net.createServer((client) => open(client, []).catch(() => client.destroy())).listen(port, "127.0.0.1", () => log(label, "on localhost:" + port));
}

forward(55446, "database", { address: "10.0.1.11", port: 5432 });
forward(7716, "search", { container: `meilisearch-${LIBRARY}`, port: 7700 });

const stop = () => { stopping = true; spawn("ssh", ["-S", SOCKET, "-O", "exit", HOST], { stdio: "ignore" }); master?.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
