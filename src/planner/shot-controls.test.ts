import assert from "node:assert/strict";
import { test } from "node:test";
import { adjustShot, adjustWaypoint } from "./shot-controls.ts";
import { createProject } from "./project.ts";
import { cameraDistance } from "./camera.ts";

test("human-readable camera arrows operate relative to the view and never touch the workspace", () => {
  const camera = createProject().camera;
  const right = adjustShot(camera,"aim-right",0.2);
  const left = adjustShot(right,"aim-left",0.2);
  assert.ok(Math.hypot(left.target.x-camera.target.x,left.target.y-camera.target.y,left.target.z-camera.target.z)<0.02,"Sequential view-relative aiming should approximately reverse");
  assert.deepEqual(right.position,camera.position);
  const moved = adjustShot(camera,"slide-right",0.2);
  assert.notDeepEqual(moved.position,camera.position);
  assert.equal(Number(((moved.target.x-moved.position.x)-(camera.target.x-camera.position.x)).toFixed(6)),0);
  const closer = adjustShot(camera,"closer",0.2);
  assert.ok(cameraDistance(closer) < cameraDistance(camera));
  assert.deepEqual(closer.target,camera.target);
  const zoom = adjustShot(camera,"zoom-in",0.2);
  assert.ok(zoom.fov < camera.fov);
  assert.deepEqual(zoom.position,camera.position);
  assert.deepEqual(zoom.target,camera.target);
  let near=structuredClone(camera);
  for(let i=0;i<120;i++) near=adjustShot(near,"closer",2);
  assert.ok(cameraDistance(near)>=0.26-0.00001);
  assert.ok(adjustShot({...camera,fov:8},"zoom-in").fov>=8);
  assert.ok(adjustShot({...camera,fov:120},"zoom-out").fov<=120);
});

test("camera-relative waypoint adjustments never unexpectedly move the camera",()=>{
  const cam=createProject().camera;
  const start={x:0,y:0,z:0};
  const up=adjustWaypoint(start,cam,"up",0.25);
  assert.deepEqual(up,{x:0,y:0.25,z:0});
  const out=adjustWaypoint(up,cam,"down",0.25);
  assert.deepEqual(out,start);
  const moved=adjustWaypoint(start,cam,"forward",0.25);
  assert.equal(moved.y,0);
  assert.notDeepEqual(moved,start);
});
