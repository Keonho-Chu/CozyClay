#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	installSignalCleanup,
	spawnOwned,
	startBridge,
	terminateOwned,
	waitForExit,
} from "./process-supervisor.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const viteArgs = [...process.argv.slice(2), "--strictPort"];

function mainPortFrom(args) {
	let port = 5180;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--port" || args[index] === "-p") port = Number(args[++index]);
		else if (args[index].startsWith("--port=")) port = Number(args[index].slice("--port=".length));
	}
	if (!Number.isInteger(port) || port < 1 || port >= 65535) {
		throw new Error(`the Vite --port must be an integer in 1..65534 (got ${JSON.stringify(port)})`);
	}
	return port;
}

const livePort = process.env.COZYCLAY_LIVE_PORT ?? "5184";
const children = [];
const removeSignalCleanup = installSignalCleanup(() => children);
const trackChild = (child) => children.push(child);
const untrackChild = (child) => children.splice(children.indexOf(child), 1);
// The bridge's only backend is Kimodo, and that runner refuses to start
// without a box to talk to. Starting it unconditionally turned a fresh
// clone's first `npm run dev` into a hard exit over a variable a new
// contributor has no reason to have set yet. An unset CCLAY_KIMODO_HOST is
// the normal case, not a fault — `npx cozyclay` has always treated it that
// way, and the studio itself already renders the sidecar as absent rather
// than crashing, which is exactly what `npm run dev:ui` is.
const kimodoHost = process.env.CCLAY_KIMODO_HOST?.trim();
let bridge;
let bridgePort;
if (kimodoHost) {
	try {
		({ child: bridge, port: bridgePort } = await startBridge({
			command: process.execPath,
			args: ["tools/ardy/bridge.mjs"],
			cwd: REPO,
			env: process.env,
			mainPort: mainPortFrom(viteArgs),
			onSpawn: trackChild,
			onFailure: untrackChild,
		}));
	} catch (err) {
		console.error(`[dev] Studio did not start: ${err.message}`);
		removeSignalCleanup();
		await Promise.allSettled(children.map((child) => terminateOwned(child)));
		process.exit(1);
	}
} else {
	console.error(
		"[dev] CCLAY_KIMODO_HOST is not set — starting the studio without motion generation (set CCLAY_KIMODO_HOST=user@gpu-box to enable Block Generation).",
	);
}

const vite = spawnOwned(process.execPath, ["node_modules/vite/bin/vite.js", ...viteArgs], {
	cwd: REPO,
		env: {
			...process.env,
			// Left as it came in when no bridge runs: Vite's /ardy proxy then
			// falls back the same way `dev:ui` does, and the probe fails
			// gracefully instead of pointing at a port nothing owns.
			...(bridgePort === undefined ? {} : { COZYCLAY_BRIDGE_PORT: String(bridgePort) }),
			COZYCLAY_LIVE_PORT: livePort,
		},
});
children.push(vite);

const first = await Promise.race(
	children.map(async (child) => ({ child, ...(await waitForExit(child)) })),
);

removeSignalCleanup();
await Promise.allSettled(
	children.filter((child) => child !== first.child).map((child) => terminateOwned(child)),
);
if (process.exitCode == null) {
	process.exitCode = first.code ?? (first.signal ? 1 : 0);
}
