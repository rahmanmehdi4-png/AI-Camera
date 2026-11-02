import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { applyGroupPreset, applySoloAdultPreset, type GroupPreset } from "@/planner/group-presets";
import { createProject } from "@/planner/project";
import { worldJoints } from "@/planner/skeleton";
import { Mannequin } from "@/three/mannequin";

/** One temporary, real-geometry preview on demand; never mount dozens of WebGL renderers. */
export function PresetScenePreview({ preset }: { preset: GroupPreset }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "low-power" }); }
    catch { setError(true); return; }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x171c24);
    scene.add(new THREE.HemisphereLight(0xf1f0ef, 0x555a64, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(2, 5, 4);
    scene.add(sun);
    const grid = new THREE.GridHelper(20, 20, 0x566b70, 0x394553);
    scene.add(grid);

    const project = createProject("Preset preview");
    if (preset.count === 1) applySoloAdultPreset(project, preset, project.characters[0]!.id);
    else applyGroupPreset(project, preset);
    const people = project.characters.slice(0, preset.count).map(person => new Mannequin(person));
    const bounds = new THREE.Box3();
    for (const [i, person] of project.characters.slice(0, preset.count).entries()) {
      scene.add(people[i]!.root);
      const joints = worldJoints(person.pose, person.position, person.rotation, person.scale);
      for (const point of Object.values(joints)) bounds.expandByPoint(new THREE.Vector3(point.x,point.y,point.z));
    }
    const centre = bounds.isEmpty() ? new THREE.Vector3(0,1,0) : bounds.getCenter(new THREE.Vector3());
    const size = bounds.isEmpty() ? 2 : bounds.getSize(new THREE.Vector3()).length();
    const distance = Math.max(3, size * 1.2);
    const camera = new THREE.PerspectiveCamera(43, 360/240, 0.05, 100);
    camera.position.set(centre.x+distance*0.58, centre.y+distance*0.35, centre.z+distance*0.77);
    camera.lookAt(centre);
    renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
    renderer.setSize(360, 240, false);
    renderer.render(scene,camera);
    return () => {
      for (const person of people) person.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [preset]);
  if(error) return <p className="rounded-lg border border-border bg-bg p-4 text-xs text-muted">3D preview is unavailable on this device. You can still apply or cancel the preset.</p>;
  return <canvas ref={canvasRef} className="mx-auto block max-w-full rounded-lg border border-border" width={360} height={240} aria-label={`3D preview of ${preset.name}`} />;
}
