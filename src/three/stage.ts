import * as THREE from "three";
import { ASPECT_VALUE, type CameraState } from "@/planner/camera";
import { rad, type EulerDeg, type Vec3 } from "@/planner/math";
import { resolveCamera, sampleCameraPath } from "@/planner/motion";
import type { Project } from "@/planner/project";
import { worldJoints, type JointId } from "@/planner/skeleton";
import type { ControlMode, Selection, Tool, ViewMode } from "@/state/planner-store";
import { Mannequin } from "./mannequin";
import { PropMesh } from "./prop-mesh";

export type StageHooks = {
  getProject: () => Project;
  getSelection: () => Selection;
  getJoint: () => JointId | null;
  getTool: () => Tool;
  getControlMode: () => ControlMode;
  getPathAxis: () => "horizontal" | "vertical";
  updateWaypoint: (clipId: string, index: number, offset: Vec3) => void;
  getView: () => ViewMode;
  getTime: () => number;
  isPlaying: () => boolean;
  setPlaying: (playing: boolean) => void;
  setTime: (time: number) => void;
  begin: () => void;
  end: () => void;
  select: (selection: Selection) => void;
  setJoint: (joint: JointId | null) => void;
  applyDrag: (
    value: {
      position?: Vec3;
      rotation?: EulerDeg;
      scale?: Vec3;
      pose?: Project["characters"][number]["pose"];
      camera?: CameraState;
    },
    history: boolean,
  ) => void;
};

type Rect = { x: number; y: number; w: number; h: number };
type AxisName = "x" | "y" | "z";

export class Stage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly editor = new THREE.PerspectiveCamera(48, 1, 0.05, 80);
  private readonly shot = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 80);
  private readonly raycaster = new THREE.Raycaster();
  private readonly people = new Map<string, Mannequin>();
  private readonly props = new Map<string, PropMesh>();
  private readonly labels = new Map<string, THREE.Sprite>();
  private readonly gizmo = new THREE.Group();
  private readonly path = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x6fbfb8 }),
  );
  private readonly arrows: THREE.Mesh[] = [];
  private readonly waypointHandles = new THREE.Group();
  private readonly waypointMeshes: THREE.Mesh[] = [];
  private readonly waypointGeometry = new THREE.SphereGeometry(0.16, 14, 10);
  private readonly waypointMaterial = new THREE.MeshBasicMaterial({ color: 0xe39a4d, depthTest: false });
  private readonly camHelper = new THREE.Group();
  private readonly frustumCam = new THREE.PerspectiveCamera(36, 16 / 9, 0.15, 3);
  private readonly frustum: THREE.CameraHelper;
  private readonly targetMesh: THREE.Mesh;
  private readonly grid: THREE.GridHelper;
  private readonly ground: THREE.Mesh;
  private readonly beauty: THREE.Object3D[] = [];
  private theta = 0.78;
  private phi = 1.08;
  private radius = 6.4;
  private readonly look = new THREE.Vector3(0, 0.95, 0);
  private readonly touchPointers = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; x: number; y: number } | null = null;
  private playTime = 0;
  private wasPlaying = false;
  private lastUi = 0;
  private lastFrameTime = 0;
  private frameId = 0;
  private wheelTimer = 0;
  private drag: { kind: string; [key: string]: unknown } | null = null;
  private quality: "low" | "high";
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: StageHooks,
    quality: "low" | "high",
  ) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality === "high",
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x12151b, 1);
    this.renderer.shadowMap.enabled = quality === "high";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x12151b);
    this.scene.fog = new THREE.Fog(0x12151b, 90, 220);
    this.editor.far = 400;
    this.editor.updateProjectionMatrix();

    const hemi = new THREE.HemisphereLight(0xd5dbe3, 0x2a261f, 1.05);
    const sun = new THREE.DirectionalLight(0xfff1df, 1.35);
    sun.position.set(4.5, 8, 3);
    sun.castShadow = quality === "high";
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 24;
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    this.scene.add(hemi, sun, new THREE.AmbientLight(0x8d93a1, 0.25));

    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(160, 72),
      new THREE.MeshStandardMaterial({ color: 0x171c24, roughness: 1, metalness: 0 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.grid = new THREE.GridHelper(160, 80, 0x6fbfb8, 0x2c3544);
    this.grid.position.y = 0.002;
    this.scene.add(this.ground, this.grid);
    this.beauty.push(this.ground);

    this.buildGizmo();
    this.buildCameraHelper();
    this.frustum = new THREE.CameraHelper(this.frustumCam);
    this.frustum.setColors(
      new THREE.Color(0x6fbfb8),
      new THREE.Color(0xe39a4d),
      new THREE.Color(0xe39a4d),
      new THREE.Color(0x6fbfb8),
      new THREE.Color(0x9aa3b0),
    );
    this.frustum.userData = { pick: "camera" };
    this.targetMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xe39a4d }),
    );
    this.targetMesh.userData = { pick: "target" };
    this.scene.add(this.gizmo, this.path, this.camHelper, this.frustum, this.targetMesh, this.waypointHandles);
    for (let i = 0; i < 6; i++) {
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.16, 8),
        new THREE.MeshBasicMaterial({ color: 0x6fbfb8 }),
      );
      arrow.visible = false;
      this.arrows.push(arrow);
      this.scene.add(arrow);
    }
    const north = makeLabel("N");
    north.position.set(0, 0.2, 6.4);
    north.scale.set(0.55, 0.16, 1);
    this.scene.add(north);

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.tick();
  }

  resetView() {
    this.theta = 0.78;
    this.phi = 1.08;
    this.radius = 6.4;
    this.look.set(0, 0.95, 0);
  }

  zoomView(factor: number) {
    this.radius = THREE.MathUtils.clamp(this.radius * factor, 0.3, 120);
  }

  setQuality(quality: "low" | "high") {
    this.quality = quality;
    this.renderer.shadowMap.enabled = quality === "high";
  }

  frame() {
    const project = this.hooks.getProject();
    const selection = this.hooks.getSelection();
    const point = new THREE.Vector3(0, 1, 0);
    if (selection?.type === "character") {
      const character = project.characters.find((item) => item.id === selection.id);
      if (character) {
        const chest = worldJoints(character.pose, character.position, character.rotation, character.scale).chest;
        point.set(chest.x, chest.y, chest.z);
      }
    } else if (selection?.type === "prop") {
      const prop = project.props.find((item) => item.id === selection.id);
      if (prop) point.set(prop.position.x, prop.position.y, prop.position.z);
    } else if (selection?.type === "target") {
      point.set(project.camera.target.x, project.camera.target.y, project.camera.target.z);
    } else if (selection?.type === "camera") {
      point.set(project.camera.position.x, project.camera.position.y, project.camera.position.z);
    }
    this.look.copy(point);
    this.radius = THREE.MathUtils.clamp(this.radius, 2.4, 120);
  }

  async capture(kind: "pose" | "camera" | "annotated"): Promise<Blob> {
    const project = this.hooks.getProject();
    this.sync(project, this.hooks.getTime(), false);
    const aspect = ASPECT_VALUE[project.camera.aspect];
    const long = 1280;
    const width = kind === "camera" ? (aspect >= 1 ? long : Math.round(long * aspect)) : long;
    const height = kind === "camera" ? (aspect >= 1 ? Math.round(long / aspect) : long) : 720;
    const target = new THREE.WebGLRenderTarget(width, height);
    target.texture.colorSpace = THREE.SRGBColorSpace;

    // A GPU readback error must never leave the live editor stuck on an export
    // framebuffer or with its selection/frustum helpers permanently hidden.
    const previous = this.helpersVisible(true);
    let buffer: Uint8Array;
    try {
      if (kind === "camera") this.helpersVisible(false);
      if (kind === "pose") {
        this.gizmo.visible = false;
        this.camHelper.visible = false;
        this.frustum.visible = false;
        this.targetMesh.visible = false;
        this.path.visible = false;
        this.arrows.forEach((arrow) => (arrow.visible = false));
      }
      const camera = kind === "camera" ? this.shot : this.captureCamera(kind, width / height);
      this.renderer.setRenderTarget(target);
      this.renderer.setViewport(0, 0, width, height);
      this.renderer.setScissor(0, 0, width, height);
      this.renderer.setScissorTest(true);
      this.renderer.setClearColor(kind === "camera" ? 0x101318 : 0x12151b, 1);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, camera);
      buffer = new Uint8Array(width * height * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
    } finally {
      this.renderer.setRenderTarget(null);
      this.renderer.setScissorTest(false);
      target.dispose();
      this.helpersVisible(previous);
    }

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) throw new Error("Could not create the screenshot.");
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4;
      image.data.set(buffer.subarray(src, src + width * 4), y * width * 4);
    }
    ctx.putImageData(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => exportCanvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not encode the PNG.");
    return blob;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.wheelTimer);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    for (const person of this.people.values()) person.dispose();
    for (const prop of this.props.values()) prop.dispose();
    this.waypointGeometry.dispose();
    this.waypointMaterial.dispose();
    this.renderer.dispose();
  }

  private tick = () => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.tick);
    const now = performance.now();
    const deltaSeconds = this.lastFrameTime ? Math.min(0.25, Math.max(0, (now - this.lastFrameTime) / 1000)) : 0;
    this.lastFrameTime = now;
    const project = this.hooks.getProject();
    const playing = this.hooks.isPlaying();
    if (playing && !this.wasPlaying) this.playTime = this.hooks.getTime();
    if (playing) {
      // Elapsed-time playback stays consistent on slower phone/tablet GPUs.
      // The shot plays once and stops on the final frame, so a 15s timeline
      // takes 15 real seconds and does not silently restart.
      this.playTime += this.wasPlaying ? deltaSeconds : 0;
      if (this.playTime >= project.duration - 1e-4) {
        this.playTime = project.duration;
        this.lastUi = now;
        this.hooks.setTime(project.duration);
        this.hooks.setPlaying(false);
      } else if (now - this.lastUi > 90) {
        this.lastUi = now;
        this.hooks.setTime(this.playTime);
      }
    } else {
      this.playTime = this.hooks.getTime();
    }
    this.wasPlaying = playing;
    this.sync(project, this.playTime, true);
    this.renderViews();
  };

  private sync(project: Project, time: number, showHelpers: boolean) {
    const selection = this.hooks.getSelection();
    const joint = this.hooks.getJoint();
    const ids = new Set(project.characters.map((character) => character.id));
    for (const [id, person] of this.people) {
      if (!ids.has(id)) {
        person.dispose();
        this.people.delete(id);
        this.labels.get(id)?.removeFromParent();
        this.labels.delete(id);
      }
    }
    for (const character of project.characters) {
      let person = this.people.get(character.id);
      if (!person) {
        person = new Mannequin(character);
        this.people.set(character.id, person);
        this.scene.add(person.root);
      }
      const selected = selection?.type === "character" && selection.id === character.id;
      person.apply(character, selected ? joint : null, selected);
      const head = worldJoints(character.pose, character.position, character.rotation, character.scale).head;
      let label = this.labels.get(character.id);
      if (!label || label.userData.text !== character.name) {
        label?.removeFromParent();
        label = makeLabel(character.name);
        label.userData.text = character.name;
        this.labels.set(character.id, label);
        this.scene.add(label);
      }
      label.position.set(head.x, head.y + 0.24, head.z);
    }

    const propIds = new Set(project.props.map((prop) => prop.id));
    for (const [id, mesh] of this.props) {
      if (!propIds.has(id)) {
        mesh.dispose();
        this.props.delete(id);
        this.labels.get(id)?.removeFromParent();
        this.labels.delete(id);
      }
    }
    for (const prop of project.props) {
      let mesh = this.props.get(prop.id);
      if (!mesh) {
        mesh = new PropMesh(prop);
        this.props.set(prop.id, mesh);
        this.scene.add(mesh.root);
        this.beauty.push(mesh.root);
      }
      const selected = selection?.type === "prop" && selection.id === prop.id;
      mesh.apply(prop, selected);
      let label = this.labels.get(prop.id);
      if (!label || label.userData.text !== prop.name) {
        label?.removeFromParent();
        label = makeLabel(prop.name);
        label.userData.text = prop.name;
        this.labels.set(prop.id, label);
        this.scene.add(label);
      }
      label.position.set(prop.position.x, prop.position.y + propSpecHeight(prop) + 0.18, prop.position.z);
    }

    const resolved = resolveCamera(project.camera, project.motions, time);
    this.shot.fov = resolved.fov;
    this.shot.position.set(resolved.position.x, resolved.position.y, resolved.position.z);
    this.shot.up.set(0, 1, 0);
    this.shot.lookAt(resolved.target.x, resolved.target.y, resolved.target.z);
    this.shot.rotateZ(rad(resolved.roll));
    this.shot.updateMatrixWorld();
    this.camHelper.position.copy(this.shot.position);
    this.camHelper.quaternion.copy(this.shot.quaternion);
    this.camHelper.scale.setScalar(THREE.MathUtils.clamp(this.radius * 0.11, 0.95, 1.8));
    this.targetMesh.position.set(resolved.target.x, resolved.target.y, resolved.target.z);
    const aim = this.shot.position.distanceTo(this.targetMesh.position);
    this.frustumCam.fov = resolved.fov;
    this.frustumCam.aspect = ASPECT_VALUE[project.camera.aspect];
    this.frustumCam.near = 0.15;
    this.frustumCam.far = Math.max(0.45, aim);
    this.frustumCam.position.copy(this.shot.position);
    this.frustumCam.quaternion.copy(this.shot.quaternion);
    this.frustumCam.updateProjectionMatrix();
    this.frustumCam.updateMatrixWorld();
    this.frustum.update();

    const points = sampleCameraPath(project.camera, project.motions, project.duration, 40);
    const positions = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
    });
    this.path.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.path.geometry.computeBoundingSphere();
    let arrow = 0;
    for (let i = 4; i < points.length && arrow < this.arrows.length; i += 8) {
      const prev = points[i - 1]!;
      const next = points[i]!;
      const dir = new THREE.Vector3(next.x - prev.x, next.y - prev.y, next.z - prev.z);
      const mesh = this.arrows[arrow]!;
      if (dir.length() < 0.02) {
        mesh.visible = false;
      } else {
        mesh.visible = showHelpers;
        mesh.position.set(next.x, next.y, next.z);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      }
      arrow++;
    }
    for (; arrow < this.arrows.length; arrow++) this.arrows[arrow]!.visible = false;
    // Preallocate and reuse handles; never create/dispose geometry every animation frame.
    const activePath = project.motions.find((clip) => clip.kind === "path" && clip.waypoints?.length);
    const waypoints = activePath?.waypoints ?? [];
    waypoints.forEach((point, index) => {
      let marker = this.waypointMeshes[index];
      if (!marker) {
        marker = new THREE.Mesh(this.waypointGeometry, this.waypointMaterial);
        marker.renderOrder = 100;
        this.waypointMeshes[index] = marker;
        this.waypointHandles.add(marker);
      }
      const at = activePath!.start + point.t * activePath!.duration;
      const actual = resolveCamera(project.camera, project.motions, at).position;
      marker.position.set(actual.x, actual.y, actual.z);
      marker.scale.setScalar(THREE.MathUtils.clamp(this.radius * 0.12, 1, 2));
      marker.userData = { pick: "waypoint", id: activePath!.id, index };
      marker.visible = this.hooks.getControlMode() === "path";
    });
    this.waypointMeshes.forEach((mesh, index) => { if (index >= waypoints.length) mesh.visible = false; });
    const moving = resolved.positionDelta > 0.04;
    (this.path.material as THREE.LineBasicMaterial).color.set(moving ? 0x6fbfb8 : 0xe39a4d);

    this.placeGizmo(project, selection);
    this.updateEditor();
    if (showHelpers) this.helpersVisible(true);
    else this.helpersVisible(false);
  }

  private renderViews() {
    const cssW = this.canvas.clientWidth || 1;
    const cssH = this.canvas.clientHeight || 1;
    const pr = this.quality === "low" ? 1 : Math.min(window.devicePixelRatio || 1, 1.75);
    const bufferW = Math.max(1, Math.floor(cssW * pr));
    const bufferH = Math.max(1, Math.floor(cssH * pr));
    if (this.canvas.width !== bufferW || this.canvas.height !== bufferH) {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(bufferW, bufferH, false);
    }
    const layout = this.viewRects(cssW, cssH);
    this.renderer.setScissorTest(true);
    this.renderer.setClearColor(0x12151b, 1);
    this.renderer.clear();
    if (layout.scene) {
      this.helpersVisible(true);
      this.placeGizmo(this.hooks.getProject(), this.hooks.getSelection());
      const gl = this.toGl(layout.scene, cssH, pr);
      this.editor.aspect = layout.scene.w / layout.scene.h;
      this.editor.updateProjectionMatrix();
      this.renderer.setViewport(gl.x, gl.y, gl.w, gl.h);
      this.renderer.setScissor(gl.x, gl.y, gl.w, gl.h);
      this.renderer.render(this.scene, this.editor);
    }
    if (layout.camera) {
      const project = this.hooks.getProject();
      const film = letterbox(layout.camera, ASPECT_VALUE[project.camera.aspect]);
      const pane = this.toGl(layout.camera, cssH, pr);
      this.renderer.setViewport(pane.x, pane.y, pane.w, pane.h);
      this.renderer.setScissor(pane.x, pane.y, pane.w, pane.h);
      this.renderer.setClearColor(0x090b0e, 1);
      this.renderer.clear(true, true, true);
      this.helpersVisible(false);
      const gl = this.toGl(film, cssH, pr);
      this.shot.aspect = ASPECT_VALUE[project.camera.aspect];
      this.shot.updateProjectionMatrix();
      this.renderer.setViewport(gl.x, gl.y, gl.w, gl.h);
      this.renderer.setScissor(gl.x, gl.y, gl.w, gl.h);
      this.renderer.setClearColor(0x12151b, 1);
      this.renderer.render(this.scene, this.shot);
      this.helpersVisible(true);
    }
  }

  private viewRects(w: number, h: number): { scene: Rect | null; camera: Rect | null } {
    const mode = this.hooks.getView();
    if (mode === "scene") return { scene: { x: 0, y: 0, w, h }, camera: null };
    if (mode === "camera") return { scene: null, camera: { x: 0, y: 0, w, h } };
    if (w >= 640 && w >= h) {
      const left = Math.round(w * 0.5);
      return { scene: { x: 0, y: 0, w: left, h }, camera: { x: left, y: 0, w: w - left, h } };
    }
    const top = Math.round(h * 0.4);
    return { scene: { x: 0, y: top, w, h: h - top }, camera: { x: 0, y: 0, w, h: top } };
  }

  private toGl(rect: Rect, canvasH: number, pr: number) {
    return {
      x: Math.round(rect.x * pr),
      y: Math.round((canvasH - rect.y - rect.h) * pr),
      w: Math.max(1, Math.round(rect.w * pr)),
      h: Math.max(1, Math.round(rect.h * pr)),
    };
  }

  private updateEditor() {
    const sin = Math.sin(this.phi);
    this.editor.position.set(
      this.look.x + this.radius * sin * Math.sin(this.theta),
      this.look.y + this.radius * Math.cos(this.phi),
      this.look.z + this.radius * sin * Math.cos(this.theta),
    );
    this.editor.up.set(0, 1, 0);
    this.editor.lookAt(this.look);
    this.editor.updateMatrixWorld();
  }

  private placeGizmo(project: Project, selection: Selection) {
    const tool = this.hooks.getTool();
    const mode = this.hooks.getControlMode();
    if (mode === "workspace" || mode === "path" ||
      (mode === "character" && selection?.type !== "character") ||
      (mode === "object" && selection?.type !== "prop") ||
      (mode === "camera" && selection?.type !== "camera" && selection?.type !== "target")) { this.gizmo.visible = false; return; }
    let point: Vec3 | null = null;
    if (selection?.type === "character") {
      point = project.characters.find((item) => item.id === selection.id)?.position ?? null;
    } else if (selection?.type === "prop") {
      point = project.props.find((item) => item.id === selection.id)?.position ?? null;
    } else if (selection?.type === "camera") point = project.camera.position;
    else if (selection?.type === "target") point = project.camera.target;
    const show = Boolean(point) && tool === "move" && this.hooks.getView() !== "camera";
    this.gizmo.visible = show;
    if (!point) return;
    this.gizmo.position.set(point.x, point.y, point.z);
    this.gizmo.scale.setScalar(THREE.MathUtils.clamp(this.radius * 0.12, 0.45, 1.8));
  }

  private helpersVisible(show: boolean) {
    const previous = this.grid.visible;
    this.grid.visible = show;
    this.path.visible = show;
    this.waypointHandles.visible = show && this.hooks.getControlMode() === "path";
    this.camHelper.visible = show;
    this.frustum.visible = show;
    this.targetMesh.visible = show;
    for (const label of this.labels.values()) label.visible = show;
    if (!show) {
      this.gizmo.visible = false;
      for (const person of this.people.values()) person.markers.forEach((marker) => (marker.visible = false));
      this.arrows.forEach((arrow) => (arrow.visible = false));
    }
    return previous;
  }

  private captureCamera(kind: "pose" | "annotated", aspect: number) {
    if (kind === "annotated") {
      const camera = this.editor.clone() as THREE.PerspectiveCamera;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      return camera;
    }
    const project = this.hooks.getProject();
    const box = new THREE.Box3();
    let count = 0;
    for (const character of project.characters) {
      const joints = worldJoints(character.pose, character.position, character.rotation, character.scale);
      for (const point of Object.values(joints)) {
        box.expandByPoint(new THREE.Vector3(point.x, point.y, point.z));
        count++;
      }
    }
    for (const prop of project.props) {
      box.expandByPoint(new THREE.Vector3(prop.position.x, prop.position.y, prop.position.z));
      count++;
    }
    const center = count ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 1, 0);
    const size = count ? box.getSize(new THREE.Vector3()).length() : 2;
    const distance = Math.max(3.2, size * 1.15);
    const camera = new THREE.PerspectiveCamera(34, aspect, 0.05, 80);
    camera.position.set(center.x + distance * 0.72, center.y + distance * 0.38, center.z + distance * 0.72);
    camera.lookAt(center);
    return camera;
  }

  private locate(event: PointerEvent) {
    const bounds = this.canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const layout = this.viewRects(bounds.width, bounds.height);
    const hit = (rect: Rect | null, view: "scene" | "shot") => {
      if (!rect || x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h) return null;
      return {
        view,
        ndc: new THREE.Vector2(((x - rect.x) / rect.w) * 2 - 1, -((y - rect.y) / rect.h) * 2 + 1),
        rect,
      };
    };
    return hit(layout.scene, "scene") ?? hit(layout.camera, "shot");
  }

  private pick(ndc: THREE.Vector2) {
    this.editor.aspect = this.currentSceneAspect();
    this.editor.updateProjectionMatrix();
    this.updateEditor();
    this.raycaster.setFromCamera(ndc, this.editor);
    return this.raycaster.intersectObjects(this.scene.children, true);
  }

  private currentSceneAspect() {
    const bounds = this.canvas.getBoundingClientRect();
    const scene = this.viewRects(bounds.width, bounds.height).scene;
    return scene ? scene.w / scene.h : 1;
  }

  private nearestJoint(event: PointerEvent, project: Project): { id: string; joint: JointId } | null {
    const rect = this.canvas.getBoundingClientRect();
    const view = this.viewRects(rect.width, rect.height).scene;
    if (!view) return null;
    const pointer = new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top);
    const touchRadius = event.pointerType === "mouse" ? 15 : 32;
    let best = touchRadius * touchRadius;
    let found: { id: string; joint: JointId } | null = null;
    for (const ch of project.characters) {
      const joints = worldJoints(ch.pose, ch.position, ch.rotation, ch.scale);
      for (const [name, coords] of Object.entries(joints) as [JointId, Vec3][]) {
        const pt = new THREE.Vector3(coords.x, coords.y, coords.z).project(this.editor);
        if (pt.z >= 1 || pt.z <= -1) continue;
        const x = view.x + (pt.x + 1) * 0.5 * view.w;
        const y = view.y + (1 - pt.y) * 0.5 * view.h;
        const d = pointer.distanceToSquared(new THREE.Vector2(x, y));
        if (d < best) { best = d; found = { id: ch.id, joint: name }; }
      }
    }
    return found;
  }

  private onPointerDown = (event: PointerEvent) => {
    this.touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touchPointers.size >= 2) {
      const [a, b] = [...this.touchPointers.values()];
      this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.drag) this.hooks.end();
      this.drag = null;
      return;
    }
    const mode = this.hooks.getControlMode();
    const where = this.locate(event);
    if (!where) return;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* Some browsers reject capture for a synthetic or already-ended pointer. The gesture still tracks. */
    }
    const project = this.hooks.getProject();
    if (where.view === "shot") {
      if (mode !== "camera") return;
      this.hooks.begin();
      this.drag = { kind: event.shiftKey || event.button === 2 ? "shot-pan" : "shot-orbit", x: event.clientX, y: event.clientY, moved: 0 };
      return;
    }
    if (mode === "workspace") {
      this.drag = { kind: "editor", x: event.clientX, y: event.clientY, moved: 0 };
      return;
    }
    if (mode === "path") {
      const hits = this.pick(where.ndc);
      const handle = hits.find((hit) => hit.object.userData.pick === "waypoint");
      if (handle) {
        const clipId = String(handle.object.userData.id);
        const index = Number(handle.object.userData.index);
        const clip = project.motions.find((m) => m.id === clipId);
        const old = clip?.waypoints?.[index]?.offset;
        if (old) {
          this.hooks.begin();
          this.drag = { kind: "waypoint", id: clipId, index, x: event.clientX, y: event.clientY, old: { ...old }, vertical: event.shiftKey || this.hooks.getPathAxis() === "vertical", moved: 0 };
        }
      }
      return;
    }
    const hits = this.pick(where.ndc).filter((hit) => {
      const kind = hit.object.userData.pick;
      return mode === "character" ? kind === "character" || kind === "joint" || kind === "gizmo"
        : mode === "object" ? kind === "prop" || kind === "gizmo"
        : kind === "camera" || kind === "target" || kind === "gizmo";
    });
    const pickOf = (hit: THREE.Intersection) => hit.object.userData.pick as string | undefined;
    const gizmoHit = hits.find((hit) => pickOf(hit) === "gizmo");
    if (gizmoHit && this.hooks.getTool() === "move") {
      const axisName = gizmoHit.object.userData.axis as AxisName;
      const axis = new THREE.Vector3(axisName === "x" ? 1 : 0, axisName === "y" ? 1 : 0, axisName === "z" ? 1 : 0);
      const origin = this.gizmo.position.clone();
      const plane = axisPlane(axis, origin, this.editor);
      const startHit = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(plane, startHit);
      this.hooks.begin();
      this.drag = { kind: "axis", axis, origin, startHit, plane, moved: 0 };
      return;
    }
    // Touch-friendly selection uses projected joint centres rather than tiny mesh pixels.
    const nearJoint = mode === "character" && this.hooks.getTool() === "pose"
      ? this.nearestJoint(event, project) : null;
    if (nearJoint) {
      this.hooks.select({ type: "character", id: nearJoint.id });
      this.hooks.setJoint(nearJoint.joint);
      const person = project.characters.find((p) => p.id === nearJoint.id);
      if (person) {
        this.hooks.begin();
        this.drag = { kind: "joint", id: nearJoint.id, joint: nearJoint.joint, x: event.clientX, y: event.clientY, euler: { ...person.pose[nearJoint.joint] }, moved: 0 };
      }
      return;
    }
    const jointHit = hits.find((hit) => pickOf(hit) === "joint" && hit.object.visible);
    const poseBody = hits.find((hit) => pickOf(hit) === "character" || pickOf(hit) === "joint");
    if (this.hooks.getTool() === "pose" && (jointHit || poseBody)) {
      const source = jointHit ?? poseBody!;
      const id = String(source.object.userData.id);
      let joint = (jointHit?.object.userData.joint ?? null) as JointId | null;
      if (!joint) {
        const person = this.people.get(id);
        const point = source.point;
        let best = Infinity;
        for (const marker of person?.markers ?? []) {
          const world = new THREE.Vector3();
          marker.getWorldPosition(world);
          const distance = world.distanceTo(point);
          if (distance < best) {
            best = distance;
            joint = marker.userData.joint as JointId;
          }
        }
      }
      const character = project.characters.find((item) => item.id === id);
      if (!character || !joint) return;
      this.hooks.select({ type: "character", id });
      this.hooks.setJoint(joint);
      this.hooks.begin();
      this.drag = { kind: "joint", id, joint, x: event.clientX, y: event.clientY, euler: { ...character.pose[joint] }, moved: 0 };
      return;
    }
    const objectHit =
      hits.find((hit) => pickOf(hit) === "character" || pickOf(hit) === "prop") ??
      hits.find((hit) => pickOf(hit) === "target" || pickOf(hit) === "camera");
    if (objectHit) {
      const pick = objectHit.object.userData.pick as string;
      if (pick === "character" || pick === "prop") {
        const id = String(objectHit.object.userData.id);
        this.hooks.select({ type: pick, id });
        const tool = this.hooks.getTool();
        this.hooks.begin();
        if (tool === "rotate") {
          const rotation = pick === "character"
            ? project.characters.find((item) => item.id === id)?.rotation
            : project.props.find((item) => item.id === id)?.rotation;
          this.drag = { kind: "spin", id, pick, x: event.clientX, y: event.clientY, rotation: { ...(rotation ?? { x: 0, y: 0, z: 0 }) }, moved: 0 };
        } else if (tool === "scale") {
          const scale = pick === "character"
            ? project.characters.find((item) => item.id === id)?.scale
            : project.props.find((item) => item.id === id)?.scale;
          this.drag = { kind: "grow", id, pick, y: event.clientY, scale: { ...(scale ?? { x: 1, y: 1, z: 1 }) }, moved: 0 };
        } else if (tool === "pose" && pick === "character") {
          this.drag = { kind: "editor", x: event.clientX, y: event.clientY, moved: 0 };
        } else {
          const position = pick === "character"
            ? project.characters.find((item) => item.id === id)?.position
            : project.props.find((item) => item.id === id)?.position;
          const origin = new THREE.Vector3(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0);
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -origin.y);
          const startHit = new THREE.Vector3();
          this.raycaster.ray.intersectPlane(plane, startHit);
          this.drag = { kind: "slide", id, pick, origin, plane, startHit, moved: 0 };
        }
        return;
      }
      // In Camera mode, drag the virtual camera or aim point, never the workspace view.
      this.hooks.select({ type: pick === "camera" ? "camera" : "target" });
      const world = pick === "camera" ? project.camera.position : project.camera.target;
      const origin = new THREE.Vector3(world.x, world.y, world.z);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -origin.y);
      const startHit = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(plane, startHit)) return;
      this.hooks.begin();
      this.drag = { kind: "slide", id: pick, pick, origin, plane, startHit, moved: 0 };
      return;
    }
    // Empty space never drags an object or camera unless Workspace mode is chosen.
    this.drag = null;
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.touchPointers.has(event.pointerId)) {
      this.touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touchPointers.size >= 2 && this.pinch) {
        const [a, b] = [...this.touchPointers.values()];
        const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        this.zoomView(this.pinch.distance / distance);
        this.panEditor((a.x + b.x) / 2 - this.pinch.x, (a.y + b.y) / 2 - this.pinch.y);
        this.pinch = { distance, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return;
      }
    }
    const drag = this.drag;
    if (!drag) return;
    const lastX = Number(drag.lastX ?? drag.x ?? event.clientX);
    const lastY = Number(drag.lastY ?? drag.y ?? event.clientY);
    const stepX = event.clientX - lastX;
    const stepY = event.clientY - lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    const dx = event.clientX - Number(drag.x ?? event.clientX);
    const dy = event.clientY - Number(drag.y ?? event.clientY);
    drag.moved = Number(drag.moved ?? 0) + Math.abs(stepX) + Math.abs(stepY);
    if (drag.kind === "waypoint") {
      const old = drag.old as Vec3;
      // Standard drag moves across the ground plane; Shift-drag adjusts height.
      const scale = Math.max(0.006, this.radius * 0.002);
      const next = { ...old };
      if (event.shiftKey || drag.vertical) next.y -= dy * scale;
      else { next.x += dx * scale; next.z += dy * scale; }
      this.hooks.updateWaypoint(String(drag.id), Number(drag.index), next);
      drag.old = next;
      drag.x = event.clientX; drag.y = event.clientY;
      return;
    }
    if (drag.kind === "editor") {
      if (event.shiftKey || event.buttons === 2) this.panEditor(stepX, stepY);
      else {
        this.theta -= stepX * 0.007;
        this.phi = THREE.MathUtils.clamp(this.phi - stepY * 0.007, 0.12, Math.PI - 0.12);
      }
      return;
    }
    if (drag.kind === "shot-orbit" || drag.kind === "shot-pan") {
      this.dragShot(stepX, stepY, drag.kind === "shot-pan");
      return;
    }
    if (drag.kind === "axis" || drag.kind === "slide") {
      const where = this.locate(event);
      if (where?.view === "scene") this.pick(where.ndc);
      const hit = new THREE.Vector3();
      const plane = drag.plane as THREE.Plane;
      if (!this.raycaster.ray.intersectPlane(plane, hit)) return;
      if (drag.kind === "axis") {
        const startHit = drag.startHit as THREE.Vector3;
        const axis = drag.axis as THREE.Vector3;
        const origin = drag.origin as THREE.Vector3;
        const next = origin.clone().addScaledVector(axis, hit.clone().sub(startHit).dot(axis));
        this.hooks.applyDrag({ position: { x: next.x, y: next.y, z: next.z } }, false);
      } else {
        const delta = hit.sub(drag.startHit as THREE.Vector3);
        const origin = drag.origin as THREE.Vector3;
        this.hooks.applyDrag({ position: { x: origin.x + delta.x, y: origin.y, z: origin.z + delta.z } }, false);
      }
      return;
    }
    if (drag.kind === "spin") {
      const rotation = drag.rotation as EulerDeg;
      this.hooks.applyDrag({ rotation: { x: rotation.x + dy * 0.35, y: rotation.y + dx * 0.45, z: rotation.z } }, false);
      return;
    }
    if (drag.kind === "grow") {
      const scale = drag.scale as Vec3;
      const factor = Math.exp(-(event.clientY - Number(drag.y)) * 0.008);
      const next = clampScale(scale.x * factor);
      this.hooks.applyDrag({ scale: { x: next, y: next, z: next } }, false);
      return;
    }
    if (drag.kind === "joint") {
      const start = drag.euler as EulerDeg;
      const project = this.hooks.getProject();
      const character = project.characters.find((item) => item.id === drag.id);
      if (!character) return;
      const pose = structuredClone(character.pose);
      pose[drag.joint as JointId] = {
        x: start.x + dy * 0.4,
        y: start.y + dx * 0.45,
        z: start.z,
      };
      this.hooks.applyDrag({ pose }, false);
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    this.touchPointers.delete(event.pointerId);
    if (this.touchPointers.size < 2) this.pinch = null;
    if (this.drag) this.hooks.end();
    this.drag = null;
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const where = this.locate(event as unknown as PointerEvent);
    const amount = Math.exp(event.deltaY * 0.0012);
    // A scroll gesture modifies the actual shot only in explicit Camera mode.
    if (where?.view === "shot" && this.hooks.getControlMode() === "camera") {
      const camera = this.hooks.getProject().camera;
      const offset = {
        x: (camera.position.x - camera.target.x) * amount,
        y: (camera.position.y - camera.target.y) * amount,
        z: (camera.position.z - camera.target.z) * amount,
      };
      this.hooks.begin();
      this.hooks.applyDrag({
        camera: {
          ...camera,
          position: {
            x: camera.target.x + offset.x,
            y: camera.target.y + offset.y,
            z: camera.target.z + offset.z,
          },
        },
      }, false);
      window.clearTimeout(this.wheelTimer);
      this.wheelTimer = window.setTimeout(() => {
        if (!this.drag) this.hooks.end();
      }, 280);
      return;
    }
    this.zoomView(amount);
  };

  private panEditor(dx: number, dy: number) {
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.editor.updateMatrixWorld();
    right.setFromMatrixColumn(this.editor.matrixWorld, 0);
    up.setFromMatrixColumn(this.editor.matrixWorld, 1);
    const scale = this.radius * 0.0014;
    this.look.addScaledVector(right, -dx * scale);
    this.look.addScaledVector(up, dy * scale);
  }

  private dragShot(dx: number, dy: number, pan: boolean) {
    const camera = this.hooks.getProject().camera;
    if (pan) {
      const offset = new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z);
      const target = new THREE.Vector3(camera.target.x, camera.target.y, camera.target.z);
      this.shot.position.copy(offset);
      this.shot.up.set(0, 1, 0);
      this.shot.lookAt(target);
      this.shot.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(this.shot.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.shot.matrixWorld, 1);
      const scale = Math.max(0.4, offset.distanceTo(target)) * 0.0016;
      right.multiplyScalar(-dx * scale);
      up.multiplyScalar(dy * scale);
      this.hooks.applyDrag({
        camera: {
          ...camera,
          position: { x: camera.position.x + right.x + up.x, y: camera.position.y + right.y + up.y, z: camera.position.z + right.z + up.z },
          target: { x: camera.target.x + right.x + up.x, y: camera.target.y + right.y + up.y, z: camera.target.z + right.z + up.z },
        },
      }, false);
      return;
    }
    const offset = new THREE.Vector3(
      camera.position.x - camera.target.x,
      camera.position.y - camera.target.y,
      camera.position.z - camera.target.z,
    );
    const radius = Math.max(0.3, offset.length());
    let theta = Math.atan2(offset.x, offset.z);
    let phi = Math.acos(THREE.MathUtils.clamp(offset.y / radius, -1, 1));
    theta -= dx * 0.007;
    phi = THREE.MathUtils.clamp(phi - dy * 0.007, 0.08, Math.PI - 0.08);
    this.hooks.applyDrag({
      camera: {
        ...camera,
        position: {
          x: camera.target.x + radius * Math.sin(phi) * Math.sin(theta),
          y: camera.target.y + radius * Math.cos(phi),
          z: camera.target.z + radius * Math.sin(phi) * Math.cos(theta),
        },
      },
    }, false);
  }

  private buildGizmo() {
    const specs: [AxisName, number][] = [
      ["x", 0xd67171],
      ["y", 0x6fbfb8],
      ["z", 0xe39a4d],
    ];
    for (const [axis, color] of specs) {
      const material = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.72, 8), material);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.2, 10), material);
      const dir = new THREE.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      head.quaternion.copy(shaft.quaternion);
      shaft.position.copy(dir).multiplyScalar(0.42);
      head.position.copy(dir).multiplyScalar(0.86);
      shaft.userData = { pick: "gizmo", axis };
      head.userData = { pick: "gizmo", axis };
      shaft.renderOrder = 20;
      head.renderOrder = 20;
      this.gizmo.add(shaft, head);
    }
  }

  private buildCameraHelper() {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.14, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xe39a4d, roughness: 0.45, metalness: 0.1 }),
    );
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.07, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x1b212b, roughness: 0.4, metalness: 0.2 }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.z = -0.14;
    body.userData = { pick: "camera" };
    lens.userData = { pick: "camera" };
    this.camHelper.add(body, lens);
  }
}

function axisPlane(axis: THREE.Vector3, origin: THREE.Vector3, camera: THREE.Camera) {
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  const normal = camDir.clone().addScaledVector(axis, -camDir.dot(axis));
  if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);
  normal.normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
}

function letterbox(rect: Rect, aspect: number): Rect {
  const view = rect.w / Math.max(1, rect.h);
  if (view > aspect) {
    const w = rect.h * aspect;
    return { x: rect.x + (rect.w - w) / 2, y: rect.y, w, h: rect.h };
  }
  const h = rect.w / aspect;
  return { x: rect.x, y: rect.y + (rect.h - h) / 2, w: rect.w, h };
}

function makeLabel(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Sprite();
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = "rgba(18, 21, 27, 0.78)";
  roundRect(ctx, 16, 24, 480, 80, 24);
  ctx.fill();
  ctx.fillStyle = "#ece7df";
  ctx.font = "500 54px Outfit, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(0.9, 0.22, 1);
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 30;
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function propSpecHeight(prop: Project["props"][number]) {
  return 0.35 * prop.scale.y;
}

function clampScale(value: number) {
  return Math.min(4, Math.max(0.15, value));
}
