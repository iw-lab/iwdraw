/* 샌드아트 자동저장 — IndexedDB 한 칸(이 기기 안에만). 그리기 자동저장(arton DB)과 따로 둔다. */
import type { SandSaved } from "./SandEngine";

const DB = "arton-sand";
const STORE = "state";
const KEY = "cur";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function loadSand(): Promise<SandSaved | null> {
  try {
    const db = await open();
    return await new Promise((res) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => res((r.result as SandSaved) ?? null);
      r.onerror = () => res(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function saveSand(s: SandSaved): Promise<boolean> {
  try {
    const db = await open();
    return await new Promise((res) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(s, KEY);
      tx.oncomplete = () => {
        db.close();
        res(true);
      };
      tx.onerror = () => {
        db.close();
        res(false);
      };
      tx.onabort = () => {
        db.close();
        res(false);
      };
    });
  } catch {
    return false;
  }
}

/** 설정(빛·모래·소리·굵기)은 작아서 localStorage */
const PREF = "arton.sand.pref";
export interface SandPref {
  light: string;
  sand: string;
  sound: boolean;
  sizes?: { pour: number; finger: number; palm: number };
}
export function loadPref(): SandPref {
  const d: SandPref = { light: "warm", sand: "dark", sound: true };
  try {
    const v = JSON.parse(localStorage.getItem(PREF) || "null");
    if (v && typeof v === "object") return { ...d, ...v };
  } catch {
    /* 사생활 보호 모드 */
  }
  return d;
}
export function savePref(p: SandPref): void {
  try {
    localStorage.setItem(PREF, JSON.stringify(p));
  } catch {
    /* 무시 */
  }
}
