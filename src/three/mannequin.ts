import * as THREE from "three";
import type { Character } from "@/planner/project";
import { rad } from "@/planner/math";
import { BONES, boneLocal, JOINTS, type JointId } from "@/planner/skeleton";

const UP = new THREE.Vector3(0, 1, 0);
const GEO = {
  limb: new THREE.CylinderGeometry(0.82, 1, 1, 16),
  joint: new THREE.SphereGeometry(0.075, 12, 10),
  head: new THREE.SphereGeometry(1, 24, 18),
  pelvis: new THREE.SphereGeometry(1, 24, 16),
  chest: new THREE.SphereGeometry(1, 24, 16),
  hand: new THREE.SphereGeometry(1, 12, 10),
  foot: new THREE.SphereGeometry(1, 12, 10),
  nose: new THREE.BoxGeometry(0.045, 0.04, 0.1),
  eye: new THREE.SphereGeometry(0.018, 8, 8),
};

const LIMB_RADIUS: Partial<Record<JointId, number>> = {
  hips: 0.06,
  spine: 0.09,
  chest: 0.07,
  neck: 0.045,
  shoulderL: 0.045,
  shoulderR: 0.045,
  upperArmL: 0.045,
  upperArmR: 0.045,
  forearmL: 0.038,
  forearmR: 0.038,
  thighL: 0.06,
  thighR: 0.06,
  shinL: 0.05,
  shinR: 0.05,
};

export class Mannequin {
  readonly root = new THREE.Group();
  readonly pivots = {} as Record<JointId, THREE.Group>;
  readonly markers: THREE.Mesh[] = [];
  private readonly body: THREE.MeshStandardMaterial;
  private readonly ink: THREE.MeshStandardMaterial;
  private readonly markerMat: THREE.MeshStandardMaterial;
  private readonly limbs: THREE.Mesh[] = [];

  constructor(character: Character) {
    this.body = new THREE.MeshStandardMaterial({
      color: character.color,
      roughness: 0.7,
      metalness: 0.02,
    });
    this.ink = new THREE.MeshStandardMaterial({ color: "#23282f", roughness: 0.45, metalness: 0.08 });
    this.markerMat = new THREE.MeshStandardMaterial({ color: "#e39a4d", roughness: 0.35, metalness: 0.04, emissive: "#000000" });
    this.root.name = character.id;

    for (const bone of BONES) {
      const pivot = new THREE.Group();
      pivot.name = bone.id;
      this.pivots[bone.id] = pivot;
      const parent = bone.parent ? this.pivots[bone.parent] : this.root;
      parent.add(pivot);
      const local = boneLocal(bone.id);
      pivot.position.set(local.x, local.y, local.z);
    }

    this.addLimb("hips", character.id);
    this.addLimb("spine", character.id);
    this.addLimb("chest", character.id);
    this.addLimb("neck", character.id);
    for (const id of ["shoulderL", "upperArmL", "forearmL", "shoulderR", "upperArmR", "forearmR", "thighL", "shinL", "thighR", "shinR"] as JointId[]) {
      this.addLimb(id, character.id);
    }
    this.addVolume(this.pivots.hips, GEO.pelvis, this.body, character.id, 0.11);
    this.addVolume(this.pivots.chest, GEO.chest, this.body, character.id, 0.135);
    this.addHead(character.id);
    this.addEnd(this.pivots.handL, GEO.hand, character.id, new THREE.Vector3(0, -0.04, 0.01), new THREE.Vector3(0.047, 0.065, 0.03));
    this.addEnd(this.pivots.handR, GEO.hand, character.id, new THREE.Vector3(0, -0.04, 0.01), new THREE.Vector3(0.047, 0.065, 0.03));
    this.addEnd(this.pivots.footL, GEO.foot, character.id, new THREE.Vector3(0, -0.025, 0.06), new THREE.Vector3(0.065, 0.035, 0.13));
    this.addEnd(this.pivots.footR, GEO.foot, character.id, new THREE.Vector3(0, -0.025, 0.06), new THREE.Vector3(0.065, 0.035, 0.13));

    for (const id of JOINTS) {
      const marker = new THREE.Mesh(GEO.joint, this.markerMat.clone());
      marker.name = `marker-${id}`;
      marker.userData = { pick: "joint", id: character.id, joint: id };
      marker.castShadow = false;
      this.pivots[id].add(marker);
      this.markers.push(marker);
    }
    this.apply(character, null, false);
  }

  private addLimb(id: JointId, characterId: string) {
    const childId = BONES.find((bone) => bone.parent === id)?.id;
    const primary = primaryChild(id);
    if (!primary) return;
    const end = new THREE.Vector3(boneLocal(primary).x, boneLocal(primary).y, boneLocal(primary).z);
    const length = end.length();
    if (length < 0.02) return;
    const radius = LIMB_RADIUS[id] ?? 0.04;
    const mesh = new THREE.Mesh(GEO.limb, this.body);
    mesh.castShadow = true;
    mesh.position.copy(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, end.clone().normalize());
    mesh.scale.set(radius, length, radius);
    mesh.userData = { pick: "character", id: characterId, radius, length, limb: true };
    this.pivots[id].add(mesh);
    this.limbs.push(mesh);
    void childId;
  }

  private addVolume(parent: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, id: string, radius: number) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData = { pick: "character", id, radius, volume: true };
    mesh.scale.set(parent === this.pivots.chest ? 0.19 : 0.16, parent === this.pivots.chest ? 0.22 : 0.11, 0.12);
    parent.add(mesh);
    this.limbs.push(mesh);
  }

  private addEnd(parent: THREE.Group, geo: THREE.BufferGeometry, id: string, position: THREE.Vector3, scale: THREE.Vector3) {
    const mesh = new THREE.Mesh(geo, this.body);
    mesh.position.copy(position);
    mesh.scale.copy(scale);
    mesh.castShadow = true;
    mesh.userData = { pick: "character", id };
    parent.add(mesh);
  }

  private addHead(id: string) {
    const head = new THREE.Mesh(GEO.head, this.body);
    head.position.set(0, 0.045, 0);
    head.scale.set(0.115, 0.15, 0.11);
    head.castShadow = true;
    head.userData = { pick: "character", id, radius: 0.115, volume: true };
    this.pivots.head.add(head);
    this.limbs.push(head);
    const nose = new THREE.Mesh(GEO.nose, this.ink);
    nose.position.set(0, 0.02, 0.14);
    nose.userData = { pick: "character", id };
    this.pivots.head.add(nose);
    for (const x of [-0.04, 0.04]) {
      const eye = new THREE.Mesh(GEO.eye, this.ink);
      eye.position.set(x, 0.06, 0.1);
      eye.userData = { pick: "character", id };
      this.pivots.head.add(eye);
    }
  }

  apply(character: Character, selectedJoint: JointId | null, showMarkers: boolean) {
    this.root.position.set(character.position.x, character.position.y, character.position.z);
    this.root.rotation.set(rad(character.rotation.x), rad(character.rotation.y), rad(character.rotation.z));
    this.root.scale.set(character.scale.x, character.scale.y, character.scale.z);
    for (const id of JOINTS) {
      const euler = character.pose[id];
      this.pivots[id].rotation.set(rad(euler.x), rad(euler.y), rad(euler.z));
    }
    this.body.color.set(character.color);
    this.body.emissive.set(showMarkers ? "#3a2914" : "#000000");
    const bulk = THREE.MathUtils.clamp(character.bulk, 0.45, 1.8);
    for (const limb of this.limbs) {
      const radius = limb.userData.radius as number | undefined;
      if (!radius) continue;
      if (limb.userData.limb) {
        limb.scale.set(radius * bulk, limb.userData.length as number, radius * bulk);
      } else if (limb.userData.volume) {
        if (limb.parent === this.pivots.chest) limb.scale.set(0.19 * bulk, 0.22 * bulk, 0.12 * bulk);
        else if (limb.parent === this.pivots.hips) limb.scale.set(0.16 * bulk, 0.11 * bulk, 0.12 * bulk);
        else if (limb.parent === this.pivots.head) limb.scale.set(0.115 * bulk, 0.15 * bulk, 0.11 * bulk);
        else limb.scale.setScalar(bulk);
      }
    }
    for (const marker of this.markers) {
      marker.visible = showMarkers;
      const active = marker.userData.joint === selectedJoint;
      (marker.material as THREE.MeshStandardMaterial).emissive.set(active ? "#6fbfb8" : "#000000");
      (marker.material as THREE.MeshStandardMaterial).color.set(active ? "#6fbfb8" : "#e39a4d");
      marker.scale.setScalar(active ? 1.25 : 1);
    }
  }

  dispose() {
    this.body.dispose();
    this.ink.dispose();
    this.markerMat.dispose();
    for (const marker of this.markers) (marker.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }
}

function primaryChild(id: JointId): JointId | null {
  const map: Partial<Record<JointId, JointId>> = {
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
  return map[id] ?? null;
}
