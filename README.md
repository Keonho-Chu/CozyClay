<p align="center">
  <img src="docs/images/cozyclay-logo.png" alt="CozyClay" width="340">
</p>

<p align="center">
  <em>Block a scene, pose the cast, cut the camera — in a browser tab.</em>
</p>

<p align="center">
  Created and maintained by <a href="https://github.com/HaD0Yun">Doyun</a> at <a href="https://github.com/NomaDamas">NomaDamas</a>.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <a href="https://www.npmjs.com/package/cozyclay"><img alt="npm" src="https://img.shields.io/npm/v/cozyclay"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-22%2B-brightgreen">
  <a href="https://github.com/NomaDamas/CozyClay/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/NomaDamas/CozyClay?style=flat"></a>
</p>

<p align="center">
  <a href="https://cozyclay.org/">Demo reel</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-you-can-do">Features</a> ·
  <a href="#ai-control-mcp">AI control</a> ·
  <a href="#controls">Controls</a> ·
  <a href="https://github.com/NomaDamas/CozyClay/issues">Issues</a>
</p>

---

CozyClay is a browser-based 3D staging studio built with Three.js and React Three Fiber. Block a scene, pose characters, sequence motion prompts on a timeline, and preview generated motion — all in one local workspace.

```bash
npx cozyclay
```

That is the whole install. **[cozyclay.org](https://cozyclay.org/)** has the demo reel and a walkthrough of what the studio does; to use it, run it on your own machine. It ships seeded with a pre-generated motion clip, so you can scrub the timeline, drive the cameras and draw a dolly rail straight away — generating *new* motion needs a local ARDY machine, so that part stays off until you point it at one.

## Demo

https://github.com/user-attachments/assets/1d0113e5-6922-443d-affc-1bdabc666247

## What you can do

|  | |
| --- | --- |
| **Stage a scene** | Create primitives and set pieces, then move, rotate and scale them with a W/E/R gizmo. Grid snapping is a preference, not a law — hold `Ctrl` mid-drag to invert it. A bird's-eye plan view drives 2D root waypoints for character paths. |
| **Fly the camera** | Right-drag flies (WASD walks, Q/E cranes), middle-drag pans, Alt+drag orbits the selection, click selects, `F` frames — the muscle memory you already have from a 3D editor. |
| **Undo anything** | Every scene mutation goes through one history store: a drag, a scrub, an inspector edit is exactly one undo entry. `Esc` cancels an in-flight drag and restores the pre-drag transform. |
| **Generate motion** | Pose characters and export poses, sequence multi-phase motion as Prompt Blocks on a resizable timeline, send them to ARDY, then play the result back with sparse IK correction where the generated motion needs fixing. |
| **Direct it with an AI** | Connect Claude — or any MCP client — and ask for a shot in plain language. It places the cast, frames “a low wide profile”, generates multi-phase motion, and the viewport moves in front of you. See [AI control](#ai-control-mcp). |

## Requirements

- Node.js 22 or newer
- npm, or bun
- A Chromium-based browser
- *Optional:* an SSH-accessible NVIDIA machine running ARDY, for motion generation — first-time setup downloads a ~16.4 GB text-encoder stack onto that machine; see [`tools/ardy/README.md`](tools/ardy/README.md)

## Quick start

```bash
npx cozyclay
# or
bunx cozyclay
```

That downloads the built studio and opens it at `http://127.0.0.1:5180`. Nothing to compile, no dependency tree to install. Useful flags: `--port 5200`, `--no-open`, `--no-ardy`.

A global install gives you `cclay`, the same command with less typing. Once a day the launcher checks npm for a newer release and prints a one-line notice after the studio is up; it stays quiet when you're current or offline. `cclay update` installs the latest release, and `--no-update-check` skips the check entirely.

Motion generation stays off until you point it at a machine that can run it:

```bash
CCLAY_ARDY_HOST=user@your-gpu-box npx cozyclay
```

Everything else — staging through camera work and playback — runs without it.

## AI control (MCP)

The studio ships an [MCP](https://modelcontextprotocol.io) server, so an AI assistant can drive it — the same scene, the same viewport, live:

> “Put a detective and a courier in an alley, give me a low wide profile shot,
> then make her stand up from the chair, sprint, and trip.”

```json
{
  "mcpServers": {
    "cozyclay": {
      "command": "npx",
      "args": ["-y", "cozyclay", "mcp"]
    }
  }
}
```

Drop that into `claude_desktop_config.json` (or any MCP client config) and restart the client. The
first run automatically installs the MCP SDK's 95-package tree; opening the studio never waits on
it, so those dependencies are fetched only when you actually want the server.

- **Editor open?** Tool calls move the visible viewport — camera, cast, set, generated motion, prompt blocks on the timeline.
- **No editor?** Scene and project tools run headless: block scenes, derive film vocabulary
  (“wide shot · right profile · knee level · 24mm”), render AI video prompts, and write
  `.cclayproject` files. `capture_frame`, `set_prompt_blocks`, `generate_motion`, and
  `apply_batch` require the live editor.

Tools, transports and the live-control protocol are documented in [`mcp/README.md`](mcp/README.md).

### From a clone

```bash
git clone https://github.com/NomaDamas/CozyClay.git
cd CozyClay
npm install
npm run dev
```

Open `http://127.0.0.1:5180`. `npm run dev` starts the studio together with its local ARDY bridge; `npm run dev:ui` starts the browser UI alone, without Block Generation. The bridge listens on loopback only; the environment variables that point it at a remote ARDY machine are documented in [`tools/ardy/BRIDGE.md`](tools/ardy/BRIDGE.md).

<details>
<summary><b>Token-free ARDY text encoder</b> — skip the Hugging Face gate</summary>

ARDY's text encoder normally requires a Hugging Face account, gated-model approval, and an access token on the ARDY machine. CozyClay ships a token-free alternative — one command provisions the same encoder stack from public repositories, pinned by commit and SHA-256:

```bash
CCLAY_ARDY_HOST=user@your-gpu-box tools/ardy/setup-text-encoder-on-box.sh
```

See [`tools/ardy/README.md`](tools/ardy/README.md) for details. This workflow is built with Meta Llama 3; the encoder's base weights are licensed under the Meta Llama 3 Community License.

</details>

## Controls

| Input | Action |
| --- | --- |
| Right-drag | Look around (fly) |
| RMB + WASD | Walk while flying |
| RMB + Q/E | Crane down / up |
| RMB + Shift | Boost fly speed 2.6× |
| Middle-drag | Pan |
| Alt + drag | Orbit the selection |
| Scroll | Dolly; while flying, sets the fly speed instead |
| Click | Select; empty space clears |
| W / E / R | Move / rotate / scale tool |
| Ctrl/Cmd (during drag) | Invert grid snapping |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Undo / redo |
| Esc | Cancel the in-flight drag |
| End | Drop the selection to the surface |
| Ctrl/Cmd+D | Duplicate the selection |
| Delete / Backspace | Delete the selection |
| F | Frame the selection |

## Validate

| Command | Covers |
| --- | --- |
| `npm run test:history` | Undo/redo store and transaction coordinator |
| `npm run test:scene-objects` | Scene-object model |
| `npm run test:hierarchy` | Hierarchy panel model |
| `npm run test:objects` | Gizmo interaction in a real browser — needs `npm run dev:ui` in another shell |
| `npm run test:theme` / `test:appearance` / `test:layout` | UI theme, appearance, layout |
| `npm run test:lifecycle` | Dev-server process lifecycle |
| `npm run test:ardy` | ARDY conversion, playback, and IK pipeline |
| `cd mcp && npm install && npm run verify` | MCP server over real stdio — all 420 framing combinations |
| `cd mcp && npm run verify:live` | Live-control protocol against a fake editor (same `npm install` first) |
| `npm run build` | Production build |

Ad-hoc browser QA, while a dev server is available:

```bash
npm run qa:browser -- <qa-script>
```

## Contributing

Found something broken, or want a feature? [Open an issue](https://github.com/NomaDamas/CozyClay/issues) — bug reports with a repro are the most useful thing you can send. Contributions are accepted under `AGPL-3.0-or-later`.

**Repository hygiene.** Generated motion archives, QA output, build output, logs and local runtime artifacts are not source files and must not be committed. Keep `tools/ardy/out/`, `artifacts/`, `dist/`, `.gjc/` and `.npz` files local.

All runtime libraries intentionally live in `devDependencies` because the published npm package ships the prebuilt `dist/`, so `npx cozyclay` must not install the studio's dependency tree.

## Analytics & privacy

The hosted site at [cozyclay.org](https://cozyclay.org/) collects anonymous usage analytics via [PostHog](https://posthog.com/) (US Cloud). There are no cookies and no session recording, and Do-Not-Track is respected. A random anonymous identifier is kept in your browser's localStorage so that returning visits and retention can be counted; it contains no personal data, is never linked to an identity, and is removed by clearing site data or using the opt-out toggle.

Events collected:

| Event | Purpose |
| --- | --- |
| `$pageview` | Funnel and drop-off analysis |
| `scene:created` | Funnel and drop-off analysis |
| `scene:loaded` | Funnel and drop-off analysis |
| `craft:first_action` | Funnel and drop-off analysis |
| `motion:job_started` | Motion reliability |
| `motion:job_succeeded` | Motion reliability |
| `motion:job_failed` | Motion reliability |
| `export:blocking_frame_succeeded` | Funnel and drop-off analysis |
| `activation:completed` | Funnel and drop-off analysis |

Geo data comes from ingest-time GeoIP country lookup only — no precise location is collected. Prompt text, asset names, file names, and any user-entered text are never collected.

To opt out, use the in-app topbar analytics toggle, enable Do-Not-Track in your browser, or use a content blocker. The npm CLI, local builds, and forked builds never send analytics: initialization is restricted to the official production origin.

PostHog's free plan retains events for 1 year.

## License & credits

GNU Affero General Public License v3.0 or later — see [`LICENSE`](LICENSE) and the transition details in [`LICENSING.md`](LICENSING.md). Modified network services must offer their users the corresponding source. Third-party projects retain their own licenses and copyright; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

CozyClay can connect to [NVIDIA ARDY](https://github.com/nv-tlabs/ardy) for motion generation. ARDY is a separate third-party project owned and maintained by NVIDIA; it is not included in this repository, and CozyClay is not affiliated with or endorsed by NVIDIA.
