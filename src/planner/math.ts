export type Vec3 = { x: number; y: number; z: number };
export type EulerDeg = { x: number; y: number; z: number };

export function v(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function mul(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function hadamard(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function len(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function norm(a: Vec3): Vec3 {
  const l = len(a);
  if (l < 1e-8) return { x: 0, y: 0, z: 0 };
  return mul(a, 1 / l);
}

export function dist(a: Vec3, b: Vec3): number {
  return len(sub(a, b));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpV(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function rad(d: number): number {
  return (d * Math.PI) / 180;
}

export function smoothstep(u: number): number {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Row-major 3×3 matching Three.js Euler order XYZ. */
export function eulerXYZMatrix(e: EulerDeg): number[] {
  const x = rad(e.x);
  const y = rad(e.y);
  const z = rad(e.z);
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const ee = Math.cos(z);
  const f = Math.sin(z);
  const ae = a * ee;
  const af = a * f;
  const be = b * ee;
  const bf = b * f;
  return [
    c * ee,
    -c * f,
    d,
    af + be * d,
    ae - bf * d,
    -b * c,
    bf - ae * d,
    be + af * d,
    a * c,
  ];
}

export function rotX(degrees: number): number[] {
  return eulerXYZMatrix({ x: degrees, y: 0, z: 0 });
}

export function rotY(degrees: number): number[] {
  return eulerXYZMatrix({ x: 0, y: degrees, z: 0 });
}

export function mulMat(a: number[], b: number[]): number[] {
  const o = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] =
        a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

export function mulMatVec(m: number[], p: Vec3): Vec3 {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2] * p.z,
    y: m[3] * p.x + m[4] * p.y + m[5] * p.z,
    z: m[6] * p.x + m[7] * p.y + m[8] * p.z,
  };
}

export function rotateEuler(e: EulerDeg, p: Vec3): Vec3 {
  return mulMatVec(eulerXYZMatrix(e), p);
}

/** Right-hand rotation around Y. Positive is counter-clockwise from above. */
export function rotateY(p: Vec3, degrees: number): Vec3 {
  const t = rad(degrees);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: p.x * c - p.z * s, y: p.y, z: p.x * s + p.z * c };
}

export function rotateAround(p: Vec3, axis: Vec3, degrees: number): Vec3 {
  const k = norm(axis);
  if (len(k) < 1e-8) return { ...p };
  const t = rad(degrees);
  const c = Math.cos(t);
  const s = Math.sin(t);
  const d = dot(k, p);
  const cr = cross(k, p);
  return add(add(mul(p, c), mul(cr, s)), mul(k, d * (1 - c)));
}

export function angleBetween(a: Vec3, b: Vec3): number {
  const na = norm(a);
  const nb = norm(b);
  if (len(na) < 1e-8 || len(nb) < 1e-8) return 0;
  return deg(Math.acos(clamp(dot(na, nb), -1, 1)));
}

/** Inverse of eulerXYZMatrix, matching Three.js order XYZ. Degrees. */
export function eulerXYZFromMatrix(m: number[]): EulerDeg {
  const m13 = m[2];
  const m23 = m[5];
  const m33 = m[8];
  const m12 = m[1];
  const m11 = m[0];
  const m32 = m[7];
  const m22 = m[4];
  const y = Math.asin(clamp(m13, -1, 1));
  let x: number;
  let z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(m32, m22);
    z = 0;
  }
  return { x: deg(x), y: deg(y), z: deg(z) };
}

export function compassName(dir: Vec3): string {
  const h = Math.hypot(dir.x, dir.z);
  if (h < 1e-5) return dir.y >= 0 ? "upward" : "downward";
  const ang = (deg(Math.atan2(dir.x, dir.z)) + 360) % 360;
  const names = [
    "north",
    "north-east",
    "east",
    "south-east",
    "south",
    "south-west",
    "west",
    "north-west",
  ];
  return names[Math.round(ang / 45) % 8] ?? "north";
}

export function fmtNum(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "0";
  const m = 10 ** digits;
  return String(Math.round(n * m) / m);
}

export function cloneVec(p: Vec3): Vec3 {
  return { x: p.x, y: p.y, z: p.z };
}

export function cloneEuler(e: EulerDeg): EulerDeg {
  return { x: e.x, y: e.y, z: e.z };
}
