#!/usr/bin/env node
/**
 * The pose-export contract: buildArdyPose emits per-bone DELTAS — the basis
 * satisfying current = rest ∘ basis — w-first, unit-length, for exactly the
 * cskel27 joints, and throws instead of emitting anything corrupt.
 *
 * The reference math here is rotation APPLICATION (rotate a vector by a
 * quaternion) and 3x3 matrix composition, never the module's own Hamilton
 * product or conjugate — a convention error in export.js cannot cancel
 * itself out against the same convention re-stated in the test.
 */
import { buildArdyPose } from "../../src/ardy/export.js";
import { POSE_BONES } from "../../src/poses.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
function expectThrows(name, fn, pattern) {
	try {
		fn();
		expect(name, false, "did not throw");
	} catch (err) {
		expect(name, pattern.test(err.message), `threw "${err.message}"`);
	}
}

// ---------------------------------------------------------------------------
// independent rotation reference
// ---------------------------------------------------------------------------

/** Rotate v by unit quaternion q: v' = v + 2 u×(u×v + w v). No Hamilton
 * product involved, and inherently sign-agnostic (q and -q agree). */
function quatRotate(q, v) {
	const u = [q[1], q[2], q[3]];
	const w = q[0];
	const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	const t = cross(u, v);
	const inner = [t[0] + w * v[0], t[1] + w * v[1], t[2] + w * v[2]];
	const outer = cross(u, inner);
	return [v[0] + 2 * outer[0], v[1] + 2 * outer[1], v[2] + 2 * outer[2]];
}

/** w-first quaternion -> 3x3 rotation matrix (row-major). */
function matFromQuat([w, x, y, z]) {
	return [
		[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
		[2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
		[2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
	];
}

function matMul(a, b) {
	return a.map((row, i) => row.map((_, j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
}

/** 3x3 rotation matrix -> w-first quaternion (Shepperd; sign arbitrary). */
function quatFromMat(m) {
	const tr = m[0][0] + m[1][1] + m[2][2];
	let w, x, y, z;
	if (tr > 0) {
		const s = Math.sqrt(tr + 1) * 2;
		w = s / 4; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s;
	} else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
		const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
		w = (m[2][1] - m[1][2]) / s; x = s / 4; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s;
	} else if (m[1][1] > m[2][2]) {
		const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
		w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = s / 4; z = (m[1][2] + m[2][1]) / s;
	} else {
		const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
		w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = s / 4;
	}
	return [w, x, y, z];
}

/** Rotation composition a ∘ b through matrices — the reference for
 * "current = rest ∘ basis" that never touches a quaternion product. */
function compose(a, b) {
	return quatFromMat(matMul(matFromQuat(a), matFromQuat(b)));
}

/** Same rotation, ignoring the q/-q double cover. */
function sameRotation(a, b, tol = 1e-7) {
	const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2], p[3] - q[3]);
	return Math.min(d(a, b), d(a, b.map((c) => -c))) < tol;
}

// Deterministic quaternions: no Math.random, so a failure reproduces exactly.
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function randQuat(rng) {
	let q;
	do {
		q = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1];
	} while (Math.hypot(...q) < 0.1);
	const len = Math.hypot(...q);
	return q.map((c) => c / len); // w-first
}

// ---------------------------------------------------------------------------
// structural fake rig — poses.js consumes trees via isBone/traverse/quaternion,
// so the tests do too; no three.js import needed.
// ---------------------------------------------------------------------------

function makeBone(name) {
	return {
		isBone: true,
		name,
		quaternion: { x: 0, y: 0, z: 0, w: 1 },
		children: [],
		traverse(cb) {
			cb(this);
			for (const child of this.children) child.traverse(cb);
		},
	};
}

function setQuat(bone, [w, x, y, z]) {
	bone.quaternion = { x, y, z, w };
}

/** A rig with one bone per POSE_BONES entry (flat under the root), named by
 * `nameOf`. Priming stores each bone's CURRENT quaternion as its rest, the
 * way PoseHandles primes userData.poseBind. */
function makeRig({ nameOf = (entry) => entry.bone, prime = true } = {}) {
	const bones = new Map();
	const root = {
		userData: {},
		children: [],
		traverse(cb) {
			cb(this);
			for (const child of this.children) child.traverse(cb);
		},
	};
	for (const entry of POSE_BONES) {
		const bone = makeBone(nameOf(entry));
		bones.set(entry.id, bone);
		root.children.push(bone);
	}
	if (prime) primeRest(root, bones);
	return { root, bones };
}

function primeRest(root, bones) {
	const bind = new Map();
	for (const bone of bones.values()) {
		const q = bone.quaternion;
		bind.set(bone, { x: q.x, y: q.y, z: q.z, w: q.w });
	}
	root.userData.poseBind = bind;
}

const WIRE_NAMES = POSE_BONES.map((entry) => entry.bone.replace(/^mixamorig/i, ""));

function baseArgs(root, extra = {}) {
	return {
		rig: root,
		camRef: { current: { position: { x: 1, y: 2, z: 3 } } },
		look: { current: { yaw: 0.3, pitch: -0.2 } },
		fovDeg: 40,
		slate: "TEST-SLATE",
		rigName: "x-bot-tpose",
		...extra,
	};
}

// ---------------------------------------------------------------------------
// 1. identity: current == rest must export the identity delta for every joint
// ---------------------------------------------------------------------------
{
	const rng = mulberry32(1);
	const { root, bones } = makeRig({ prime: false });
	for (const bone of bones.values()) setQuat(bone, randQuat(rng));
	primeRest(root, bones);
	const pose = buildArdyPose(baseArgs(root));
	const keys = Object.keys(pose.bones).sort();
	expect("exports exactly the cskel27 wire joints", JSON.stringify(keys) === JSON.stringify([...WIRE_NAMES].sort()), keys.join(","));
	expect(
		"unposed rig exports the identity delta everywhere",
		WIRE_NAMES.every((k) => sameRotation(pose.bones[k], [1, 0, 0, 0], 1e-9)),
	);
	expect(
		"every exported quaternion is unit length",
		WIRE_NAMES.every((k) => Math.abs(Math.hypot(...pose.bones[k]) - 1) < 1e-9),
	);
}

// ---------------------------------------------------------------------------
// 2. the delta contract: rotating by rest then by the exported basis must land
//    exactly where the current rotation lands (current = rest ∘ basis)
// ---------------------------------------------------------------------------
{
	const rng = mulberry32(2);
	const { root, bones } = makeRig({ prime: false });
	const rest = new Map();
	for (const [id, bone] of bones) {
		const q = randQuat(rng);
		rest.set(id, q);
		setQuat(bone, q);
	}
	primeRest(root, bones);
	for (const bone of bones.values()) setQuat(bone, randQuat(rng)); // pose it
	const pose = buildArdyPose(baseArgs(root));
	const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
	let worst = 0;
	for (const entry of POSE_BONES) {
		const basis = pose.bones[entry.bone.replace(/^mixamorig/i, "")];
		const cq = bones.get(entry.id).quaternion;
		const current = [cq.w, cq.x, cq.y, cq.z];
		for (const v of axes) {
			const viaDelta = quatRotate(rest.get(entry.id), quatRotate(basis, v));
			const direct = quatRotate(current, v);
			worst = Math.max(worst, Math.hypot(...viaDelta.map((c, i) => c - direct[i])));
		}
	}
	expect("basis satisfies current = rest ∘ basis on every joint", worst < 1e-9, `worst drift ${worst}`);
}

// ---------------------------------------------------------------------------
// 3. w-first wire order, pinned to a hand-computed value
// ---------------------------------------------------------------------------
{
	const { root, bones } = makeRig(); // primed at identity
	const h = Math.SQRT1_2; // 90° about +X: w = x = cos(45°) = sin(45°)
	setQuat(bones.get("lArm"), [h, h, 0, 0]);
	const pose = buildArdyPose(baseArgs(root));
	const [w, x, y, z] = pose.bones.LeftArm;
	expect(
		"a 90° X rotation exports as [w, x, y, z] = [√½, √½, 0, 0]",
		Math.abs(w - h) < 1e-12 && Math.abs(x - h) < 1e-12 && Math.abs(y) < 1e-12 && Math.abs(z) < 1e-12,
		JSON.stringify(pose.bones.LeftArm),
	);
}

// ---------------------------------------------------------------------------
// 4. rig independence: the same pose delta on two different binds must export
//    the same wire values — the reason the format is deltas at all
// ---------------------------------------------------------------------------
{
	const rng = mulberry32(4);
	const deltas = new Map(POSE_BONES.map((entry) => [entry.id, randQuat(rng)]));
	const payloads = [];
	for (const seed of [40, 41]) {
		const restRng = mulberry32(seed);
		const { root, bones } = makeRig({ prime: false });
		const rests = new Map();
		for (const [id, bone] of bones) {
			const q = randQuat(restRng);
			rests.set(id, q);
			setQuat(bone, q);
		}
		primeRest(root, bones);
		for (const [id, bone] of bones) setQuat(bone, compose(rests.get(id), deltas.get(id)));
		payloads.push(buildArdyPose(baseArgs(root)).bones);
	}
	expect(
		"two rigs with different binds and the same pose delta export the same bones",
		WIRE_NAMES.every((k) => sameRotation(payloads[0][k], payloads[1][k], 1e-6)),
	);
	expect(
		"and the exported delta is the authored delta",
		POSE_BONES.every((entry) => sameRotation(payloads[0][entry.bone.replace(/^mixamorig/i, "")], deltas.get(entry.id), 1e-6)),
	);
}

// ---------------------------------------------------------------------------
// 5. the Mixamo skinned duplicate must not shadow the control bone
// ---------------------------------------------------------------------------
{
	const { root, bones } = makeRig({ prime: false });
	const control = bones.get("head");
	const duplicate = makeBone(control.name); // identity copy nested beneath
	control.children.push(duplicate);
	primeRest(root, bones);
	root.userData.poseBind.set(duplicate, { x: 0, y: 0, z: 0, w: 1 });
	const h = Math.SQRT1_2;
	setQuat(control, [h, 0, h, 0]); // pose only the control bone
	const pose = buildArdyPose(baseArgs(root));
	expect(
		"first depth-first match wins over the nested identity copy",
		sameRotation(pose.bones.Head, [h, 0, h, 0], 1e-12),
		JSON.stringify(pose.bones.Head),
	);
}

// ---------------------------------------------------------------------------
// 6. bone-name spellings: mixamorig:-prefixed and bare names both resolve
// ---------------------------------------------------------------------------
{
	for (const nameOf of [
		(entry) => entry.bone.replace(/^mixamorig/i, "mixamorig:"),
		(entry) => entry.bone.replace(/^mixamorig/i, ""),
	]) {
		const { root } = makeRig({ nameOf });
		const pose = buildArdyPose(baseArgs(root));
		expect(
			`rig spelled "${nameOf(POSE_BONES[0])}" still exports every joint`,
			Object.keys(pose.bones).length === POSE_BONES.length,
		);
	}
}

// ---------------------------------------------------------------------------
// 7. refusal: missing joints, corrupt quaternions, bad arguments all throw
// ---------------------------------------------------------------------------
{
	const { root } = makeRig({ nameOf: (entry) => (entry.id === "rHand" ? "NotABone" : entry.bone) });
	expectThrows("a rig missing a joint names it", () => buildArdyPose(baseArgs(root)), /missing joints: rHand/);
}
{
	const { root, bones } = makeRig();
	bones.get("spine").quaternion.x = NaN;
	expectThrows("a non-finite quaternion names the joint", () => buildArdyPose(baseArgs(root)), /non-finite quaternion for spine/);
}
{
	const { root, bones } = makeRig();
	setQuat(bones.get("neck"), [0, 0, 0, 0]);
	expectThrows("a zero-length quaternion is refused", () => buildArdyPose(baseArgs(root)), /zero-length quaternion for neck/);
}
{
	const { root } = makeRig();
	expectThrows("no rig throws", () => buildArdyPose(baseArgs(null)), /rig is required/);
	expectThrows("no camera throws", () => buildArdyPose(baseArgs(root, { camRef: { current: null } })), /camRef/);
	expectThrows("empty slate throws", () => buildArdyPose(baseArgs(root, { slate: "" })), /slate/);
	expectThrows("non-finite fov throws", () => buildArdyPose(baseArgs(root, { fovDeg: NaN })), /fovDeg/);
	expectThrows("short root throws", () => buildArdyPose(baseArgs(root, { root: [1, 2] })), /root must be/);
	expectThrows("non-finite root throws", () => buildArdyPose(baseArgs(root, { root: [1, NaN, 3] })), /root must be/);
}

// ---------------------------------------------------------------------------
// 8. unprimed rig: the lazy rest capture is taken once and then holds
// ---------------------------------------------------------------------------
{
	const rng = mulberry32(8);
	const { root, bones } = makeRig({ prime: false });
	for (const bone of bones.values()) setQuat(bone, randQuat(rng));
	const first = buildArdyPose(baseArgs(root));
	expect(
		"without a primed bind, the first export reads as the rest pose",
		WIRE_NAMES.every((k) => sameRotation(first.bones[k], [1, 0, 0, 0], 1e-9)),
	);
	const h = Math.SQRT1_2;
	const hips = bones.get("hips");
	setQuat(hips, compose([hips.quaternion.w, hips.quaternion.x, hips.quaternion.y, hips.quaternion.z], [h, 0, 0, h]));
	const second = buildArdyPose(baseArgs(root));
	expect(
		"a later pose is measured against that captured rest, not re-zeroed",
		sameRotation(second.bones.Hips, [h, 0, 0, h], 1e-6),
		JSON.stringify(second.bones.Hips),
	);
}

// ---------------------------------------------------------------------------
// 9. the camera block and envelope
// ---------------------------------------------------------------------------
{
	const { root } = makeRig();
	const yaw = 0.3;
	const pitch = -0.2;
	const authoredRoot = [0.5, 0, -1.25];
	const pose = buildArdyPose(baseArgs(root, { root: authoredRoot }));
	const fwd = [
		pose.camera.look_at[0] - pose.camera.position[0],
		pose.camera.look_at[1] - pose.camera.position[1],
		pose.camera.look_at[2] - pose.camera.position[2],
	];
	const cp = Math.cos(pitch);
	const expected = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
	expect("camera position is the shot camera's", JSON.stringify(pose.camera.position) === "[1,2,3]");
	expect(
		"look_at sits one unit forward along yaw/pitch",
		Math.hypot(...fwd.map((c, i) => c - expected[i])) < 1e-12,
		JSON.stringify(fwd),
	);
	expect("up is Y-up", JSON.stringify(pose.camera.up) === "[0,1,0]");
	expect("fov converts degrees to radians", Math.abs(pose.camera.vertical_fov_radians - (40 * Math.PI) / 180) < 1e-12);
	expect("schema is cozyclay.pose.v1", pose.schema === "cozyclay.pose.v1");
	expect("slate passes through", pose.slate === "TEST-SLATE");
	expect("root is copied, not aliased", pose.root !== authoredRoot && JSON.stringify(pose.root) === JSON.stringify(authoredRoot));
	const anonymous = buildArdyPose(baseArgs(root, { rigName: undefined }));
	expect("a missing rig name falls back to unknown", anonymous.source.rig === "unknown");
	expect("an omitted root stays omitted", !("root" in anonymous));
}

if (failures > 0) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log("\nAll pose-export checks passed");
