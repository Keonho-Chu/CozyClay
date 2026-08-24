# CozyClay -> ARDY pose bridge

`run-on-box.sh` pushes a synthetic pose `.npz` produced from a CozyClay pose
into the ARDY text-to-motion pipeline on the remote box, runs a constrained
generation pass that honours that pose, and pulls the resulting motion back.
This is the "long tail" of the bridge: the pose is authored in CozyClay,
converted to an ARDY motion npz locally, and this script is what actually
gets the box to generate with it.

## Remote ARDY host

The bridge expects an SSH-accessible machine where ARDY is already installed.
CozyClay deliberately does not prescribe a VPN, hostname scheme, cloud
provider, or network topology.

Configure the host explicitly before starting the bridge:

```sh
export CCLAY_ARDY_HOST="<ssh-user>@<ssh-host>"
```

Optional overrides:

- `CCLAY_ARDY_REPO` — ARDY checkout on the remote host (default `$HOME/ardy`)
- `CCLAY_ARDY_VENV` — generator Python (default `~/ardy/.venv-cuda/bin/python`)
- `CCLAY_ARDY_ENCODER_URL` — encoder URL as seen from the remote host

SSH must work non-interactively with `BatchMode=yes`. Hardware and device
selection are operator concerns; pass `--cpu` when CPU generation is desired.

## Token-free text encoder setup

ARDY's default text-encoder stack (LLM2Vec) resolves its base weights to the
gated `meta-llama/Meta-Llama-3-8B-Instruct` repository, which is why the
upstream README asks for a Hugging Face account, gated-access approval, and
a token on the box. None of that is needed: the same stack is available from
public, ungated repositories, and ARDY already supports loading it from a
local directory via `TEXT_ENCODERS_DIR`.

```sh
CCLAY_ARDY_HOST=user@gpu-box tools/ardy/setup-text-encoder-on-box.sh
```

copies `setup-text-encoder.py` to the box and downloads (~16.4 GB, resumable;
re-runs only verify and fill gaps):

- `NousResearch/Meta-Llama-3-8B-Instruct` — public mirror of the base
  weights, every shard verified against a pinned SHA-256
- `McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp` and `-mntp-supervised`
  — the two LLM2Vec adapters (MIT)

into `~/cclay-text-encoders` on the box (`CCLAY_ARDY_ENCODERS_DIR`
overrides), rewrites each adapter's `base_model_name_or_path` to the local
base directory so nothing resolves back to the gated repo at runtime, and
then bakes the base + MNTP-LoRA merge into the runtime path
(`merge-text-encoder.py`, run in the ARDY encoder venv). The merge step is
required, not cosmetic: transformers v5 removed the automatic
adapter-directory resolution ARDY's vendored LLM2Vec loader relies on, so
the local MNTP path must be a full model. The merged stack is numerically
identical to the gated flow (cosine ≥ 0.99996 against a live token-based
encoder service on the same prompts).
All three revisions are pinned to full commit SHAs — the same stack
nv-tlabs/ardy issue #9 reproduced against — so every install encodes
prompts byte-identically.

Start the encoder service with the directory exported:

```sh
ssh $CCLAY_ARDY_HOST
cd ~/ardy
TEXT_ENCODERS_DIR=$HOME/cclay-text-encoders \
  .venv/bin/python scripts/run_text_encoder_server.py
```

`setup-text-encoder-on-box.sh --verify-only` re-hashes an existing tree
without downloading. To provision a machine directly (no ssh hop), run
`python3 tools/ardy/setup-text-encoder.py --dest <dir>` on it; the script is
stdlib-only.

Licensing: the base weights are Meta Llama 3 (Meta Llama 3 Community
License; the LICENSE and USE_POLICY.md land next to the weights). CozyClay
does not redistribute any model files — the script downloads them from
their public sources to the operator's own machine. Built with Meta Llama 3.
See `THIRD_PARTY_NOTICES.md`.

## Where the motions live on the box

- Base (first-pass, unconstrained) motions: `~/ardy/outputs/*.npz` and
  `~/ardy/outputs/omb/*.npz`. `run-on-box.sh` resolves a bare `--base` id
  against `outputs/<id>.npz` first, then `outputs/omb/<id>.npz`; a bare
  `<name>.npz` is treated the same with the suffix stripped; anything with a
  `/` is used as a repo-relative or absolute path.
- The base npz must be at least as long as the requested clip — the
  generator rejects a shorter base (`--base npz has N frames but the
  requested clip is M`), so pick a base that covers `--duration`.
- Nothing is ever written into the checkout: the pose npz and the generated
  output live under a fresh `mktemp -d` dir on the box (usually `/tmp`),
  which an `EXIT` trap removes even on failure.

## The pose npz contract

`<pose.npz>` is an ARDY motion npz — the same format as a base motion — that
must carry `local_rot_mats` and `posed_joints`. One frame is enough: the
CozyClay pose is baked into `local_rot_mats[src_frame]` (the cskel27
per-joint local rotations, built from the CozyClay basis quaternions via
`basis = Rb^T @ L @ Rb` / `L = Rb @ basis @ Rb^T`, where `Rb` is the bone's
armature-space rest rotation — see CozyClay `motion_retarget.py` /
`motion_constraints.py`). The src-frame is range-checked against the npz by
the generator remotely, so an out-of-range `--src-frame` dies on the box
with a clear message rather than silently. CozyClay-authored pose files also
carry `rotation_constraint_indices`: only those rotations are observed by the
model, while the identity-filled Core joints remain free. An ordinary motion
npz without that member constrains every joint rotation.

## The generation grammar

The raw generator flag for a full-body pose constraint is:

```
--pose-from <src-npz> <src-frame> <dst-frame>
```

It pins every joint position plus the selected joint rotations from
`<src-npz>` at `<src-frame>` onto `<dst-frame>` of the new clip. It is
repeatable and works for poses no end-effector constraint can express
(sitting, lying, reaching). The clip is `int(duration * 20)` frames at
ARDY's 20 fps, and
`dst-frame` must satisfy `0 <= dst-frame < duration * 20`; the generator
also rejects clips under 3 frames.

`run-on-box.sh` maps its arguments onto the generator one-to-one:

```
run-on-box.sh <pose.npz> --base <motion-id|npz-path> --prompt "<prompt>" \
  --duration <seconds> --dst-frame <N> [--src-frame <N>] [--seed <S>] \
  [--output <local.npz>] [--dry-run]
```

which becomes, on the box (modulo the temp dir):

```
cd $HOME/ardy && ~/ardy/.venv-cuda/bin/python \
  scripts/cclay_constrained_generate.py \
  --prompt "<prompt>" --duration <seconds> \
  --base <resolved-base> --output <tmp>/out \
  --pose-from <tmp>/pose.npz <src-frame> <dst-frame> [--seed <S>]
```

The CozyClay wrapper `cclay-ardy-generate` exposes the same feature through
its own grammar — `--constrain-pose <src-motion-id> <src-frame> <dst-frame>`
— where `<src-motion-id>` is a motion already staged in the CozyClay
project (`.cclay/motions/<id>.npz`) rather than a raw npz path. `run-on-box.sh`
exists for the CozyClay flow, where the pose source is a synthetic npz
produced by the conversion module and the base motion is a pre-existing
`~/ardy/outputs/*.npz`; both paths drive the same `--pose-from` mechanism.

## Preflight, safety, idempotence

Before anything is pushed, `run-on-box.sh` fails fast, cheapest check
first:

1. SSH reachability (`BatchMode` + `ConnectTimeout`, so a dead host or a
   missing key errors in seconds, not minutes).
2. `~/ardy/.venv-cuda/bin/python` and `scripts/cclay_constrained_generate.py`
   exist on the box (points at `sync-to-box --apply` when missing).
3. The base motion resolves to a file that exists on the box.
4. The device probe: the one-line torch check mirroring the generator's
   device expression under the same environment, printed before launching.

`--dry-run` runs all of the above (they are reads only), prints the exact
push / remote-command / pull / cleanup steps, and exits without connecting
for the generation step.

Every expansion is quoted; `set -euo pipefail` is on; prompts and paths are
shell-quoted with `printf %q` so they survive the remote shell. The remote
temp dir is created with `mktemp -d`, removed by an `EXIT` trap (cleanup
failure never masks the real result), and guarded to be absolute before it
can reach `rm -rf`. Re-running the same command with the same `--output`
overwrites it — no state accumulates anywhere.

## Example

```
tools/ardy/run-on-box.sh /tmp/pose-shooting.npz \
  --base a-person-runs-forward-0722151659 \
  --prompt "a person sprints forward and raises both arms" \
  --duration 5 --dst-frame 60 --seed 7 \
  --output tools/ardy/out/sprint-pose.npz
```

The generator's stdout passes through (device line, loaded model, per-frame
constraint lines, final JSON result), and the pulled npz lands at
`--output` (default `tools/ardy/out/<pose>-constrained.npz`, gitignored).
The result is a full ARDY motion npz and can be used like any other
generated motion.

## Operational notes

- Prompt-block 4 s cap: this is a CozyClay local quality policy, not an
  ARDY limit. Upstream's CLI defaults to 5 s (`--duration` in
  scripts/generate.py), and
  the model's trained window is 10 s — CozyClay caps at 4 s because blocks
  beyond that drift visibly on this bridge.
- Embedding-cache footgun (upstream nv-tlabs/ardy PR #8): cache keys hash
  only the prompt text. After changing the text encoder or adapters, clear
  the cache dir or stale embeddings are silently reused under the new
  encoder.
- Prompts are conditioned per segment (`segments[].prompt`); in multi-phase
  MCP requests the joined top-level `prompt` field is transport metadata
  only and is not what the model attends to.
