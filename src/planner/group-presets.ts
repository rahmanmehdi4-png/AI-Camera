/** Neutral, non-graphic multi-person blocking presets. No physical contact is inferred. */
import { applyPreset, createCharacter, nextCharacterName, type Project } from "./project.ts";
import type { PresetId } from "./skeleton.ts";

export type GroupPreset = {
  id: string;
  name: string;
  count: number;
  description: string;
  members: { pose: PresetId; x: number; z: number; yaw: number }[];
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
  });
}
