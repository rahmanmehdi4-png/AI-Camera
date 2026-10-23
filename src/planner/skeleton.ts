import {
  add,
  cloneEuler,
  eulerXYZMatrix,
  hadamard,
  mulMat,
  mulMatVec,
  sub,
  v,
  type EulerDeg,
  type Vec3,
} from "./math.ts";

export const JOINTS = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "shoulderL",
  "upperArmL",
  "forearmL",
  "handL",
  "shoulderR",
  "upperArmR",
  "forearmR",
  "handR",
  "thighL",
  "shinL",
  "footL",
  "thighR",
  "shinR",
  "footR",
] as const;

export type JointId = (typeof JOINTS)[number];

export type Pose = Record<JointId, EulerDeg>;

export type Bone = {
  id: JointId;
  parent: JointId | null;
  /** Offset from the parent joint, metres, before this joint's rotation. */
  local: Vec3;
};

export const BONES: readonly Bone[] = [
  { id: "hips", parent: null, local: v(0, 0.96, 0) },
  { id: "spine", parent: "hips", local: v(0, 0.12, 0) },
  { id: "chest", parent: "spine", local: v(0, 0.2, 0) },
  { id: "neck", parent: "chest", local: v(0, 0.22, 0) },
  { id: "head", parent: "neck", local: v(0, 0.1, 0) },
  { id: "shoulderL", parent: "chest", local: v(0.08, 0.18, 0) },
  { id: "upperArmL", parent: "shoulderL", local: v(0.12, 0, 0) },
  { id: "forearmL", parent: "upperArmL", local: v(0, -0.28, 0) },
  { id: "handL", parent: "forearmL", local: v(0, -0.25, 0) },
  { id: "shoulderR", parent: "chest", local: v(-0.08, 0.18, 0) },
  { id: "upperArmR", parent: "shoulderR", local: v(-0.12, 0, 0) },
  { id: "forearmR", parent: "upperArmR", local: v(0, -0.28, 0) },
  { id: "handR", parent: "forearmR", local: v(0, -0.25, 0) },
  { id: "thighL", parent: "hips", local: v(0.1, -0.06, 0) },
  { id: "shinL", parent: "thighL", local: v(0, -0.44, 0) },
  { id: "footL", parent: "shinL", local: v(0, -0.42, 0) },
  { id: "thighR", parent: "hips", local: v(-0.1, -0.06, 0) },
  { id: "shinR", parent: "thighR", local: v(0, -0.44, 0) },
  { id: "footR", parent: "shinR", local: v(0, -0.42, 0) },
];

/** Child used to draw the bone sticking out of a joint. */
export const BONE_CHILD: Partial<Record<JointId, JointId>> = {
  hips: "spine",
  spine: "chest",
  chest: "neck",
  neck: "head",
  shoulderL: "upperArmL",
  upperArmL: "forearmL",
  forearmL: "handL",
  shoulderR: "upperArmR",
  upperArmR: "forearmR",
  forearmR: "handR",
  thighL: "shinL",
  shinL: "footL",
  thighR: "shinR",
  shinR: "footR",
};

export const JOINT_LABEL: Record<JointId, string> = {
  hips: "Hips",
  spine: "Lower torso",
  chest: "Upper torso",
  neck: "Neck",
  head: "Head",
  shoulderL: "Left shoulder",
  upperArmL: "Left upper arm",
  forearmL: "Left elbow",
  handL: "Left wrist",
  shoulderR: "Right shoulder",
  upperArmR: "Right upper arm",
  forearmR: "Right elbow",
  handR: "Right wrist",
  thighL: "Left hip",
  shinL: "Left knee",
  footL: "Left ankle",
  thighR: "Right hip",
  shinR: "Right knee",
  footR: "Right ankle",
};

export const JOINT_GROUPS: { label: string; ids: JointId[] }[] = [
  { label: "Torso", ids: ["hips", "spine", "chest", "neck", "head"] },
  { label: "Left arm", ids: ["shoulderL", "upperArmL", "forearmL", "handL"] },
  { label: "Right arm", ids: ["shoulderR", "upperArmR", "forearmR", "handR"] },
  { label: "Left leg", ids: ["thighL", "shinL", "footL"] },
  { label: "Right leg", ids: ["thighR", "shinR", "footR"] },
];

type Range = [number, number];

export const JOINT_LIMITS: Record<JointId, { x: Range; y: Range; z: Range }> = {
  hips: { x: [-45, 50], y: [-40, 40], z: [-30, 30] },
  spine: { x: [-35, 55], y: [-40, 40], z: [-30, 30] },
  chest: { x: [-25, 45], y: [-35, 35], z: [-28, 28] },
  neck: { x: [-35, 45], y: [-70, 70], z: [-30, 30] },
  head: { x: [-35, 40], y: [-55, 55], z: [-30, 30] },
  shoulderL: { x: [-25, 40], y: [-30, 30], z: [-20, 40] },
  shoulderR: { x: [-25, 40], y: [-30, 30], z: [-40, 20] },
  upperArmL: { x: [-160, 170], y: [-80, 140], z: [-30, 160] },
  upperArmR: { x: [-160, 170], y: [-140, 80], z: [-160, 30] },
  forearmL: { x: [-145, 8], y: [-15, 110], z: [-25, 25] },
  forearmR: { x: [-145, 8], y: [-110, 15], z: [-25, 25] },
  handL: { x: [-55, 60], y: [-35, 35], z: [-45, 45] },
  handR: { x: [-55, 60], y: [-35, 35], z: [-45, 45] },
  thighL: { x: [-115, 40], y: [-35, 50], z: [-45, 40] },
  thighR: { x: [-115, 40], y: [-50, 35], z: [-40, 45] },
  shinL: { x: [0, 145], y: [-10, 10], z: [-10, 10] },
  shinR: { x: [0, 145], y: [-10, 10], z: [-10, 10] },
  footL: { x: [-40, 50], y: [-25, 25], z: [-30, 30] },
  footR: { x: [-40, 50], y: [-25, 25], z: [-30, 30] },
};

const FREE: Range = [-180, 180];

export function emptyPose(): Pose {
  const pose = {} as Pose;
  for (const id of JOINTS) pose[id] = { x: 0, y: 0, z: 0 };
  return pose;
}

export function clonePose(pose: Pose): Pose {
  const next = emptyPose();
  for (const id of JOINTS) next[id] = cloneEuler(pose[id]);
  return next;
}

export function clampJoint(id: JointId, e: EulerDeg, limits: boolean): EulerDeg {
  const lim = limits ? JOINT_LIMITS[id] : { x: FREE, y: FREE, z: FREE };
  return {
    x: Math.min(lim.x[1], Math.max(lim.x[0], e.x)),
    y: Math.min(lim.y[1], Math.max(lim.y[0], e.y)),
    z: Math.min(lim.z[1], Math.max(lim.z[0], e.z)),
  };
}

export function clampPose(pose: Pose, limits: boolean): Pose {
  const next = emptyPose();
  for (const id of JOINTS) next[id] = clampJoint(id, pose[id], limits);
  return next;
}

export type PresetId =
  | "stand"
  | "sit"
  | "kneel"
  | "lean"
  | "lie-up"
  | "lie-down"
  | "lie-left"
  | "lie-right";

export const PRESET_LABEL: Record<PresetId, string> = {
  stand: "Stand",
  sit: "Sit",
  kneel: "Kneel",
  lean: "Lean",
  "lie-up": "Lie face-up",
  "lie-down": "Lie face-down",
  "lie-left": "Lie left side",
  "lie-right": "Lie right side",
};

export function presetPose(id: PresetId): { pose: Pose; rotation: EulerDeg } {
  const pose = emptyPose();
  const rotation: EulerDeg = { x: 0, y: 0, z: 0 };
  if (id === "sit") {
    pose.thighL = { x: -78, y: 6, z: -8 };
    pose.thighR = { x: -78, y: -6, z: 8 };
    pose.shinL = { x: 88, y: 0, z: 0 };
    pose.shinR = { x: 88, y: 0, z: 0 };
    pose.footL = { x: -8, y: 0, z: 0 };
    pose.footR = { x: -8, y: 0, z: 0 };
    pose.spine = { x: 8, y: 0, z: 0 };
    pose.upperArmL = { x: -18, y: 8, z: 12 };
    pose.upperArmR = { x: -18, y: -8, z: -12 };
    pose.forearmL = { x: -46, y: 0, z: 0 };
    pose.forearmR = { x: -46, y: 0, z: 0 };
  } else if (id === "kneel") {
    pose.thighL = { x: -8, y: 0, z: -4 };
    pose.thighR = { x: -8, y: 0, z: 4 };
    pose.shinL = { x: 100, y: 0, z: 0 };
    pose.shinR = { x: 100, y: 0, z: 0 };
    pose.footL = { x: 15, y: 0, z: 0 };
    pose.footR = { x: 15, y: 0, z: 0 };
    pose.spine = { x: 6, y: 0, z: 0 };
  } else if (id === "lean") {
    pose.hips = { x: 26, y: 0, z: 0 };
    pose.thighL = { x: -26, y: 0, z: -4 };
    pose.thighR = { x: -26, y: 0, z: 4 };
    pose.spine = { x: 20, y: 0, z: 0 };
    pose.chest = { x: 12, y: 0, z: 0 };
    pose.neck = { x: -18, y: 0, z: 0 };
    pose.upperArmL = { x: 16, y: 0, z: 10 };
    pose.upperArmR = { x: 16, y: 0, z: -10 };
  } else if (id === "lie-up") {
    rotation.x = -90;
    pose.upperArmL = { x: 0, y: 0, z: 22 };
    pose.upperArmR = { x: 0, y: 0, z: -22 };
  } else if (id === "lie-down") {
    rotation.x = 90;
    pose.upperArmL = { x: 0, y: 0, z: 28 };
    pose.upperArmR = { x: 0, y: 0, z: -28 };
    pose.head = { x: -20, y: 24, z: 0 };
  } else if (id === "lie-left") {
    rotation.z = 90;
    pose.thighL = { x: -48, y: 0, z: 0 };
    pose.thighR = { x: -36, y: 0, z: 0 };
    pose.shinL = { x: 72, y: 0, z: 0 };
    pose.shinR = { x: 54, y: 0, z: 0 };
    pose.upperArmL = { x: -20, y: 0, z: -36 };
    pose.upperArmR = { x: -8, y: 0, z: 18 };
  } else if (id === "lie-right") {
    rotation.z = -90;
    pose.thighL = { x: -36, y: 0, z: 0 };
    pose.thighR = { x: -48, y: 0, z: 0 };
    pose.shinL = { x: 54, y: 0, z: 0 };
    pose.shinR = { x: 72, y: 0, z: 0 };
    pose.upperArmL = { x: -8, y: 0, z: -18 };
    pose.upperArmR = { x: -20, y: 0, z: 36 };
  }
  return { pose, rotation };
}

export type LocalJoint = { position: Vec3; rotation: number[] };

/** Joint positions in character-local space, before root translation / rotation / scale. */
export function fkLocal(pose: Pose): Record<JointId, LocalJoint> {
  const out = {} as Record<JointId, LocalJoint>;
  const ident = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (const bone of BONES) {
    const parent = bone.parent ? out[bone.parent] : null;
    const parentRot = parent ? parent.rotation : ident;
    const parentPos = parent ? parent.position : v(0, 0, 0);
    const position = add(parentPos, mulMatVec(parentRot, bone.local));
    const rotation = mulMat(parentRot, eulerXYZMatrix(pose[bone.id] ?? { x: 0, y: 0, z: 0 }));
    out[bone.id] = { position, rotation };
  }
  return out;
}

export function worldJoints(
  pose: Pose,
  position: Vec3,
  rotation: EulerDeg,
  scale: Vec3,
): Record<JointId, Vec3> {
  const local = fkLocal(pose);
  const root = eulerXYZMatrix(rotation);
  const out = {} as Record<JointId, Vec3>;
  for (const id of JOINTS) {
    out[id] = add(position, mulMatVec(root, hadamard(local[id].position, scale)));
  }
  return out;
}

export function bodyBasis(
  pose: Pose,
  rotation: EulerDeg,
): { up: Vec3; forward: Vec3; right: Vec3 } {
  const hip = mulMat(eulerXYZMatrix(rotation), eulerXYZMatrix(pose.hips));
  return {
    up: mulMatVec(hip, v(0, 1, 0)),
    forward: mulMatVec(hip, v(0, 0, 1)),
    right: mulMatVec(hip, v(1, 0, 0)),
  };
}

export function lowestJointDelta(points: Vec3[], padding = 0.02): number {
  let minY = Infinity;
  for (const p of points) minY = Math.min(minY, p.y);
  if (!Number.isFinite(minY)) return 0;
  return padding - minY;
}

export function boneLocal(id: JointId): Vec3 {
  return BONES.find((b) => b.id === id)?.local ?? v();
}

export function childOffset(id: JointId): Vec3 | null {
  const child = BONE_CHILD[id];
  if (!child) return null;
  return boneLocal(child);
}

export function restHeight(): number {
  const joints = worldJoints(emptyPose(), v(), { x: 0, y: 0, z: 0 }, v(1, 1, 1));
  return joints.head.y + 0.12;
}

export function poseDelta(pose: Pose, id: JointId): number {
  const e = pose[id];
  return Math.hypot(e.x, e.y, e.z);
}

export function significantBends(pose: Pose, minDeg = 18): { id: JointId; euler: EulerDeg }[] {
  const list: { id: JointId; euler: EulerDeg }[] = [];
  for (const id of JOINTS) {
    if (poseDelta(pose, id) >= minDeg) list.push({ id, euler: pose[id] });
  }
  return list;
}

export function mid(a: Vec3, b: Vec3): Vec3 {
  return mulAdd(a, b);
}

function mulAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return sub(a, b);
}
