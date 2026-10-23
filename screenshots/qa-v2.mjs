import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

mkdirSync("/workspace/screenshots", { recursive: true });

function startPreview() {
  const child = spawn("/workspace/camera-v2/node_modules/.bin/vite", ["preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
    cwd: "/workspace/camera-v2",
    stdio: "ignore",
  });
  return child;
}

async function waitFor(url) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timed out waiting for " + url);
}

const preview = startPreview();
await waitFor("http://127.0.0.1:4173/");

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const failures = [];

function note(ok, message) {
  console.log(`${ok ? "PASS" : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
}

async function shot(page, name) {
  await page.screenshot({ path: `/workspace/screenshots/${name}.png` });
}

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desktop.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
await page.waitForSelector("canvas.stage-canvas");
await page.waitForTimeout(900);
const canvas = await page.locator("canvas.stage-canvas").boundingBox();
note(Boolean(canvas && canvas.width > 200 && canvas.height > 200), `desktop canvas ${canvas?.width}x${canvas?.height}`);
note(await page.locator("text=V2").count() > 0, "version badge visible");
const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
note(overflow, "desktop has no horizontal overflow");
await shot(page, "v2-desktop");

await page.getByRole("button", { name: "Add person" }).click();
await page.waitForTimeout(200);
note((await page.getByRole("button", { name: "Character B" }).count()) > 0, "added a second person");

await page.getByRole("button", { name: "Chair", exact: true }).click();
note((await page.getByRole("button", { name: /^Chair$/ }).count()) > 0, "chair is listed in the scene");

const beforeY = await page.locator("label", { hasText: "Pos Y" }).locator("input").inputValue();
await page.getByRole("button", { name: "Precision" }).click();
await page.getByRole("button", { name: "Move up" }).click();
await page.waitForTimeout(100);
const afterY = await page.locator("label", { hasText: "Pos Y" }).locator("input").inputValue();
note(Number(afterY) > Number(beforeY), `precision nudge raised Pos Y ${beforeY} -> ${afterY}`);

await page.getByRole("button", { name: "Close precision controls" }).click();
await page.getByRole("button", { name: "Movement control mode" }).click();
await page.locator("summary").filter({ hasText: "Add camera movement" }).first().click();
await page.getByRole("button", { name: /Custom path/ }).first().click();
await page.waitForTimeout(300);
note((await page.getByRole("button", { name: "Dragging floor" }).count()) > 0, "path floor/height toggle is visible");
await page.getByRole("button", { name: "Dragging floor" }).click();
note((await page.getByRole("button", { name: "Dragging height" }).count()) > 0, "path drag axis switches to height");

const beforeTime = await page.locator("text=/\\d+\\.\\d+s \\/ 15\\.0s/").first().innerText();
await page.getByRole("button", { name: "Play", exact: true }).click();
await page.waitForTimeout(1600);
const during = await page.locator("text=/\\d+\\.\\d+s \\/ 15\\.0s/").first().innerText();
note(parseFloat(during) > parseFloat(beforeTime) + 0.4, `playback advanced ${beforeTime} -> ${during}`);
await page.getByRole("button", { name: "Pause", exact: true }).click();
await shot(page, "v2-desktop-playing");

await page.getByRole("button", { name: "How to use" }).click();
await page.waitForTimeout(200);
note((await page.getByRole("heading", { name: "How to use the planner" }).count()) === 1, "offline help opens");
await shot(page, "v2-help");
await page.getByRole("button", { name: "Close help" }).click();

await page.getByRole("button", { name: "Saved shots" }).click();
await page.waitForTimeout(400);
note((await page.getByText("Saved on this device").count()) + (await page.getByText(/Untitled shot|Coverage|shot/).count()) > 0, "local save status or library is present");

note(errors.filter((e) => !/favicon|Download the React DevTools/.test(e)).length === 0, `desktop console errors: ${errors.join(" | ") || "none"}`);
await desktop.close();

async function checkLayout(name, width, height, dock) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: dock && width < 500,
  });
  const view = await context.newPage();
  const localErrors = [];
  view.on("pageerror", (error) => localErrors.push(String(error)));
  view.on("console", (msg) => {
    if (msg.type() === "error") localErrors.push(msg.text());
  });
  await view.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
  await view.waitForSelector("canvas.stage-canvas");
  await view.waitForTimeout(700);
  const box = await view.locator("canvas.stage-canvas").boundingBox();
  const noOverflow = await view.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  note(Boolean(box && box.width > 100 && box.height > 100) && noOverflow, `${name} canvas ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)} overflow=${!noOverflow}`);
  if (dock) {
    await view.getByRole("button", { name: "Add", exact: true }).click();
    await view.waitForTimeout(200);
    note((await view.getByRole("button", { name: "Add person" }).count()) > 0, `${name} bottom dock opens the library`);
    await view.getByRole("button", { name: "Time", exact: true }).click();
    await view.waitForTimeout(200);
    note((await view.getByRole("button", { name: "Play", exact: true }).count()) > 0, `${name} timeline is reachable`);
  } else {
    note((await view.getByRole("button", { name: "Add person" }).count()) > 0, `${name} side library is visible`);
    note((await view.getByRole("button", { name: "Play", exact: true }).count()) > 0, `${name} timeline is visible`);
  }
  await shot(view, name);
  note(localErrors.filter((e) => !/favicon|Download the React DevTools/.test(e)).length === 0, `${name} console: ${localErrors.join(" | ") || "clean"}`);
  await context.close();
}

await checkLayout("v2-phone-portrait", 412, 915, true);
await checkLayout("v2-phone-landscape", 915, 412, true);
await checkLayout("v2-tablet-portrait", 800, 1280, true);
await checkLayout("v2-tablet-landscape", 1180, 820, false);

const prod = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const built = await prod.newPage();
const prodErrors = [];
built.on("pageerror", (error) => prodErrors.push(String(error)));
built.on("console", (msg) => {
  if (msg.type() === "error") prodErrors.push(msg.text());
});
await built.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await built.waitForSelector("canvas.stage-canvas");
await built.waitForTimeout(800);
await shot(built, "v2-production");
const swReady = await built.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return reg.active?.scriptURL ?? "";
});
note(swReady.endsWith("/sw.js"), `production service worker active: ${swReady}`);
await built.reload({ waitUntil: "networkidle" });
await built.waitForSelector("canvas.stage-canvas");
await prod.setOffline(true);
const offlineResponse = await built.reload({ waitUntil: "domcontentloaded" }).then(() => true).catch((error) => String(error));
await built.waitForSelector("canvas.stage-canvas", { timeout: 8000 });
await built.waitForTimeout(600);
const offlineTitle = await built.title();
const offlineText = await built.locator("body").innerText();
note(offlineTitle.includes("V2") && offlineText.includes("Explore"), `offline reopen shows the planner (${offlineTitle})`);
await shot(built, "v2-offline");
note(prodErrors.filter((e) => !/favicon|Failed to fetch|net::ERR_INTERNET_DISCONNECTED|Download the React DevTools/.test(e)).length === 0, `production console: ${prodErrors.filter((e) => !/favicon|Download the React DevTools/.test(e)).join(" | ") || "clean"}`);
console.log("offline reload result", offlineResponse);

await browser.close();
preview.kill("SIGTERM");
if (failures.length) {
  console.error("FAILURES\n" + failures.join("\n"));
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
