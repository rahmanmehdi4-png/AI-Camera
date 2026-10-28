/** Shared surfaces keep rendering and floor contact identical. Metres; +Z forward. */
import { eulerXYZMatrix, hadamard, mulMat, mulMatVec } from "./math.ts";
import { fkLocal, JOINTS, type JointId } from "./skeleton.ts";
import type { Character } from "./project.ts";
export const MANNEQUIN_REVISION = "sculpted-2.1";
type Ring = [y: number, halfWidth: number, halfDepth: number, forward?: number];
export type Surface = { positions: number[]; indices: number[] };
const SEGMENTS = 16;
function loft(rings: Ring[]): Surface {
  const positions: number[] = [],
    indices: number[] = [];
  for (const [y, w, d, z = 0] of rings)
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i * Math.PI * 2) / SEGMENTS;
      positions.push(Math.cos(a) * w, y, z + Math.sin(a) * d);
    }
  for (let r = 0; r < rings.length - 1; r++)
    for (let i = 0; i < SEGMENTS; i++) {
      const a = r * SEGMENTS + i,
        b = r * SEGMENTS + ((i + 1) % SEGMENTS);
      indices.push(a, a + SEGMENTS, b, b, a + SEGMENTS, b + SEGMENTS);
    }
  for (const end of [0, rings.length - 1]) {
    const [y, , , z = 0] = rings[end]!,
      centre = positions.length / 3;
    positions.push(0, y, z);
    for (let i = 0; i < SEGMENTS; i++) {
      const a = end * SEGMENTS + i,
        b = end * SEGMENTS + ((i + 1) % SEGMENTS);
      indices.push(...(end === 0 ? [centre, a, b] : [centre, b, a]));
    }
  }
  return { positions, indices };
}
function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number): Surface {
  const rings: Ring[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i * Math.PI) / 10;
    rings.push([
      y - Math.cos(a) * ry,
      Math.max(0.0001, Math.sin(a) * rx),
      Math.max(0.0001, Math.sin(a) * rz),
      z,
    ]);
  }
  const out = loft(rings);
  for (let i = 0; i < out.positions.length; i += 3) out.positions[i]! += x;
  return out;
}
function merge(...surfaces: Surface[]): Surface {
  const out: Surface = { positions: [], indices: [] };
  for (const s of surfaces) {
    const n = out.positions.length / 3;
    out.positions.push(...s.positions);
    out.indices.push(...s.indices.map((i) => i + n));
  }
  return out;
}
function hand(side: number): Surface {
  const shapes = [
    loft([
      [-0.085, 0.031, 0.018, 0.006],
      [-0.065, 0.039, 0.022, 0.004],
      [-0.025, 0.035, 0.024],
      [0.012, 0.024, 0.022],
    ]),
  ];
  // Distinct rounded fingers and opposing thumb, without adding more joints.
  for (let i = 0; i < 4; i++) {
    const length = [0.055, 0.067, 0.062, 0.045][i]!;
    shapes.push(
      ellipsoid(side * (0.027 - i * 0.018), -0.078 - length / 2, 0.008, 0.01, length / 2, 0.015),
    );
  }
  const thumb = ellipsoid(0, 0, 0, 0.014, 0.035, 0.017),
    angle = side * -0.55;
  for (let i = 0; i < thumb.positions.length; i += 3) {
    const x = thumb.positions[i]!,
      y = thumb.positions[i + 1]!;
    thumb.positions[i] = Math.cos(angle) * x - Math.sin(angle) * y + side * 0.045;
    thumb.positions[i + 1] = Math.sin(angle) * x + Math.cos(angle) * y - 0.04;
    thumb.positions[i + 2]! += 0.016;
  }
  return merge(...shapes, thumb);
}
const pelvis = loft([
  [-0.115, 0.082, 0.068],
  [-0.08, 0.137, 0.099],
  [-0.025, 0.164, 0.108, -0.008],
  [0.045, 0.158, 0.101, -0.005],
  [0.1, 0.13, 0.086],
  [0.135, 0.118, 0.079],
]);
const abdomen = loft([
  [-0.055, 0.126, 0.086],
  [0, 0.12, 0.084],
  [0.06, 0.125, 0.087],
  [0.12, 0.143, 0.094],
  [0.18, 0.155, 0.098],
]);
const chest = loft([
  [-0.08, 0.137, 0.092],
  [-0.025, 0.164, 0.108],
  [0.04, 0.184, 0.116, 0.003],
  [0.11, 0.193, 0.107],
  [0.16, 0.19, 0.088],
  [0.195, 0.153, 0.068],
  [0.222, 0.069, 0.049],
]);
const upperArm = loft([
  [-0.291, 0.034, 0.034],
  [-0.263, 0.042, 0.042],
  [-0.22, 0.047, 0.049],
  [-0.15, 0.055, 0.061],
  [-0.075, 0.066, 0.064],
  [-0.015, 0.073, 0.067],
  [0.035, 0.051, 0.051],
  [0.055, 0.012, 0.012],
]);
const forearm = loft([
  [-0.26, 0.023, 0.023],
  [-0.22, 0.027, 0.028],
  [-0.15, 0.037, 0.037],
  [-0.08, 0.047, 0.045],
  [-0.025, 0.044, 0.041],
  [0.019, 0.031, 0.032],
]);
const thigh = loft([
  [-0.452, 0.04, 0.044],
  [-0.415, 0.055, 0.06],
  [-0.34, 0.065, 0.07, 0.006],
  [-0.24, 0.079, 0.087, 0.004],
  [-0.13, 0.09, 0.1, -0.005],
  [-0.025, 0.093, 0.098, -0.007],
  [0.035, 0.064, 0.068],
  [0.06, 0.012, 0.015],
]);
const shin = loft([
  [-0.431, 0.029, 0.035],
  [-0.38, 0.033, 0.041],
  [-0.28, 0.044, 0.054, -0.009],
  [-0.18, 0.059, 0.07, -0.015],
  [-0.09, 0.062, 0.065, -0.006],
  [-0.025, 0.05, 0.052, 0.006],
  [0.025, 0.037, 0.039],
]);
const foot = merge(
  ellipsoid(0, 0.002, 0, 0.039, 0.039, 0.052),
  ellipsoid(0, -0.009, 0.073, 0.051, 0.028, 0.111),
  ellipsoid(0, -0.014, 0.149, 0.055, 0.023, 0.045),
);
const head = merge(
  loft([
    [-0.055, 0.041, 0.044, 0.02],
    [-0.035, 0.061, 0.066, 0.022],
    [0, 0.082, 0.085, 0.008],
    [0.05, 0.096, 0.096],
    [0.11, 0.098, 0.1, -0.004],
    [0.16, 0.085, 0.089, -0.009],
    [0.195, 0.048, 0.058, -0.01],
    [0.205, 0.003, 0.004],
  ]),
  ellipsoid(-0.098, 0.055, -0.004, 0.014, 0.035, 0.024),
  ellipsoid(0.098, 0.055, -0.004, 0.014, 0.035, 0.024),
  ellipsoid(0, 0.035, 0.104, 0.018, 0.033, 0.027),
);
export const BODY_SURFACES: Record<JointId, Surface> = {
  hips: pelvis,
  spine: abdomen,
  chest,
  head,
  neck: loft([
    [-0.035, 0.045, 0.044],
    [0.01, 0.043, 0.043],
    [0.08, 0.042, 0.04],
    [0.11, 0.046, 0.043],
  ]),
  shoulderL: ellipsoid(0.055, -0.004, 0, 0.093, 0.051, 0.063),
  shoulderR: ellipsoid(-0.055, -0.004, 0, 0.093, 0.051, 0.063),
  upperArmL: upperArm,
  upperArmR: upperArm,
  forearmL: forearm,
  forearmR: forearm,
  handL: hand(-1),
  handR: hand(1),
  thighL: thigh,
  thighR: thigh,
  shinL: shin,
  shinR: shin,
  footL: foot,
  footR: foot,
};
export const FACE_SURFACE = merge(
  ellipsoid(-0.034, 0.071, 0.092, 0.014, 0.008, 0.01),
  ellipsoid(0.034, 0.071, 0.092, 0.014, 0.008, 0.01),
  ellipsoid(0, -0.012, 0.088, 0.025, 0.003, 0.006),
);
export function bodyBulk(bulk: number): number {
  return Math.min(1.8, Math.max(0.45, bulk));
}
/** Exact minimum of rendered vertices including arbitrary root rotation and scale. */
export function lowestBodyY(character: Character): number {
  const fk = fkLocal(character.pose),
    root = eulerXYZMatrix(character.rotation),
    bulk = bodyBulk(character.bulk);
  const scaledRoot = root.slice();
  for (let r = 0; r < 3; r++) {
    scaledRoot[r * 3]! *= character.scale.x;
    scaledRoot[r * 3 + 1]! *= character.scale.y;
    scaledRoot[r * 3 + 2]! *= character.scale.z;
  }
  let minimum = Infinity;
  for (const id of JOINTS) {
    const joint = fk[id],
      origin = mulMatVec(root, hadamard(joint.position, character.scale)),
      matrix = mulMat(scaledRoot, joint.rotation),
      p = BODY_SURFACES[id].positions;
    for (let i = 0; i < p.length; i += 3)
      minimum = Math.min(
        minimum,
        character.position.y +
          origin.y +
          matrix[3]! * p[i]! * bulk +
          matrix[4]! * p[i + 1]! +
          matrix[5]! * p[i + 2]! * bulk,
      );
  }
  return minimum;
}
export function placeBodyOnFloor(character: Character, floor = 0): void {
  character.position.y += floor + 0.003 - lowestBodyY(character);
}
