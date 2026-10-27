/*
 * AutoSave: IndexedDB에 5초 디바운스로 캔버스 상태 저장 + 복구.
 * 브라우저 API 결합 모듈 — 순수 로직 아님(테스트는 fake-indexeddb 또는 E2E).
 */
const DB_NAME = "arton";
const STORE = "autosave";
const KEY = "current";

export interface SavedState {
  savedAt: number;
  width: number;
  height: number;
  mode: string;
  /** 레이어별 PNG blob(합성 전 원본 보존). isLineart/isBase는 복원 시 역할(잠금·위치·blend) 재현용 */
  layers: {
    id: string;
    name: string;
    visible: boolean;
    opacity: number;
    blend: string;
    isLineart?: boolean;
    isBase?: boolean;
    lineWeight?: number;
    lineDark?: number;
    png: Blob;
  }[];
  /** 무비 모드용 스트로크 로그 JSON */
  recorder: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB 미지원"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class AutoSave {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private pending: (() => SavedState | Promise<SavedState>) | null = null;
  private saving = false;
  /** 첫 schedule 시각 — 디바운스가 계속 리셋돼도 maxWait을 넘기면 강제 플러시 */
  private pendingSince = 0;

  constructor(debounceMs = 5000, maxWaitMs = 15000) {
    this.debounceMs = debounceMs;
    this.maxWaitMs = maxWaitMs;
  }

  /** 상태 스냅샷 팩토리를 등록 — 디바운스 후 1회만 실제 저장 */
  schedule(snapshot: () => SavedState | Promise<SavedState>): void {
    if (!this.pending) this.pendingSince = Date.now();
    this.pending = snapshot;
    if (this.timer) clearTimeout(this.timer);
    // 쉼 없이 그리면 디바운스가 무한 리셋 → 세션 내내 저장 0회(실측: 웨일북 화면 꺼짐 통유실).
    // 대기 시작 후 maxWait을 넘기면 디바운스를 무시하고 즉시 저장.
    const elapsed = Date.now() - this.pendingSince;
    const delay = elapsed >= this.maxWaitMs ? 0 : Math.min(this.debounceMs, this.maxWaitMs - elapsed);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  /** 저장 진행 중에 들어온 flush 요청 — 끝나고 한 번 더 저장한다(대기분 유실 방지) */
  private queued = false;

  async flush(): Promise<void> {
    if (!this.pending) return;
    // ⚠️ 진행 중이라고 그냥 return하면, 그때 쌓인 최신 획이 통째로 날아간다
    // (언마운트·탭 전환 flush와 겹치면 "예전 저장본만 남는" 사고 — 2026-07-13).
    if (this.saving) {
      this.queued = true;
      return;
    }
    this.saving = true;
    const snap = this.pending;
    this.pending = null;
    try {
      const state = await snap();
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(state, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      this.lastOk = true;
    } catch {
      /* 저장 실패(쿼터 초과 등) — 스냅샷을 되살려 다음 flush에서 재시도 */
      this.lastOk = false;
      if (!this.pending) this.pending = snap;
    } finally {
      this.saving = false;
      if (this.queued) {
        this.queued = false;
        await this.flush(); // 저장 중에 쌓인 최신 상태를 이어서 저장
      }
    }
  }

  private lastOk = false;

  /**
   * 지금 상태를 저장하고 «정말 써질 때까지» 기다린다 — 안전 새로고침 직전용.
   * flush() 는 저장 중이면 예약만 걸고 바로 돌아오므로, 새로고침이 그 사이에 끼면 최근 획이 날아간다.
   * false = 시간 안에 못 썼다(쿼터·IDB 오류) → 호출부는 새로고침하지 않는다.
   */
  async saveAndWait(snapshot: () => SavedState | Promise<SavedState>, timeoutMs = 8000): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = snapshot;
    this.pendingSince = 0;
    this.lastOk = false;
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (!this.saving && !this.pending && !this.queued) return this.lastOk;
      if (!this.saving) await this.flush();
      else await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  async restore(): Promise<SavedState | null> {
    try {
      const db = await openDb();
      const state = await new Promise<SavedState | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve((req.result as SavedState) ?? null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return state;
    } catch {
      return null;
    }
  }

  /** 대기 중인 저장 예약을 버린다 — "이전 상태를 저장할 이유가 사라진" 경우(새 그림)에만.
   * ⚠️ 이게 없으면 새 그림 직후 언마운트(캔버스 재마운트)의 flush 가 방금 지운 상태를 다시
   * 써 넣어, 새로 뜬 캔버스가 **빈 그림으로 [이어 그리기]를 권한다**(2026-09-01 교차검증). */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
    this.queued = false;
    this.pendingSince = 0;
  }

  async purge(): Promise<void> {
    try {
      const db = await openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
    } catch {
      /* noop */
    }
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
