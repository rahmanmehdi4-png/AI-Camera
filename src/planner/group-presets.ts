/** Non-graphic multi-person blocking presets; adult references use featureless mannequins. */
import { applyPreset, createCharacter, nextCharacterName, type Project } from "./project.ts";
import { clampPose, lowestJointDelta, worldJoints, type Pose, type PresetId } from "./skeleton.ts";
import { placeBodyOnFloor } from "./body.ts";

export type GroupMember = {
  pose: PresetId;
  x: number;
  z: number;
  yaw: number;
  /** Optional joint rotations on top of the standard seated/standing/reclining pose. */
  joints?: Partial<Pose>;
  /** Additional vertical offset for a figure supported above another. */
  lift?: number;
};

export type GroupPreset = {
  id: string;
  name: string;
  count: number;
  description: string;
  category?: "standard" | "adult";
  members: GroupMember[];
};

type Layout = { name: string; description: string; members: GroupPreset["members"] };
const p = (pose: PresetId, x: number, z: number, yaw = 0) => ({ pose, x, z, yaw });

const BASE: Layout[] = [
  { name: "Face-to-Face", description: "Standing, looking toward each other", members: [p("stand", -0.55, 0, 90), p("stand", 0.55, 0, -90)] },
  { name: "Side by Side", description: "Parallel standing pair", members: [p("stand", -0.4, 0), p("stand", 0.4, 0)] },
  { name: "Front and Rear", description: "One character behind the other", members: [p("stand", 0, -0.65), p("stand", 0, 0.65)] },
  { name: "Opposing Angles", description: "Two standing characters at a diagonal", members: [p("stand", -0.55, -0.4, 45), p("stand", 0.55, 0.4, 225)] },
  { name: "Seated Pair", description: "Two characters seated side by side", members: [p("sit", -0.48, 0), p("sit", 0.48, 0)] },
  { name: "Opposing Seats", description: "Two seated characters facing each other", members: [p("sit", 0, -0.5, 0), p("sit", 0, 0.5, 180)] },
  { name: "Standing and Sitting", description: "One standing next to one seated", members: [p("stand", -0.6, 0), p("sit", 0.5, 0)] },
  { name: "Standing and Kneeling", description: "Mixed upright and kneeling poses", members: [p("stand", -0.55, 0), p("kneel", 0.45, 0, -30)] },
  { name: "Parallel Recline", description: "Two characters lying face-up", members: [p("lie-up", -0.4, 0), p("lie-up", 0.4, 0)] },
  { name: "Side-Lying Pair", description: "Two characters lying sideways", members: [p("lie-left", -0.43, 0), p("lie-right", 0.43, 0)] },
  { name: "Opposing Recline", description: "Two characters lying in opposite directions", members: [p("lie-up", -0.45, 0, 0), p("lie-up", 0.45, 0, 180)] },
  { name: "Seated and Reclining", description: "One seated beside one reclining character", members: [p("sit", -0.65, 0), p("lie-up", 0.5, 0)] },
  { name: "Kneeling Pair", description: "Two kneeling characters", members: [p("kneel", -0.5, 0, 30), p("kneel", 0.5, 0, -30)] },
  { name: "Lean and Stand", description: "One leaning beside one standing", members: [p("lean", -0.5, 0, 35), p("stand", 0.5, 0)] },
  { name: "Triangle Formation", description: "Three-person triangular blocking", members: [p("stand", -0.7, -0.4, 30), p("stand", 0.7, -0.4, -30), p("stand", 0, 0.7, 180)] },
  { name: "Three in a Row", description: "Three parallel standing positions", members: [p("stand", -0.85, 0), p("stand", 0, 0), p("stand", 0.85, 0)] },
  { name: "Front Centre", description: "One person ahead of two", members: [p("stand", 0, -0.8), p("stand", -0.65, 0.45), p("stand", 0.65, 0.45)] },
  { name: "Rear Centre", description: "Two people ahead of one", members: [p("stand", -0.6, -0.6), p("stand", 0.6, -0.6), p("stand", 0, 0.65)] },
  { name: "Three Seated", description: "A trio seated in a row", members: [p("sit", -0.85, 0), p("sit", 0, 0), p("sit", 0.85, 0)] },
  { name: "Three Reclining", description: "Three parallel lying poses", members: [p("lie-up", -0.85, 0), p("lie-up", 0, 0), p("lie-up", 0.85, 0)] },
  { name: "Mixed Heights", description: "Standing, sitting and kneeling", members: [p("stand", -0.7, 0), p("sit", 0, 0), p("kneel", 0.7, 0)] },
  { name: "One Standing Two Seated", description: "Standing character behind seated pair", members: [p("stand", 0, 0.65), p("sit", -0.5, -0.35), p("sit", 0.5, -0.35)] },
  { name: "One Seated Two Standing", description: "Seated character between standing pair", members: [p("stand", -0.75, 0), p("sit", 0, -0.3), p("stand", 0.75, 0)] },
  { name: "Three Side Reclines", description: "Three side-lying characters", members: [p("lie-left", -0.85, 0), p("lie-right", 0, 0), p("lie-left", 0.85, 0)] },
  { name: "Square Formation", description: "Four people arranged in a square", members: [p("stand", -0.8, -0.7), p("stand", 0.8, -0.7), p("stand", -0.8, 0.7, 180), p("stand", 0.8, 0.7, 180)] },
  { name: "Four Parallel", description: "Four standing side by side", members: [p("stand", -1.25, 0), p("stand", -0.42, 0), p("stand", 0.42, 0), p("stand", 1.25, 0)] },
  { name: "Four Reclining", description: "Four lying side by side", members: [p("lie-up", -1.15, 0), p("lie-up", -0.38, 0), p("lie-up", 0.38, 0), p("lie-up", 1.15, 0)] },
  { name: "Two Standing Two Seated", description: "Two standing behind two seated", members: [p("stand", -0.6, 0.7), p("stand", 0.6, 0.7), p("sit", -0.6, -0.35), p("sit", 0.6, -0.35)] },
];

export const GROUP_PRESETS: GroupPreset[] = BASE.flatMap((layout, i) =>
  [0, 1, 2, 3].map((variant) => ({
    id: `formation-${i}-${variant}`,
    name: `${layout.name}${variant === 0 ? "" : variant === 1 ? " · Mirrored" : variant === 2 ? " · Quarter turn" : " · Reverse"}`,
    count: layout.members.length,
    description: layout.description,
    members: layout.members.map((m) => ({
      ...m,
      x: variant === 1 ? -m.x : variant === 3 ? -m.x : m.x,
      z: variant === 3 ? -m.z : m.z,
      yaw: (m.yaw + (variant === 2 ? 90 : variant === 3 ? 180 : variant === 1 ? 180 : 0)) % 360,
    })),
  })),
);

/** 18+ non-graphic mannequin staging references. No explicit anatomy or animation. */
const adult = (id: string, name: string, description: string, members: GroupMember[]): GroupPreset => ({
  id: `adult-${id}`, name, description, category: "adult", count: members.length, members,
});
const j = (x = 0, y = 0, z = 0) => ({ x, y, z });

export const ADULT_GROUP_PRESETS: GroupPreset[] = [
  adult("missionary", "Missionary", "One reclining figure with a second leaning forward above them", [
    { ...p("lie-up", 0, -0.08, 0), joints: { thighL: j(-28, 0, 16), thighR: j(-28, 0, -16), upperArmL: j(-32, 0, 34), upperArmR: j(-32, 0, -34) } },
    { ...p("kneel", 0, 0.38, 180), joints: { hips: j(18, 0, 0), spine: j(32, 0, 0), chest: j(18, 0, 0), upperArmL: j(-55, 0, 18), upperArmR: j(-55, 0, -18) }, lift: 0.12 },
  ]),
  adult("cowgirl", "Cowgirl", "One reclining figure and one upright straddling seated figure", [
    { ...p("lie-up", 0, 0, 0), joints: { upperArmL: j(-26, 0, 20), upperArmR: j(-26, 0, -20) } },
    { ...p("sit", 0, -0.02, 0), joints: { thighL: j(-85, 5, 32), thighR: j(-85, -5, -32), spine: j(-10, 0, 0), chest: j(-5, 0, 0), upperArmL: j(-12, 0, 30), upperArmR: j(-12, 0, -30) }, lift: 0.32 },
  ]),
  adult("reverse-cowgirl", "Reverse Cowgirl", "One reclining figure and one seated figure facing away", [
    { ...p("lie-up", 0, 0, 0), joints: { upperArmL: j(-15, 0, 22), upperArmR: j(-15, 0, -22) } },
    { ...p("sit", 0, 0.08, 180), joints: { thighL: j(-88, 6, 30), thighR: j(-88, -6, -30), spine: j(-16, 0, 0), upperArmL: j(-8, 0, 22), upperArmR: j(-8, 0, -22) }, lift: 0.34 },
  ]),
  adult("doggy-style", "Doggy Style", "Forward-leaning kneeling figure with another figure positioned behind", [
    { ...p("kneel", 0, -0.25, 0), joints: { hips: j(28, 0, 0), spine: j(36, 0, 0), chest: j(17, 0, 0), upperArmL: j(-66, 0, 12), upperArmR: j(-66, 0, -12), thighL: j(-28, 0, 6), thighR: j(-28, 0, -6) } },
    { ...p("kneel", 0, 0.54, 0), joints: { hips: j(7, 0, 0), spine: j(12, 0, 0), upperArmL: j(-20, 0, 28), upperArmR: j(-20, 0, -28) } },
  ]),
  adult("spooning", "Spooning", "Two side-lying figures facing in the same direction", [
    { ...p("lie-left", -0.12, -0.12, 0), joints: { thighL: j(-55, 0, 0), thighR: j(-38, 0, 0), upperArmL: j(-30, 0, -30) } },
    { ...p("lie-left", 0.22, 0.19, 0), joints: { thighL: j(-58, 0, 0), thighR: j(-42, 0, 0), upperArmR: j(-30, 0, -28) } },
  ]),
  adult("standing-face-to-face", "Standing Face-to-Face", "Two upright figures facing each other at close distance", [
    { ...p("stand", 0, -0.27, 0), joints: { upperArmL: j(-38, 0, 16), upperArmR: j(-38, 0, -16), forearmL: j(-50, 0, 0), forearmR: j(-50, 0, 0) } },
    { ...p("stand", 0, 0.27, 180), joints: { upperArmL: j(-36, 0, 18), upperArmR: j(-36, 0, -18), forearmL: j(-46, 0, 0), forearmR: j(-46, 0, 0) } },
  ]),
  adult("standing-from-behind", "Standing From Behind", "Two upright figures facing the same direction, close together", [
    { ...p("stand", 0, -0.27, 0), joints: { hips: j(10, 0, 0), spine: j(12, 0, 0), upperArmL: j(-26, 0, 18), upperArmR: j(-26, 0, -18) } },
    { ...p("stand", 0, 0.26, 0), joints: { upperArmL: j(-35, 0, 18), upperArmR: j(-35, 0, -18), forearmL: j(-45, 0, 0), forearmR: j(-45, 0, 0) } },
  ]),
  adult("seated-straddle", "Seated Straddle", "Face-to-face seated figures, one raised over the other's lap", [
    { ...p("sit", 0, 0.12, 0), joints: { upperArmL: j(-25, 0, 18), upperArmR: j(-25, 0, -18), thighL: j(-85, 8, 12), thighR: j(-85, -8, -12) } },
    { ...p("sit", 0, -0.19, 180), joints: { thighL: j(-83, 6, 35), thighR: j(-83, -6, -35), upperArmL: j(-44, 0, 28), upperArmR: j(-44, 0, -28) }, lift: 0.24 },
  ]),
  adult("lap-sitting", "Lap Sitting", "One seated figure with a second seated figure facing sideways", [
    { ...p("sit", -0.09, 0.14, 0), joints: { upperArmL: j(-30, 0, 16), upperArmR: j(-30, 0, -16) } },
    { ...p("sit", 0.1, -0.08, 90), joints: { thighL: j(-80, 8, 18), thighR: j(-80, -8, -18), upperArmL: j(-28, 0, 24) }, lift: 0.25 },
  ]),
  adult("side-lying-face-to-face", "Side-Lying Face-to-Face", "Two nearby side-reclining figures oriented toward each other", [
    { ...p("lie-left", -0.2, -0.1, 90), joints: { thighL: j(-55, 0, 0), thighR: j(-48, 0, 0), upperArmL: j(-30, 0, -26) } },
    { ...p("lie-right", 0.2, 0.1, -90), joints: { thighL: j(-48, 0, 0), thighR: j(-55, 0, 0), upperArmR: j(-30, 0, 26) } },
  ]),
  adult("kneeling-face-to-face", "Kneeling Face-to-Face", "Two kneeling figures facing each other", [
    { ...p("kneel", 0, -0.35, 0), joints: { spine: j(14, 0, 0), upperArmL: j(-38, 0, 20), upperArmR: j(-38, 0, -20) } },
    { ...p("kneel", 0, 0.35, 180), joints: { spine: j(14, 0, 0), upperArmL: j(-38, 0, 20), upperArmR: j(-38, 0, -20) } },
  ]),
  adult("edge-of-bed", "Edge of Bed", "One seated figure with another standing close in front; add bed prop if needed", [
    { ...p("sit", 0, -0.32, 0), joints: { thighL: j(-85, 5, 12), thighR: j(-85, -5, -12), spine: j(-4, 0, 0), upperArmL: j(-16, 0, 18), upperArmR: j(-16, 0, -18) } },
    { ...p("stand", 0, 0.31, 180), joints: { upperArmL: j(-32, 0, 15), upperArmR: j(-32, 0, -15), forearmL: j(-35, 0, 0), forearmR: j(-35, 0, 0) } },
  ]),
];


/** Optional solo/JOI posing references: non-graphic, single mannequin, no animation. */
const solo = (id: string, name: string, base: PresetId, description: string, joints: Partial<Pose>): GroupPreset => ({
  id: `solo-${id}`, name, description, category: "adult", count: 1,
  members: [{ pose: base, x: 0, z: 0, yaw: 0, joints }],
});

/** 18+ solo posing library; presets affect only the selected character. */
export const SOLO_ADULT_PRESETS: GroupPreset[] = [
  solo("front-facing-neutral", "JOI — Front-Facing Upright", "stand", "Standing upright with head turned toward the camera", { head: j(-6, 0, 0), upperArmL: j(-18, 0, 8), upperArmR: j(-18, 0, -8) }),
  solo("standing-hip-shift", "JOI — Standing Hip Shift", "stand", "Weight shifted to one hip", { hips: j(0, 0, 15), spine: j(0, 0, -10), thighL: j(-10, 0, 0), upperArmR: j(0, 0, -30) }),
  solo("standing-hand-waist", "JOI — Standing Hand at Waist", "stand", "One arm folded toward the waist", { upperArmL: j(-25, 0, 62), forearmL: j(-85, 0, 0), handL: j(15, 0, 0), hips: j(0, 0, 8) }),
  solo("standing-hands-waist", "JOI — Standing Hands at Waist", "stand", "Both elbows angled outward with hands near the waist", { upperArmL: j(-32, 0, 65), upperArmR: j(-32, 0, -65), forearmL: j(-75, 0, 0), forearmR: j(-75, 0, 0) }),
  solo("standing-head-tilt", "JOI — Standing Head Tilt", "stand", "Standing with a distinct head tilt", { head: j(-10, 15, 22), neck: j(-5, 5, 9), hips: j(0, 0, -8) }),
  solo("standing-hands-head", "JOI — Standing Hands Behind Head", "stand", "Both hands lifted around the head", { upperArmL: j(-90, 0, 105), upperArmR: j(-90, 0, -105), forearmL: j(-95, 0, 0), forearmR: j(-95, 0, 0) }),
  solo("standing-overhead-reach", "JOI — Standing One Arm Raised", "stand", "One arm lifted overhead", { upperArmL: j(-165, 0, 20), forearmL: j(-12, 0, 0), head: j(-8, 0, 0) }),
  solo("standing-torso-twist", "JOI — Standing Torso Twist", "stand", "Torso and head turned in different directions", { hips: j(0, 16, 0), spine: j(0, -30, 10), chest: j(0, -16, 0), head: j(-3, 35, 0) }),
  solo("standing-one-knee", "JOI — Standing One Knee Lift", "stand", "One leg lifted while remaining upright", { thighL: j(-65, 0, 12), shinL: j(95, 0, 0), upperArmR: j(-25, 0, -30) }),
  solo("standing-lean-forward", "JOI — Standing Forward Lean", "lean", "Torso leaning toward the camera", { hips: j(32, 0, 0), spine: j(22, 0, 0), upperArmL: j(-44, 0, 12), upperArmR: j(-44, 0, -12) }),
  solo("seated-forward", "JOI — Seated Forward Gaze", "sit", "Seated upright with gaze directed forward", { spine: j(15, 0, 0), chest: j(8, 0, 0), head: j(-16, 0, 0) }),
  solo("seated-lean-back", "JOI — Seated Lean Back", "sit", "Seated with torso leaning backward", { spine: j(-18, 0, 0), chest: j(-15, 0, 0), upperArmL: j(20, 0, 40), upperArmR: j(20, 0, -40) }),
  solo("seated-one-knee-raised", "JOI — Seated One Knee Raised", "sit", "One knee pulled higher than the other", { thighL: j(-62, 0, -5), shinL: j(115, 0, 0), thighR: j(-88, 0, 0), upperArmL: j(-50, 0, 20) }),
  solo("seated-wide-knees", "JOI — Seated Wide-Knee Pose", "sit", "Seated with knees angled outward", { thighL: j(-82, 20, 25), thighR: j(-82, -20, -25), upperArmL: j(-40, 0, 35), upperArmR: j(-40, 0, -35) }),
  solo("seated-cross-leg", "JOI — Seated Angled Legs", "sit", "Legs offset diagonally while seated", { thighL: j(-82, 18, -14), thighR: j(-80, -15, 14), shinL: j(95, 0, 0), shinR: j(104, 0, 0) }),
  solo("seated-hand-thigh", "JOI — Seated Hand on Thigh", "sit", "One arm resting toward the thigh", { upperArmL: j(-50, 0, 22), forearmL: j(-50, 0, 0), handL: j(25, 0, -10), head: j(-8, 0, 0) }),
  solo("seated-hands-thighs", "JOI — Seated Hands on Thighs", "sit", "Both forearms angled toward the legs", { upperArmL: j(-55, 0, 25), upperArmR: j(-55, 0, -25), forearmL: j(-42, 0, 0), forearmR: j(-42, 0, 0) }),
  solo("seated-side-twist", "JOI — Seated Side Twist", "sit", "Seated with a twisted torso and turned head", { hips: j(0, 8, 0), spine: j(0, 30, 0), chest: j(0, 17, 0), head: j(0, -24, 0) }),
  solo("seated-hand-chest", "JOI — Seated Hand at Chest", "sit", "One hand drawn toward the upper torso", { upperArmR: j(-65, 0, -46), forearmR: j(-92, 0, 0), handR: j(-15, 0, 0), head: j(-8, -10, 0) }),
  solo("seated-one-arm-up", "JOI — Seated One Arm Overhead", "sit", "Seated with one raised arm", { upperArmL: j(-156, 0, 20), forearmL: j(-35, 0, 0), head: j(-8, 0, 0) }),
  solo("seated-head-back", "JOI — Seated Head Back", "sit", "Seated with gaze lifted upward", { neck: j(-20, 0, 0), head: j(-23, 0, 0), chest: j(-12, 0, 0) }),
  solo("seated-legs-forward", "JOI — Seated Legs Extended", "sit", "Both lower legs stretched forward", { thighL: j(-88, 3, 0), thighR: j(-88, -3, 0), shinL: j(20, 0, 0), shinR: j(20, 0, 0) }),
  solo("kneeling-upright", "JOI — Kneeling Upright", "kneel", "Kneeling with straightened torso", { spine: j(-5, 0, 0), chest: j(0, 0, 0), head: j(-5, 0, 0) }),
  solo("kneeling-lean-back", "JOI — Kneeling Lean Back", "kneel", "Kneeling with torso angled backward", { spine: j(-25, 0, 0), chest: j(-17, 0, 0), head: j(6, 0, 0), upperArmL: j(20, 0, 12) }),
  solo("kneeling-forward", "JOI — Kneeling Forward Lean", "kneel", "Kneeling and leaning forward", { hips: j(22, 0, 0), spine: j(32, 0, 0), chest: j(14, 0, 0), upperArmL: j(-72, 0, 20), upperArmR: j(-72, 0, -20) }),
  solo("kneeling-one-arm-up", "JOI — Kneeling One Arm Raised", "kneel", "One arm elevated while kneeling", { upperArmR: j(-152, 0, -22), forearmR: j(-25, 0, 0), head: j(-8, 0, 5) }),
  solo("kneeling-hands-thighs", "JOI — Kneeling Hands on Thighs", "kneel", "Both arms directed toward the thighs", { upperArmL: j(-45, 0, 22), upperArmR: j(-45, 0, -22), forearmL: j(-50, 0, 0), forearmR: j(-50, 0, 0) }),
  solo("kneeling-side-turn", "JOI — Kneeling Side Turn", "kneel", "Kneeling with torso and head turned sideways", { spine: j(0, -22, 10), chest: j(0, -16, 0), head: j(-8, 30, 5), upperArmL: j(-35, 0, 35) }),
  solo("reclined-one-knee", "JOI — Reclined One Knee Raised", "lie-up", "Lying back with one knee lifted", { thighL: j(-58, 0, 4), shinL: j(98, 0, 0), upperArmR: j(-15, 0, -16) }),
  solo("reclined-both-knees", "JOI — Reclined Both Knees Raised", "lie-up", "Lying back with both knees bent upward", { thighL: j(-58, 4, 12), thighR: j(-58, -4, -12), shinL: j(100, 0, 0), shinR: j(100, 0, 0) }),
  solo("reclined-one-arm-high", "JOI — Reclined Arm Overhead", "lie-up", "Lying back with one arm extended overhead", { upperArmL: j(-160, 0, 20), forearmL: j(-25, 0, 0), head: j(-5, 0, 0) }),
  solo("reclined-hands-head", "JOI — Reclined Hands Behind Head", "lie-up", "Both arms bent near the head while reclined", { upperArmL: j(-112, 0, 80), upperArmR: j(-112, 0, -80), forearmL: j(-85, 0, 0), forearmR: j(-85, 0, 0) }),
  solo("reclined-arm-chest", "JOI — Reclined Hand at Chest", "lie-up", "One forearm resting across the upper torso", { upperArmL: j(-65, 0, 48), forearmL: j(-75, 0, 0), handL: j(-18, 0, 0) }),
  solo("reclined-head-turn", "JOI — Reclined Head Turn", "lie-up", "Head angled sideways while reclining", { head: j(-5, 34, 0), neck: j(0, 18, 0), upperArmR: j(-20, 0, -35) }),
  solo("reclined-leg-open", "JOI — Reclined Angled Legs", "lie-up", "Legs arranged at differing angles", { thighL: j(-30, 18, 20), thighR: j(-40, -18, -20), shinL: j(65, 0, 0), shinR: j(80, 0, 0) }),
  solo("reclined-arm-reach", "JOI — Reclined Forward Reach", "lie-up", "One arm reaching forward in a reclining pose", { upperArmR: j(-112, 0, -20), forearmR: j(-40, 0, 0), head: j(10, 0, 0) }),
  solo("side-lying-head-rest", "JOI — Side-Lying Head Rest", "lie-left", "Side-lying with hand near the head", { upperArmL: j(-48, 0, -28), forearmL: j(-94, 0, 0), head: j(0, 12, 0) }),
  solo("side-lying-one-knee", "JOI — Side-Lying One Knee Bent", "lie-left", "Side-lying with one knee drawn upward", { thighL: j(-85, 0, 0), thighR: j(-22, 0, 0), shinL: j(105, 0, 0) }),
  solo("side-lying-gaze-camera", "JOI — Side-Lying Camera Gaze", "lie-right", "Side-lying with face turned toward the viewer", { head: j(0, -40, 0), neck: j(0, -22, 0), upperArmL: j(-28, 0, -10) }),
  solo("side-lying-over-shoulder", "JOI — Side-Lying Over-Shoulder Look", "lie-right", "Side-lying with a strong over-shoulder look", { chest: j(0, 20, 0), neck: j(0, 30, 0), head: j(0, 25, 0) }),
  solo("side-lying-arm-reach", "JOI — Side-Lying Arm Reach", "lie-left", "Side-lying with one arm extended", { upperArmR: j(-118, 0, -25), forearmR: j(-42, 0, 0), head: j(-6, 0, 0) }),
  solo("face-down-head-side", "JOI — Face-Down Head Turn", "lie-down", "Lying face down with head turned to one side", { head: j(-16, 30, 0), neck: j(0, 20, 0), upperArmL: j(-35, 0, 30) }),
  solo("face-down-one-knee", "JOI — Face-Down One Knee Bent", "lie-down", "Lying face down with one knee bent", { thighR: j(-22, 0, -5), shinR: j(108, 0, 0), upperArmR: j(-55, 0, -30) }),
  solo("standing-shoulders-back", "JOI — Standing Shoulders Back", "stand", "Standing Shoulders Back — single-person pose reference", { spine: j(-8, 0, 0), chest: j(-15, 0, 0), upperArmL: j(12, 0, 12), upperArmR: j(12, 0, -12), head: j(-4, 0, 0) }),
  solo("standing-crossed-forearms", "JOI — Standing Crossed Forearms", "stand", "Standing Crossed Forearms — single-person pose reference", { upperArmL: j(-54, 0, 52), upperArmR: j(-54, 0, -52), forearmL: j(-110, 0, 0), forearmR: j(-110, 0, 0), head: j(-5, 0, 0) }),
  solo("standing-over-shoulder", "JOI — Standing Over-Shoulder Look", "stand", "Standing Over-Shoulder Look — single-person pose reference", { hips: j(0, 18, 0), spine: j(0, 23, 0), chest: j(0, 16, 0), neck: j(0, 30, 0), head: j(0, 33, 0) }),
  solo("standing-reaching-forward", "JOI — Standing Forward Reach", "stand", "Standing Forward Reach — single-person pose reference", { upperArmR: j(-82, -24, -27), forearmR: j(-25, 0, 0), handR: j(10, -8, 0), spine: j(10, 0, 0) }),
  solo("standing-two-arm-reach", "JOI — Standing Two-Arm Reach", "stand", "Standing Two-Arm Reach — single-person pose reference", { upperArmL: j(-88, 0, 10), upperArmR: j(-88, 0, -10), forearmL: j(-10, 0, 0), forearmR: j(-10, 0, 0), head: j(-8, 0, 0) }),
  solo("standing-back-step", "JOI — Standing Back-Step Stance", "stand", "Standing Back-Step Stance — single-person pose reference", { thighR: j(24, 0, -8), shinR: j(24, 0, 0), hips: j(5, 0, 6), upperArmL: j(-25, 0, 16) }),
  solo("standing-open-arms", "JOI — Standing Open Arms", "stand", "Standing Open Arms — single-person pose reference", { upperArmL: j(-18, 0, 95), upperArmR: j(-18, 0, -95), forearmL: j(-12, 0, 0), forearmR: j(-12, 0, 0) }),
  solo("standing-half-crouch", "JOI — Standing Half-Crouch", "stand", "Standing Half-Crouch — single-person pose reference", { hips: j(16, 0, 0), thighL: j(-38, 0, 12), thighR: j(-38, 0, -12), shinL: j(66, 0, 0), shinR: j(66, 0, 0), upperArmL: j(-42, 0, 20), upperArmR: j(-42, 0, -20) }),
  solo("standing-hand-chest", "JOI — Standing Hand on Chest", "stand", "Standing Hand on Chest — single-person pose reference", { upperArmR: j(-54, 0, -40), forearmR: j(-105, 0, 0), handR: j(-20, 0, 0), head: j(-7, 12, 0) }),
  solo("standing-hand-forehead", "JOI — Standing Hand at Forehead", "stand", "Standing Hand at Forehead — single-person pose reference", { upperArmL: j(-92, 0, 54), forearmL: j(-122, 0, 0), handL: j(-20, 0, 5), head: j(-16, 0, 0) }),
  solo("seated-elbows-knees", "JOI — Seated Elbows on Knees", "sit", "Seated Elbows on Knees — single-person pose reference", { spine: j(34, 0, 0), chest: j(18, 0, 0), upperArmL: j(-75, 0, 18), upperArmR: j(-75, 0, -18), forearmL: j(-40, 0, 0), forearmR: j(-40, 0, 0) }),
  solo("seated-side-reach", "JOI — Seated Side Reach", "sit", "Seated Side Reach — single-person pose reference", { spine: j(0, 0, 24), chest: j(0, 0, 12), upperArmR: j(-135, 0, -45), head: j(-8, 0, -12) }),
  solo("seated-foot-tucked", "JOI — Seated Foot Tucked", "sit", "Seated Foot Tucked — single-person pose reference", { thighR: j(-96, -15, -12), shinR: j(136, 0, 0), thighL: j(-76, 10, 5), shinL: j(82, 0, 0), spine: j(-6, 0, 0) }),
  solo("seated-both-arms-raised", "JOI — Seated Both Arms Raised", "sit", "Seated Both Arms Raised — single-person pose reference", { upperArmL: j(-162, 0, 35), upperArmR: j(-162, 0, -35), forearmL: j(-18, 0, 0), forearmR: j(-18, 0, 0), head: j(-9, 0, 0) }),
  solo("seated-folded-arms", "JOI — Seated Folded Arms", "sit", "Seated Folded Arms — single-person pose reference", { upperArmL: j(-65, 0, 58), upperArmR: j(-65, 0, -58), forearmL: j(-108, 0, 0), forearmR: j(-108, 0, 0), spine: j(-5, 0, 0) }),
  solo("seated-over-shoulder", "JOI — Seated Over-Shoulder Look", "sit", "Seated Over-Shoulder Look — single-person pose reference", { hips: j(0, 10, 0), spine: j(0, 28, 0), chest: j(0, 18, 0), neck: j(0, 24, 0), head: j(0, 32, 0) }),
  solo("kneeling-hand-chest", "JOI — Kneeling Hand at Chest", "kneel", "Kneeling Hand at Chest — single-person pose reference", { upperArmL: j(-62, 0, 50), forearmL: j(-96, 0, 0), handL: j(-10, 0, 0), head: j(-12, 10, 0) }),
  solo("kneeling-arms-forward", "JOI — Kneeling Both Arms Forward", "kneel", "Kneeling Both Arms Forward — single-person pose reference", { upperArmL: j(-98, 0, 12), upperArmR: j(-98, 0, -12), forearmL: j(-18, 0, 0), forearmR: j(-18, 0, 0), spine: j(8, 0, 0) }),
  solo("kneeling-one-knee-high", "JOI — Kneeling One Knee Lift", "kneel", "Kneeling One Knee Lift — single-person pose reference", { thighL: j(-94, 0, 8), shinL: j(74, 0, 0), thighR: j(-7, 0, -8), shinR: j(105, 0, 0), spine: j(-12, 0, 0) }),
  solo("kneeling-gaze-up", "JOI — Kneeling Gaze Up", "kneel", "Kneeling Gaze Up — single-person pose reference", { spine: j(-13, 0, 0), chest: j(-15, 0, 0), neck: j(-25, 0, 0), head: j(-25, 0, 0) }),
  solo("kneeling-side-bend", "JOI — Kneeling Side Bend", "kneel", "Kneeling Side Bend — single-person pose reference", { spine: j(0, 0, 25), chest: j(0, 0, 18), upperArmL: j(-140, 0, 30), head: j(-8, 0, -10) }),
  solo("reclined-crossed-ankles", "JOI — Reclined Crossed Ankles", "lie-up", "Reclined Crossed Ankles — single-person pose reference", { thighL: j(-10, 10, 5), thighR: j(-7, -10, -5), shinL: j(15, 0, 0), shinR: j(18, 0, 0), footL: j(20, 0, 15), footR: j(10, 0, -15) }),
  solo("reclined-diagonal-reach", "JOI — Reclined Diagonal Reach", "lie-up", "Reclined Diagonal Reach — single-person pose reference", { upperArmR: j(-126, 0, -65), forearmR: j(-35, 0, 0), chest: j(0, 12, 0), head: j(-4, 18, 0) }),
  solo("reclined-hands-waist", "JOI — Reclined Hands at Waist", "lie-up", "Reclined Hands at Waist — single-person pose reference", { upperArmL: j(-42, 0, 65), upperArmR: j(-42, 0, -65), forearmL: j(-82, 0, 0), forearmR: j(-82, 0, 0) }),
  solo("reclined-torso-turn", "JOI — Reclined Torso and Head Turn", "lie-up", "Reclined Torso and Head Turn — single-person pose reference", { spine: j(0, 22, 0), chest: j(0, 20, 0), neck: j(0, -14, 0), head: j(0, -30, 0) }),
  solo("side-lying-both-knees", "JOI — Side-Lying Both Knees Tucked", "lie-right", "Side-Lying Both Knees Tucked — single-person pose reference", { thighL: j(-72, 0, 3), thighR: j(-72, 0, -3), shinL: j(108, 0, 0), shinR: j(108, 0, 0), upperArmR: j(-32, 0, 22) }),
  solo("side-lying-supported-head", "JOI — Side-Lying Supported Head", "lie-left", "Side-Lying Supported Head — single-person pose reference", { upperArmL: j(-62, 0, -38), forearmL: j(-125, 0, 0), handL: j(20, 0, 0), head: j(0, 8, 14), neck: j(0, 10, 0) }),
  solo("face-down-open-arms", "JOI — Face-Down Arms Wide", "lie-down", "Face-Down Arms Wide — single-person pose reference", { upperArmL: j(-14, 0, 98), upperArmR: j(-14, 0, -98), forearmL: j(-5, 0, 0), forearmR: j(-5, 0, 0), head: j(-12, 25, 0) }),
  solo("face-down-forearm-support", "JOI — Face-Down Forearm Support", "lie-down", "Face-Down Forearm Support — single-person pose reference", { spine: j(-20, 0, 0), chest: j(-23, 0, 0), upperArmL: j(-70, 0, 30), upperArmR: j(-70, 0, -30), forearmL: j(-108, 0, 0), forearmR: j(-108, 0, 0) }),
  solo("face-down-offset-legs", "JOI — Face-Down Offset Legs", "lie-down", "Face-Down Offset Legs — single-person pose reference", { thighL: j(-18, 12, 9), thighR: j(8, -12, -8), shinL: j(100, 0, 0), shinR: j(20, 0, 0), head: j(-20, -15, 0) }),
];

/** Does not create, remove or move other characters; camera and props stay intact. */
export function applySoloAdultPreset(project: Project, preset: GroupPreset, selectedId: string): void {
  if (preset.count !== 1 || preset.category !== "adult" || !preset.id.startsWith("solo-")) return;
  const character = project.characters.find((item) => item.id === selectedId);
  const member = preset.members[0];
  if (!character || !member) return;
  applyPreset(character, member.pose, true);
  if (member.joints) {
    character.pose = character.jointLimits
      ? clampPose({ ...character.pose, ...member.joints }, true)
      : { ...character.pose, ...member.joints };
    // The model's sculpted surfaces, not merely the joint points, must clear the floor.
    placeBodyOnFloor(character);
  }
}

export function applyGroupPreset(project: Project, preset: GroupPreset): void {
  // Keep extra characters already in the project; the user controls deleting them.
  while (project.characters.length < preset.count) {
    project.characters.push(createCharacter({ name: nextCharacterName(project) }));
  }
  const existing = project.characters.slice(0, preset.count);
  const originX = existing.reduce((s, c) => s + c.position.x, 0) / existing.length;
  const originZ = existing.reduce((s, c) => s + c.position.z, 0) / existing.length;
  preset.members.forEach((member, i) => {
    const character = project.characters[i]!;
    character.position = { x: originX + member.x, y: 0, z: originZ + member.z };
    character.rotation = { x: 0, y: member.yaw, z: 0 };
    applyPreset(character, member.pose, true);
    if (member.joints) {
      character.pose = character.jointLimits
        ? clampPose({ ...character.pose, ...member.joints }, true)
        : { ...character.pose, ...member.joints };
      const points = Object.values(worldJoints(character.pose, character.position, character.rotation, character.scale));
      character.position.y += lowestJointDelta(points);
    }
    character.position.y += member.lift ?? 0;
  });
}
