import * as THREE from "three";
import type { Character } from "../planner/project.ts";
import { rad } from "../planner/math.ts";
import { BONES, JOINTS, type JointId } from "../planner/skeleton.ts";
import {
  BODY_SURFACES,
  FACE_SURFACE,
  MANNEQUIN_REVISION,
  bodyBulk,
  type Surface,
} from "../planner/body.ts";
function geometry(surface: Surface): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(surface.positions, 3));
  result.setIndex(surface.indices);
  result.computeVertexNormals();
  result.computeBoundingSphere();
  return result;
}
// Immutable shared geometry; each character needs only twenty body draw calls.
const GEOMETRIES = Object.fromEntries(
  JOINTS.map((id) => [id, geometry(BODY_SURFACES[id])]),
) as Record<JointId, THREE.BufferGeometry>;
const FACE = geometry(FACE_SURFACE),
  MARKER = new THREE.SphereGeometry(0.035, 10, 8);
export class Mannequin {
  readonly root = new THREE.Group();
  readonly pivots = {} as Record<JointId, THREE.Group>;
  readonly markers: THREE.Mesh[] = [];
  private readonly body: THREE.MeshStandardMaterial;
  private readonly ink: THREE.MeshStandardMaterial;
  private readonly markerMat: THREE.MeshStandardMaterial;
  private readonly activeMarkerMat: THREE.MeshStandardMaterial;
  private readonly surfaces: THREE.Mesh[] = [];
  constructor(character: Character) {
    this.body = new THREE.MeshStandardMaterial({
      color: character.color,
      roughness: 0.48,
      metalness: 0.06,
    });
    this.ink = new THREE.MeshStandardMaterial({ color: "#28313a", roughness: 0.72 });
    this.markerMat = new THREE.MeshStandardMaterial({
      color: "#e39a4d",
      roughness: 0.4,
      depthTest: false,
    });
    this.activeMarkerMat = new THREE.MeshStandardMaterial({
      color: "#6fbfb8",
      emissive: "#234a47",
      depthTest: false,
    });
    this.root.name = character.id;
    this.root.userData.renderer = MANNEQUIN_REVISION;
    for (const bone of BONES) {
      const pivot = new THREE.Group();
      pivot.name = bone.id;
      pivot.position.set(bone.local.x, bone.local.y, bone.local.z);
      this.pivots[bone.id] = pivot;
      (bone.parent ? this.pivots[bone.parent] : this.root).add(pivot);
      const mesh = new THREE.Mesh(GEOMETRIES[bone.id], this.body);
      mesh.name = `surface-${bone.id}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { pick: "character", id: character.id };
      pivot.add(mesh);
      this.surfaces.push(mesh);
      const marker = new THREE.Mesh(MARKER, this.markerMat);
      marker.name = `marker-${bone.id}`;
      marker.userData = { pick: "joint", id: character.id, joint: bone.id };
      marker.renderOrder = 10;
      pivot.add(marker);
      this.markers.push(marker);
    }
    const face = new THREE.Mesh(FACE, this.ink);
    face.name = "face-direction";
    face.userData = { pick: "character", id: character.id };
    this.pivots.head.add(face);
    this.surfaces.push(face);
    this.apply(character, null, false);
  }
  apply(character: Character, selectedJoint: JointId | null, showMarkers: boolean) {
    this.root.position.set(character.position.x, character.position.y, character.position.z);
    this.root.rotation.set(
      rad(character.rotation.x),
      rad(character.rotation.y),
      rad(character.rotation.z),
    );
    this.root.scale.set(character.scale.x, character.scale.y, character.scale.z);
    for (const id of JOINTS) {
      const e = character.pose[id];
      this.pivots[id].rotation.set(rad(e.x), rad(e.y), rad(e.z));
    }
    this.body.color.set(character.color);
    const bulk = bodyBulk(character.bulk);
    for (const mesh of this.surfaces) mesh.scale.set(bulk, 1, bulk);
    for (const marker of this.markers) {
      marker.visible = showMarkers;
      const active = marker.userData.joint === selectedJoint;
      marker.material = active ? this.activeMarkerMat : this.markerMat;
      marker.scale.setScalar(active ? 1.3 : 1);
    }
  }
  dispose() {
    this.body.dispose();
    this.ink.dispose();
    this.markerMat.dispose();
    this.activeMarkerMat.dispose();
    this.root.removeFromParent();
  }
}
