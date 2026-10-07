// CollabRoom — 함께 그리기(협동 캔버스) Durable Object. **2026-10-07 기능 종료**(사용자: 거의 안 쓰고
// 실시간 사용량만 먹는다). 클라이언트 진입점·/api/collab 경로는 제거됐다.
//
// 클래스를 지우지 않고 빈 껍데기로 남기는 이유: wrangler.jsonc 의 DO 마이그레이션(v1 new_sqlite_classes)이
// 이 클래스를 선언하고 있어서, 지우려면 deleted_classes 마이그레이션이 필요하다 — 그건 남아 있는 방 저장소를
// 영구 삭제하는 되돌릴 수 없는 변경이라 별도 결정으로 미룬다. 아무도 연결하지 않으니 사용량은 0이다.
import type { Env } from "./types";

export class CollabRoom {
  constructor(_state: DurableObjectState, _env: Env) {}

  async fetch(): Promise<Response> {
    return new Response("collab ended", { status: 410 });
  }
}
