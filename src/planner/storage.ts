import { projectFromJson, projectToJson, type Project } from "./project.ts";

const DB_NAME = "camera-pose-planner";
const DB_VERSION = 1;
const LAST_KEY = "camera-pose-planner:last";

export type StoredProject = {
  id: string;
  name: string;
  updatedAt: number;
  data: Project;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local project storage."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local storage request failed."));
  });
}

export async function saveProject(project: Project): Promise<void> {
  const record: StoredProject = {
    id: project.id,
    name: project.name,
    updatedAt: Date.now(),
    data: project,
  };
  try {
    localStorage.setItem(LAST_KEY, projectToJson(project));
  } catch {
    /* The browser may refuse a large write. IndexedDB remains the main copy. */
  }
  const db = await openDb();
  const tx = db.transaction(["projects", "meta"], "readwrite");
  tx.objectStore("projects").put(record);
  tx.objectStore("meta").put(project.id, "lastId");
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save the project."));
  });
  db.close();
}

export async function loadLastProject(): Promise<Project | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(["projects", "meta"], "readonly");
    const lastId = await requestToPromise(tx.objectStore("meta").get("lastId"));
    const record = lastId
      ? await requestToPromise<StoredProject | undefined>(tx.objectStore("projects").get(lastId as string))
      : undefined;
    db.close();
    if (record?.data) {
      const parsed = projectFromJson(JSON.stringify(record.data));
      if (parsed.project) return parsed.project;
    }
  } catch {
    /* Fall through to the localStorage mirror. */
  }
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    return projectFromJson(raw).project;
  } catch {
    return null;
  }
}

export async function listProjects(): Promise<StoredProject[]> {
  const db = await openDb();
  const tx = db.transaction("projects", "readonly");
  const all = await requestToPromise(tx.objectStore("projects").getAll() as IDBRequest<StoredProject[]>);
  db.close();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteStoredProject(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("projects", "readwrite");
  tx.objectStore("projects").delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not delete the project."));
  });
  db.close();
}
