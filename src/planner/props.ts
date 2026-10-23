import { add, eulerXYZMatrix, mulMatVec, v, type EulerDeg, type Vec3 } from "./math.ts";

export const PROP_KINDS = [
  "block",
  "sphere",
  "cylinder",
  "capsule",
  "plane",
  "bed",
  "sofa",
  "chair",
  "table",
  "pillow",
  "wall",
  "room",
] as const;

export type PropKind = (typeof PROP_KINDS)[number];

export type PropCategory = "Primitives" | "Furniture" | "Room";

export type PropSpec = {
  kind: PropKind;
  label: string;
  category: PropCategory;
  /** Full size in metres at scale 1, centred on the object origin. */
  size: Vec3;
  color: string;
};

export const PROP_LIBRARY: readonly PropSpec[] = [
  { kind: "block", label: "Block", category: "Primitives", size: v(0.6, 0.6, 0.6), color: "#c4b8a4" },
  { kind: "sphere", label: "Sphere", category: "Primitives", size: v(0.5, 0.5, 0.5), color: "#b7c4c2" },
  { kind: "cylinder", label: "Cylinder", category: "Primitives", size: v(0.4, 0.8, 0.4), color: "#d2c2a8" },
  { kind: "capsule", label: "Capsule", category: "Primitives", size: v(0.32, 0.9, 0.32), color: "#c9c1b4" },
  { kind: "plane", label: "Plane", category: "Primitives", size: v(2, 0.02, 2), color: "#8e99a4" },
  { kind: "bed", label: "Bed", category: "Furniture", size: v(1.6, 0.55, 2.1), color: "#d7d0c4" },
  { kind: "sofa", label: "Sofa", category: "Furniture", size: v(1.9, 0.85, 0.85), color: "#8d9a96" },
  { kind: "chair", label: "Chair", category: "Furniture", size: v(0.52, 0.9, 0.52), color: "#c3a27a" },
  { kind: "table", label: "Table", category: "Furniture", size: v(1.3, 0.75, 0.75), color: "#b08968" },
  { kind: "pillow", label: "Pillow", category: "Furniture", size: v(0.65, 0.16, 0.4), color: "#ece4d6" },
  { kind: "wall", label: "Wall", category: "Room", size: v(2.6, 2.4, 0.12), color: "#d5dbe2" },
  { kind: "room", label: "Room corner", category: "Room", size: v(4, 2.4, 4), color: "#cfd6de" },
];

export function propSpec(kind: PropKind): PropSpec {
  const found = PROP_LIBRARY.find((item) => item.kind === kind);
  if (!found) throw new Error(`Unknown prop: ${kind}`);
  return found;
}

export type Aabb = { min: Vec3; max: Vec3 };

export function propAabb(kind: PropKind, position: Vec3, rotation: EulerDeg, scale: Vec3): Aabb {
  const size = propSpec(kind).size;
  const half = v((size.x * scale.x) / 2, (size.y * scale.y) / 2, (size.z * scale.z) / 2);
  const rot = eulerXYZMatrix(rotation);
  let min = v(Infinity, Infinity, Infinity);
  let max = v(-Infinity, -Infinity, -Infinity);
  for (const x of [-half.x, half.x]) {
    for (const y of [-half.y, half.y]) {
      for (const z of [-half.z, half.z]) {
        const p = add(position, mulMatVec(rot, v(x, y, z)));
        min = v(Math.min(min.x, p.x), Math.min(min.y, p.y), Math.min(min.z, p.z));
        max = v(Math.max(max.x, p.x), Math.max(max.y, p.y), Math.max(max.z, p.z));
      }
    }
  }
  return { min, max };
}

export function pointInAabb(p: Vec3, box: Aabb, pad = 0): boolean {
  return (
    p.x >= box.min.x - pad &&
    p.x <= box.max.x + pad &&
    p.y >= box.min.y - pad &&
    p.y <= box.max.y + pad &&
    p.z >= box.min.z - pad &&
    p.z <= box.max.z + pad
  );
}

export function surfaceFraction(kind: PropKind): number {
  if (kind === "chair") return 0.5;
  if (kind === "sofa") return 0.46;
  if (kind === "bed") return 0.78;
  if (kind === "table") return 0.96;
  if (kind === "pillow") return 0.7;
  return 1;
}

export function surfaceY(kind: PropKind, box: Aabb): number {
  return box.min.y + (box.max.y - box.min.y) * surfaceFraction(kind);
}

export const SEAT_KINDS: readonly PropKind[] = ["chair", "sofa", "bed", "table"];
export const LIE_KINDS: readonly PropKind[] = ["bed", "sofa"];

