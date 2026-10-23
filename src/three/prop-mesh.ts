import * as THREE from "three";
import { rad } from "@/planner/math";
import type { Prop } from "@/planner/project";

export class PropMesh {
  readonly root = new THREE.Group();
  private readonly materials: THREE.MeshStandardMaterial[] = [];

  constructor(prop: Prop) {
    this.root.name = prop.id;
    const main = this.mat(prop.color, 0);
    const soft = this.mat(prop.color, 0.18);
    const dark = this.mat(prop.color, -0.22);
    switch (prop.kind) {
      case "block":
        this.box(0.6, 0.6, 0.6, main, 0, 0, 0, prop.id);
        break;
      case "sphere":
        this.add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 16), main), prop.id, 0, 0, 0);
        break;
      case "cylinder":
        this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.8, 18), main), prop.id, 0, 0, 0);
        break;
      case "capsule":
        this.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 6, 12), main), prop.id, 0, 0, 0);
        break;
      case "plane":
        this.box(2, 0.02, 2, main, 0, 0, 0, prop.id);
        break;
      case "bed":
        this.box(1.6, 0.22, 2.1, dark, 0, -0.12, 0, prop.id);
        this.box(1.48, 0.18, 1.92, soft, 0, 0.06, 0.02, prop.id);
        this.box(1.6, 0.48, 0.08, dark, 0, 0.12, -1.01, prop.id);
        this.box(0.48, 0.1, 0.32, main, 0, 0.18, -0.72, prop.id);
        break;
      case "sofa":
        this.box(1.9, 0.28, 0.85, main, 0, -0.16, 0, prop.id);
        this.box(1.9, 0.42, 0.16, dark, 0, 0.16, -0.34, prop.id);
        this.box(0.16, 0.28, 0.85, dark, -0.87, 0.02, 0, prop.id);
        this.box(0.16, 0.28, 0.85, dark, 0.87, 0.02, 0, prop.id);
        this.box(0.55, 0.12, 0.28, soft, -0.4, 0.04, 0.12, prop.id);
        this.box(0.55, 0.12, 0.28, soft, 0.4, 0.04, 0.12, prop.id);
        break;
      case "chair":
        this.box(0.46, 0.06, 0.46, main, 0, 0.02, 0, prop.id);
        this.box(0.46, 0.42, 0.06, dark, 0, 0.22, -0.2, prop.id);
        for (const x of [-0.18, 0.18]) {
          for (const z of [-0.18, 0.18]) this.box(0.05, 0.4, 0.05, dark, x, -0.2, z, prop.id);
        }
        break;
      case "table":
        this.box(1.3, 0.06, 0.75, main, 0, 0.32, 0, prop.id);
        for (const x of [-0.55, 0.55]) {
          for (const z of [-0.28, 0.28]) this.box(0.06, 0.66, 0.06, dark, x, -0.04, z, prop.id);
        }
        break;
      case "pillow":
        this.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), soft), prop.id, 0, 0, 0);
        this.root.children[0]!.scale.set(0.65, 0.16, 0.4);
        break;
      case "wall":
        this.box(2.6, 2.4, 0.12, main, 0, 0, 0, prop.id);
        break;
      case "room":
        this.box(4, 0.06, 4, dark, 0, -1.17, 0, prop.id);
        this.box(0.1, 2.4, 4, main, -1.95, 0, 0, prop.id);
        this.box(4, 2.4, 0.1, main, 0, 0, -1.95, prop.id);
        break;
      default:
        this.box(0.4, 0.4, 0.4, main, 0, 0, 0, prop.id);
    }
    this.apply(prop, false);
  }

  private mat(color: string, shift: number) {
    const base = new THREE.Color(color);
    if (shift > 0) base.lerp(new THREE.Color("#f4efe6"), shift);
    if (shift < 0) base.lerp(new THREE.Color("#1b212b"), -shift);
    const material = new THREE.MeshStandardMaterial({ color: base, roughness: 0.78, metalness: 0.03 });
    this.materials.push(material);
    return material;
  }

  private box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, id: string) {
    this.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material), id, x, y, z);
  }

  private add(mesh: THREE.Mesh, id: string, x: number, y: number, z: number) {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { pick: "prop", id };
    this.root.add(mesh);
  }

  apply(prop: Prop, selected: boolean) {
    this.root.position.set(prop.position.x, prop.position.y, prop.position.z);
    this.root.rotation.set(rad(prop.rotation.x), rad(prop.rotation.y), rad(prop.rotation.z));
    this.root.scale.set(prop.scale.x, prop.scale.y, prop.scale.z);
    const color = new THREE.Color(prop.color);
    this.materials.forEach((material, index) => {
      const tint = color.clone();
      if (index === 1) tint.lerp(new THREE.Color("#f4efe6"), 0.18);
      if (index >= 2) tint.lerp(new THREE.Color("#1b212b"), 0.22);
      material.color.copy(tint);
      material.emissive.set(selected ? "#3a2914" : "#000000");
    });
  }

  dispose() {
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
  }
}
