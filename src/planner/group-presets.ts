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
  solo("front-facing-neutral", "Front-Facing Upright", "stand", "Standing upright with head turned toward the camera", { head: j(-6, 0, 0), upperArmL: j(-18, 0, 8), upperArmR: j(-18, 0, -8) }),
  solo("standing-hip-shift", "Standing Hip Shift", "stand", "Weight shifted to one hip", { hips: j(0, 0, 15), spine: j(0, 0, -10), thighL: j(-10, 0, 0), upperArmR: j(0, 0, -30) }),
  solo("standing-hand-waist", "Standing Hand at Waist", "stand", "One arm folded toward the waist", { upperArmL: j(-25, 0, 62), forearmL: j(-85, 0, 0), handL: j(15, 0, 0), hips: j(0, 0, 8) }),
  solo("standing-hands-waist", "Standing Hands at Waist", "stand", "Both elbows angled outward with hands near the waist", { upperArmL: j(-32, 0, 65), upperArmR: j(-32, 0, -65), forearmL: j(-75, 0, 0), forearmR: j(-75, 0, 0) }),
  solo("standing-head-tilt", "Standing Head Tilt", "stand", "Standing with a distinct head tilt", { head: j(-10, 15, 22), neck: j(-5, 5, 9), hips: j(0, 0, -8) }),
  solo("standing-hands-head", "Standing Hands Behind Head", "stand", "Both hands lifted around the head", { upperArmL: j(-90, 0, 105), upperArmR: j(-90, 0, -105), forearmL: j(-95, 0, 0), forearmR: j(-95, 0, 0) }),
  solo("standing-overhead-reach", "Standing One Arm Raised", "stand", "One arm lifted overhead", { upperArmL: j(-165, 0, 20), forearmL: j(-12, 0, 0), head: j(-8, 0, 0) }),
  solo("standing-torso-twist", "Standing Torso Twist", "stand", "Torso and head turned in different directions", { hips: j(0, 16, 0), spine: j(0, -30, 10), chest: j(0, -16, 0), head: j(-3, 35, 0) }),
  solo("standing-one-knee", "Standing One Knee Lift", "stand", "One leg lifted while remaining upright", { thighL: j(-65, 0, 12), shinL: j(95, 0, 0), upperArmR: j(-25, 0, -30) }),
  solo("standing-lean-forward", "Standing Forward Lean", "lean", "Torso leaning toward the camera", { hips: j(32, 0, 0), spine: j(22, 0, 0), upperArmL: j(-44, 0, 12), upperArmR: j(-44, 0, -12) }),
  solo("seated-forward", "Seated Forward Gaze", "sit", "Seated upright with gaze directed forward", { spine: j(15, 0, 0), chest: j(8, 0, 0), head: j(-16, 0, 0) }),
  solo("seated-lean-back", "Seated Lean Back", "sit", "Seated with torso leaning backward", { spine: j(-18, 0, 0), chest: j(-15, 0, 0), upperArmL: j(20, 0, 40), upperArmR: j(20, 0, -40) }),
  solo("seated-one-knee-raised", "Seated One Knee Raised", "sit", "One knee pulled higher than the other", { thighL: j(-62, 0, -5), shinL: j(115, 0, 0), thighR: j(-88, 0, 0), upperArmL: j(-50, 0, 20) }),
  solo("seated-wide-knees", "Seated Wide-Knee Pose", "sit", "Seated with knees angled outward", { thighL: j(-82, 20, 25), thighR: j(-82, -20, -25), upperArmL: j(-40, 0, 35), upperArmR: j(-40, 0, -35) }),
  solo("seated-cross-leg", "Seated Angled Legs", "sit", "Legs offset diagonally while seated", { thighL: j(-82, 18, -14), thighR: j(-80, -15, 14), shinL: j(95, 0, 0), shinR: j(104, 0, 0) }),
  solo("seated-hand-thigh", "Seated Hand on Thigh", "sit", "One arm resting toward the thigh", { upperArmL: j(-50, 0, 22), forearmL: j(-50, 0, 0), handL: j(25, 0, -10), head: j(-8, 0, 0) }),
  solo("seated-hands-thighs", "Seated Hands on Thighs", "sit", "Both forearms angled toward the legs", { upperArmL: j(-55, 0, 25), upperArmR: j(-55, 0, -25), forearmL: j(-42, 0, 0), forearmR: j(-42, 0, 0) }),
  solo("seated-side-twist", "Seated Side Twist", "sit", "Seated with a twisted torso and turned head", { hips: j(0, 8, 0), spine: j(0, 30, 0), chest: j(0, 17, 0), head: j(0, -24, 0) }),
  solo("seated-hand-chest", "Seated Hand at Chest", "sit", "One hand drawn toward the upper torso", { upperArmR: j(-65, 0, -46), forearmR: j(-92, 0, 0), handR: j(-15, 0, 0), head: j(-8, -10, 0) }),
  solo("seated-one-arm-up", "Seated One Arm Overhead", "sit", "Seated with one raised arm", { upperArmL: j(-156, 0, 20), forearmL: j(-35, 0, 0), head: j(-8, 0, 0) }),
  solo("seated-head-back", "Seated Head Back", "sit", "Seated with gaze lifted upward", { neck: j(-20, 0, 0), head: j(-23, 0, 0), chest: j(-12, 0, 0) }),
  solo("seated-legs-forward", "Seated Legs Extended", "sit", "Both lower legs stretched forward", { thighL: j(-88, 3, 0), thighR: j(-88, -3, 0), shinL: j(20, 0, 0), shinR: j(20, 0, 0) }),
  solo("kneeling-upright", "Kneeling Upright", "kneel", "Kneeling with straightened torso", { spine: j(-5, 0, 0), chest: j(0, 0, 0), head: j(-5, 0, 0) }),
  solo("kneeling-lean-back", "Kneeling Lean Back", "kneel", "Kneeling with torso angled backward", { spine: j(-25, 0, 0), chest: j(-17, 0, 0), head: j(6, 0, 0), upperArmL: j(20, 0, 12) }),
  solo("kneeling-forward", "Kneeling Forward Lean", "kneel", "Kneeling and leaning forward", { hips: j(22, 0, 0), spine: j(32, 0, 0), chest: j(14, 0, 0), upperArmL: j(-72, 0, 20), upperArmR: j(-72, 0, -20) }),
  solo("kneeling-one-arm-up", "Kneeling One Arm Raised", "kneel", "One arm elevated while kneeling", { upperArmR: j(-152, 0, -22), forearmR: j(-25, 0, 0), head: j(-8, 0, 5) }),
  solo("kneeling-hands-thighs", "Kneeling Hands on Thighs", "kneel", "Both arms directed toward the thighs", { upperArmL: j(-45, 0, 22), upperArmR: j(-45, 0, -22), forearmL: j(-50, 0, 0), forearmR: j(-50, 0, 0) }),
  solo("kneeling-side-turn", "Kneeling Side Turn", "kneel", "Kneeling with torso and head turned sideways", { spine: j(0, -22, 10), chest: j(0, -16, 0), head: j(-8, 30, 5), upperArmL: j(-35, 0, 35) }),
  solo("reclined-one-knee", "Reclined One Knee Raised", "lie-up", "Lying back with one knee lifted", { thighL: j(-58, 0, 4), shinL: j(98, 0, 0), upperArmR: j(-15, 0, -16) }),
  solo("reclined-both-knees", "Reclined Both Knees Raised", "lie-up", "Lying back with both knees bent upward", { thighL: j(-58, 4, 12), thighR: j(-58, -4, -12), shinL: j(100, 0, 0), shinR: j(100, 0, 0) }),
  solo("reclined-one-arm-high", "Reclined Arm Overhead", "lie-up", "Lying back with one arm extended overhead", { upperArmL: j(-160, 0, 20), forearmL: j(-25, 0, 0), head: j(-5, 0, 0) }),
  solo("reclined-hands-head", "Reclined Hands Behind Head", "lie-up", "Both arms bent near the head while reclined", { upperArmL: j(-112, 0, 80), upperArmR: j(-112, 0, -80), forearmL: j(-85, 0, 0), forearmR: j(-85, 0, 0) }),
  solo("reclined-arm-chest", "Reclined Hand at Chest", "lie-up", "One forearm resting across the upper torso", { upperArmL: j(-65, 0, 48), forearmL: j(-75, 0, 0), handL: j(-18, 0, 0) }),
  solo("reclined-head-turn", "Reclined Head Turn", "lie-up", "Head angled sideways while reclining", { head: j(-5, 34, 0), neck: j(0, 18, 0), upperArmR: j(-20, 0, -35) }),
  solo("reclined-leg-open", "Reclined Angled Legs", "lie-up", "Legs arranged at differing angles", { thighL: j(-30, 18, 20), thighR: j(-40, -18, -20), shinL: j(65, 0, 0), shinR: j(80, 0, 0) }),
  solo("reclined-arm-reach", "Reclined Forward Reach", "lie-up", "One arm reaching forward in a reclining pose", { upperArmR: j(-112, 0, -20), forearmR: j(-40, 0, 0), head: j(10, 0, 0) }),
  solo("side-lying-head-rest", "Side-Lying Head Rest", "lie-left", "Side-lying with hand near the head", { upperArmL: j(-48, 0, -28), forearmL: j(-94, 0, 0), head: j(0, 12, 0) }),
  solo("side-lying-one-knee", "Side-Lying One Knee Bent", "lie-left", "Side-lying with one knee drawn upward", { thighL: j(-85, 0, 0), thighR: j(-22, 0, 0), shinL: j(105, 0, 0) }),
  solo("side-lying-gaze-camera", "Side-Lying Camera Gaze", "lie-right", "Side-lying with face turned toward the viewer", { head: j(0, -40, 0), neck: j(0, -22, 0), upperArmL: j(-28, 0, -10) }),
  solo("side-lying-over-shoulder", "Side-Lying Over-Shoulder Look", "lie-right", "Side-lying with a strong over-shoulder look", { chest: j(0, 20, 0), neck: j(0, 30, 0), head: j(0, 25, 0) }),
  solo("side-lying-arm-reach", "Side-Lying Arm Reach", "lie-left", "Side-lying with one arm extended", { upperArmR: j(-118, 0, -25), forearmR: j(-42, 0, 0), head: j(-6, 0, 0) }),
  solo("face-down-head-side", "Face-Down Head Turn", "lie-down", "Lying face down with head turned to one side", { head: j(-16, 30, 0), neck: j(0, 20, 0), upperArmL: j(-35, 0, 30) }),
  solo("face-down-one-knee", "Face-Down One Knee Bent", "lie-down", "Lying face down with one knee bent", { thighR: j(-22, 0, -5), shinR: j(108, 0, 0), upperArmR: j(-55, 0, -30) }),
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
