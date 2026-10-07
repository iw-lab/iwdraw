// ArtON Cloudflare Worker — 정적 자산(out/) 서빙 + /api/* 백엔드.
// Supabase(Postgres+Auth+Storage+Realtime+Edge Functions) 전면 대체.
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { Env } from "./types";
import { hashPassword, verifyPassword, signJwt, verifyJwt } from "./lib/auth";
import {
  genId,
  genClassCode,
  CODE_RE,
  isBannedNickname,
  hashIp,
  parseCookies,
  serializeCookie,
  SESSION_COOKIE,
} from "./lib/util";
import { sanitizeTitle } from "./lib/title";

export { CollabRoom } from "./collab";

type Vars = { teacherId: string; studentId: string; studentClassId: string };
type AppContext = Context<{ Bindings: Env; Variables: Vars }>;
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ── 전역 보안 응답 헤더(API 응답) ──
// 정적 페이지(out/)는 public/_headers가 담당. 여기선 Worker가 내는 /api/* 응답에 부여.
// MIME 스니핑·클릭재킹·리퍼러 유출·불필요 권한을 방어(defense-in-depth).
app.use("*", async (c, next) => {
  await next();
  // 웹소켓 업그레이드(101)·DO 프록시 응답은 헤더가 immutable → 건드리면 업그레이드가 깨진다
  if (c.req.header("Upgrade")?.toLowerCase() === "websocket" || c.res.status === 101) return;
  try {
    const h = c.res.headers;
    h.set("X-Content-Type-Options", "nosniff");
    h.set("X-Frame-Options", "DENY"); // API 응답은 프레임에 뜰 일이 없다
    h.set("Referrer-Policy", "strict-origin-when-cross-origin");
    h.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    // JSON API 응답만 캐시 금지(세션·개인정보 노출 방지). 이미지 라우트가 이미 지정한
    // Cache-Control(private, max-age=600)은 덮어쓰지 않는다 — R2 읽기 폭증 방지.
    if (!h.has("Cache-Control")) h.set("Cache-Control", "no-store");
    if (new URL(c.req.url).protocol === "https:") {
      h.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
  } catch {
    /* immutable 헤더(외부 fetch/DO 프록시 응답) — 보안헤더 부여 생략, 요청은 정상 */
  }
});

// ── 상수(Supabase Edge Function 포팅) ──
const RATE_WINDOW_MS = 5 * 60_000;
const RATE_MAX = 8; // 학생 join 시도 상한/윈도우
const AUTH_RATE_MAX = 10; // 교사 로그인·가입 시도 상한/윈도우(크리덴셜 스터핑 방어)
const AUTH_MARKER = "__AUTH__"; // join_attempts 재사용 시 교사 인증 시도 표식
const MODES = ["sketch", "watercolor", "oil", "coloring"];
const MAX_BYTES = 8 * 1024 * 1024;
const DAY_MS = 86_400_000;
const RETENTION_MS = 180 * DAY_MS; // 작품 보관 기간(6개월). 이후 매일 cron이 영구 삭제.
const WARN_MS = 30 * DAY_MS; // 삭제 30일 전부터 선생님께 임박 안내(대시보드/갤러리 배지).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30일
// 12시간 — 6시간은 오전에 입장한 학급이 오후 수업 중 갑자기 만료되어 "학급 코드
// 연결이 끊겼습니다"가 뜨고 그리던 그림을 저장조차 못 했다(2026-07-13 사용자 실측).
// 클라이언트도 401이면 조용히 재입장해 재시도한다(src/lib/student-auth.ts) — 이중 방어.
const STUDENT_TTL_SEC = 60 * 60 * 12;
// 미가입 이메일 로그인 시 타이밍 균일화용 더미(존재하는 계정과 동일한 PBKDF2 비용 지불).
const DUMMY_HASH = "A".repeat(43);
const DUMMY_SALT = "A".repeat(22);

// FormData 파일 추출(instanceof File은 workers-types에서 문자열 유니온과 충돌 → 덕타이핑)
function fileOrNull(v: File | string | null): File | null {
  return v && typeof v !== "string" ? v : null;
}

/** 2026-09-01 title 마이그레이션이 아직 안 돌아간 DB인가 — 그 경우에만 제목을 포기하고 재시도한다.
 * (다른 DB 오류까지 삼키면 진짜 장애가 조용히 묻힌다.) */
function isMissingTitleColumn(e: unknown): boolean {
  return /no such column:?\s*(main\.)?(artworks\.)?title/i.test(String(e));
}

function clientIp(c: AppContext): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

// join_attempts 재사용 IP rate limit(교사 인증·학생 join 공용). marker로 카운트 분리.
async function ipAttemptCount(c: AppContext, ipHash: string, marker: string): Promise<number> {
  const since = Date.now() - RATE_WINDOW_MS;
  const r = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM join_attempts WHERE ip_hash = ? AND code_tried = ? AND created_at >= ?",
  )
    .bind(ipHash, marker, since)
    .first<{ n: number }>();
  return r?.n ?? 0;
}
async function recordAttempt(c: AppContext, ipHash: string, marker: string, success: boolean): Promise<void> {
  await c.env.DB.prepare("INSERT INTO join_attempts (ip_hash, code_tried, success) VALUES (?, ?, ?)")
    .bind(ipHash, marker, success ? 1 : 0)
    .run();
}

// ── 교사 세션 쿠키 ──
async function setSession(
  c: AppContext,
  teacher: { id: string; email: string; name: string; plan: string },
) {
  const token = await signJwt(
    { sub: teacher.id, email: teacher.email, name: teacher.name, plan: teacher.plan },
    c.env.SESSION_SECRET,
    SESSION_TTL_SEC,
  );
  // http(비-https)로 뜬 환경(로컬 LAN/터널)에서 Secure 쿠키 미저장 방지 — 요청 스킴 기반.
  const secure = new URL(c.req.url).protocol === "https:";
  c.header(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, token, {
      maxAge: SESSION_TTL_SEC,
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
    }),
  );
}

async function currentTeacherId(c: AppContext): Promise<string | null> {
  const cookies = parseCookies(c.req.header("Cookie") ?? null);
  const tok = cookies[SESSION_COOKIE];
  if (!tok) return null;
  const payload = await verifyJwt<{ sub: string }>(tok, c.env.SESSION_SECRET);
  return payload?.sub ?? null;
}

// 교사 인증 미들웨어
async function requireTeacher(c: AppContext, next: Next) {
  const id = await currentTeacherId(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  // 교사 행이 실제로 있는지 재확인 — 탈퇴/삭제된 교사의 잔존 세션(다른 기기·탈취 쿠키)을
  // 즉시 차단하고, 삭제된 teacher_id를 참조하는 고아 INSERT(예: 학급 생성)를 막는다.
  const exists = await c.env.DB.prepare("SELECT 1 FROM teachers WHERE id = ?").bind(id).first();
  if (!exists) return c.json({ error: "unauthorized" }, 401);
  c.set("teacherId", id);
  await next();
}

// 학생 인증 미들웨어(Bearer JWT) — 토큰 위조 이중 방어로 학급 소속 재확인
async function requireStudent(c: AppContext, next: Next) {
  const auth = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const claims = await verifyJwt<{ student_id: string; class_id: string }>(auth, c.env.STUDENT_JWT_SECRET);
  if (!claims?.student_id || !claims?.class_id) return c.json({ error: "unauthorized" }, 401);
  const student = await c.env.DB.prepare("SELECT id FROM students WHERE id = ? AND class_id = ?")
    .bind(claims.student_id, claims.class_id)
    .first();
  if (!student) return c.json({ error: "unauthorized" }, 401);
  c.set("studentId", claims.student_id);
  c.set("studentClassId", claims.class_id);
  await next();
}

// 도안 배포 image 경로 화이트리스트 — 정적 /templates/ 안의 이미지 파일만(외부 URL/트래버설 차단)
const TEMPLATE_IMAGE_RE = /^\/templates\/[a-z0-9_\-/]+\.(webp|png|jpg|jpeg)$/i;

// ══════════════════════ 교사 인증 ══════════════════════
app.post("/api/teacher/signup", async (c) => {
  let body: {
    email?: string;
    password?: string;
    name?: string;
    agreed?: boolean;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const name = (body.name ?? "선생님").trim().slice(0, 20) || "선생님";
  if (!EMAIL_RE.test(email)) return c.json({ error: "invalid_email" }, 400);
  if (password.length < 8) return c.json({ error: "weak_password" }, 400);
  // 개인정보 수집·이용 동의는 서버에서도 강제(프런트 체크만으로는 입증 불가) — PIPA §15·§22
  if (body.agreed !== true) return c.json({ error: "consent_required" }, 400);

  // 크리덴셜 스터핑/무차별 대입 방어(IP rate limit) — login과 예산 공유
  const ipHash = await hashIp(clientIp(c));
  if ((await ipAttemptCount(c, ipHash, AUTH_MARKER)) >= AUTH_RATE_MAX) {
    await recordAttempt(c, ipHash, AUTH_MARKER, false);
    return c.json({ error: "rate_limited" }, 429);
  }

  const existing = await c.env.DB.prepare("SELECT id FROM teachers WHERE email = ?").bind(email).first();
  if (existing) {
    await recordAttempt(c, ipHash, AUTH_MARKER, false);
    return c.json({ error: "email_taken" }, 409);
  }

  const { hash, salt } = await hashPassword(password);
  const id = genId();
  try {
    await c.env.DB.prepare(
      "INSERT INTO teachers (id, email, name, password_hash, password_salt, agreed_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, email, name, hash, salt, Date.now())
      .run();
  } catch (e) {
    // 동시 중복 가입 레이스: UNIQUE(email) 충돌 → email_taken으로 정규화
    if (String(e).includes("UNIQUE")) return c.json({ error: "email_taken" }, 409);
    return c.json({ error: "server" }, 500);
  }
  // 구독 row는 휴면 결제 스캐폴딩 — 실패해도 교사 계정은 정상 동작하므로 non-fatal.
  try {
    await c.env.DB.prepare("INSERT INTO subscriptions (id, teacher_id) VALUES (?, ?)").bind(genId(), id).run();
  } catch {
    /* 구독 생성 실패 무시(가입 자체는 성공 처리) */
  }
  await recordAttempt(c, ipHash, AUTH_MARKER, true);

  const teacher = { id, email, name, plan: "free" };
  await setSession(c, teacher);
  return c.json(teacher);
});

app.post("/api/teacher/login", async (c) => {
  let body: { email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!EMAIL_RE.test(email) || !password) return c.json({ error: "invalid" }, 400);

  // 크리덴셜 스터핑/무차별 대입 방어(IP rate limit)
  const ipHash = await hashIp(clientIp(c));
  if ((await ipAttemptCount(c, ipHash, AUTH_MARKER)) >= AUTH_RATE_MAX) {
    await recordAttempt(c, ipHash, AUTH_MARKER, false);
    return c.json({ error: "rate_limited" }, 429);
  }

  const t = await c.env.DB.prepare(
    "SELECT id, email, name, plan, password_hash, password_salt FROM teachers WHERE email = ?",
  )
    .bind(email)
    .first<{ id: string; email: string; name: string; plan: string; password_hash: string; password_salt: string }>();
  // 미가입 이메일도 더미 검증으로 타이밍 균일화(이메일 열거 방어)
  let ok = false;
  if (t) ok = await verifyPassword(password, t.password_hash, t.password_salt);
  else await verifyPassword(password, DUMMY_HASH, DUMMY_SALT);
  if (!t || !ok) {
    await recordAttempt(c, ipHash, AUTH_MARKER, false);
    return c.json({ error: "invalid_credentials" }, 401);
  }
  await recordAttempt(c, ipHash, AUTH_MARKER, true);
  const teacher = { id: t.id, email: t.email, name: t.name, plan: t.plan };
  await setSession(c, teacher);
  return c.json(teacher);
});

app.post("/api/teacher/logout", (c) => {
  const secure = new URL(c.req.url).protocol === "https:";
  c.header(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, "", { maxAge: 0, httpOnly: true, secure, sameSite: "Lax", path: "/" }),
  );
  return c.json({ ok: true });
});

app.get("/api/teacher/me", async (c) => {
  const id = await currentTeacherId(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const t = await c.env.DB.prepare("SELECT id, email, name, plan FROM teachers WHERE id = ?")
    .bind(id)
    .first();
  if (!t) return c.json({ error: "unauthorized" }, 401);
  return c.json(t);
});

// ── 회원탈퇴(개인정보 파기, PIPA §36 삭제·§37 처리정지) ──
// 비밀번호 재확인 후 교사 계정과 그에 딸린 개인정보·데이터를 되돌릴 수 없게 파기한다.
// 스키마의 ON DELETE CASCADE(D1은 FK 기본 강제)에만 기대지 않고 자식 테이블부터 명시적으로
// 삭제한다(이중 방어) — R2 작품 이미지는 CASCADE가 못 지우므로 D1 삭제 전에 키를 수집해 지운다.
// 세션 쿠키도 즉시 무효화.
app.post("/api/teacher/delete-account", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  let body: { password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  const password = body.password ?? "";

  // 비밀번호 재확인 — 세션 탈취/CSRF로 남의 계정을 삭제하는 것 방지. 브루트포스 방어(rate limit).
  const ipHash = await hashIp(clientIp(c));
  if ((await ipAttemptCount(c, ipHash, AUTH_MARKER)) >= AUTH_RATE_MAX) {
    await recordAttempt(c, ipHash, AUTH_MARKER, false);
    return c.json({ error: "rate_limited" }, 429);
  }
  const t = await c.env.DB.prepare("SELECT password_hash, password_salt FROM teachers WHERE id = ?")
    .bind(teacherId)
    .first<{ password_hash: string; password_salt: string }>();
  if (!t) return c.json({ error: "unauthorized" }, 401);
  const ok = await verifyPassword(password, t.password_hash, t.password_salt);
  if (!ok) {
    await recordAttempt(c, ipHash, AUTH_MARKER, false);
    return c.json({ error: "invalid_password" }, 403);
  }

  // R2 작품 이미지 먼저 수집·삭제(이 교사의 모든 학급 작품). 실패해도 DB 파기는 진행.
  const { results } = await c.env.DB.prepare(
    `SELECT a.image_path, a.thumb_path, a.timelapse_path
       FROM artworks a JOIN classes c ON a.class_id = c.id
      WHERE c.teacher_id = ?`,
  )
    .bind(teacherId)
    .all<{
      image_path: string;
      thumb_path: string;
      timelapse_path: string | null;
    }>();
  const keys = (results ?? [])
    .flatMap((r) => [r.image_path, r.thumb_path, r.timelapse_path])
    .filter((k): k is string => typeof k === "string" && k.length > 0);
  if (keys.length) {
    // R2 delete는 배치 1000개 상한 — 초과 시 청크(대량 작품 교사 방어).
    // 실패해도 교사의 삭제 요청(개인정보 파기)은 진행해야 하므로 DB 파기를 막지 않되,
    // D1 행이 사라지면 이 키를 다시 찾을 근거가 없어지므로 실패 키를 반드시 로그로 남긴다
    // (조용히 삼키면 아동 작품 이미지가 R2에 영구 고아로 남아 추적 불가 — 교차검증 지적).
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      try {
        await c.env.BUCKET.delete(chunk);
      } catch (e) {
        console.error("[delete-account] R2 purge failed", {
          teacherId,
          keys: chunk,
          err: String(e),
        });
      }
    }
  }

  // D1 파기 — 자식 테이블부터 명시 삭제. batch()는 SQL 트랜잭션이라 원자적(부분 삭제 방지).
  // 서브쿼리 기반이라 파라미터 상한 무관. (스키마에 ON DELETE CASCADE가 있어 실제로도 연쇄되지만,
  // 순서상 자식부터 지우므로 cascade 동작 여부와 무관하게 결과가 동일한 이중 방어.)
  // 실패 시 계정은 남고 R2 이미지만 먼저 지워진 부분상태가 되지만, 재시도하면 남은 행 기준으로
  // 다시 파기가 진행되어 수렴한다 — 클라이언트가 재시도를 안내할 수 있게 명확한 JSON 오류를 준다.
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `DELETE FROM artwork_likes WHERE artwork_id IN
         (SELECT a.id FROM artworks a JOIN classes c ON a.class_id = c.id WHERE c.teacher_id = ?)`,
      ).bind(teacherId),
      c.env.DB.prepare(
        `DELETE FROM artworks WHERE class_id IN (SELECT id FROM classes WHERE teacher_id = ?)`,
      ).bind(teacherId),
      c.env.DB.prepare(
        `DELETE FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id = ?)`,
      ).bind(teacherId),
      c.env.DB.prepare(
        `DELETE FROM assignments WHERE class_id IN (SELECT id FROM classes WHERE teacher_id = ?)`,
      ).bind(teacherId),
      c.env.DB.prepare(
        `DELETE FROM collab_rooms WHERE host_teacher_id = ?
         OR class_id IN (SELECT id FROM classes WHERE teacher_id = ?)`,
      ).bind(teacherId, teacherId),
      c.env.DB.prepare("DELETE FROM classes WHERE teacher_id = ?").bind(teacherId),
      c.env.DB.prepare("DELETE FROM payments WHERE teacher_id = ?").bind(teacherId),
      c.env.DB.prepare("DELETE FROM subscriptions WHERE teacher_id = ?").bind(teacherId),
      c.env.DB.prepare("DELETE FROM teachers WHERE id = ?").bind(teacherId),
    ]);
  } catch (e) {
    console.error("[delete-account] D1 purge failed", {
      teacherId,
      err: String(e),
    });
    return c.json({ error: "delete_failed" }, 500);
  }

  // 세션 쿠키 무효화
  const secure = new URL(c.req.url).protocol === "https:";
  c.header(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, "", {
      maxAge: 0,
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
    }),
  );
  return c.json({ ok: true });
});

// ══════════════════════ 교사: 학급 ══════════════════════
app.get("/api/classes", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  // expiring_soon = 삭제 30일 이내 작품 수(created_at ≤ now−150일). 대시보드 임박 배너용.
  const warnBefore = Date.now() - (RETENTION_MS - WARN_MS);
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.code, c.is_active, c.created_at, COUNT(s.id) AS student_count,
       (SELECT COUNT(*) FROM artworks a WHERE a.class_id = c.id AND a.created_at <= ?) AS expiring_soon
     FROM classes c LEFT JOIN students s ON s.class_id = c.id
     WHERE c.teacher_id = ?
     GROUP BY c.id ORDER BY c.created_at DESC`,
  )
    .bind(warnBefore, teacherId)
    .all<{ id: string; name: string; code: string; is_active: number; created_at: number; student_count: number; expiring_soon: number }>();
  return c.json(
    (results ?? []).map((r) => ({ ...r, is_active: !!r.is_active })),
  );
});

app.post("/api/classes", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  let body: { name?: string };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const name = (body.name ?? "우리 반").trim().slice(0, 30) || "우리 반";
  // 코드 충돌 재시도(최대 5)
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = genId();
    const code = genClassCode();
    try {
      await c.env.DB.prepare("INSERT INTO classes (id, teacher_id, name, code) VALUES (?, ?, ?, ?)")
        .bind(id, teacherId, name, code)
        .run();
      return c.json({ id, name, code, is_active: true, created_at: Date.now(), student_count: 0 });
    } catch (e) {
      if (String(e).includes("UNIQUE") && attempt < 4) continue;
      return c.json({ error: "server" }, 500);
    }
  }
  return c.json({ error: "server" }, 500);
});

app.patch("/api/classes/:id", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  const id = c.req.param("id");
  let body: { is_active?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  if (typeof body.is_active !== "boolean") return c.json({ error: "bad_request" }, 400);
  const res = await c.env.DB.prepare("UPDATE classes SET is_active = ? WHERE id = ? AND teacher_id = ?")
    .bind(body.is_active ? 1 : 0, id, teacherId)
    .run();
  if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

app.post("/api/classes/:id/code", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  const id = c.req.param("id");
  // 소유 확인
  const owned = await c.env.DB.prepare("SELECT id FROM classes WHERE id = ? AND teacher_id = ?")
    .bind(id, teacherId)
    .first();
  if (!owned) return c.json({ error: "not_found" }, 404);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genClassCode();
    try {
      // 소유권 조건을 UPDATE에 직접 포함(단일 원자 쿼리 — 다른 핸들러와 패턴 통일)
      await c.env.DB.prepare("UPDATE classes SET code = ? WHERE id = ? AND teacher_id = ?")
        .bind(code, id, teacherId)
        .run();
      return c.json({ code });
    } catch (e) {
      if (String(e).includes("UNIQUE") && attempt < 4) continue;
      return c.json({ error: "server" }, 500);
    }
  }
  return c.json({ error: "server" }, 500);
});

// ══════════════════════ 교사: 작품 ══════════════════════
app.get("/api/classes/:id/artworks", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  const id = c.req.param("id");
  const owned = await c.env.DB.prepare("SELECT id FROM classes WHERE id = ? AND teacher_id = ?")
    .bind(id, teacherId)
    .first();
  if (!owned) return c.json({ error: "not_found" }, 404);
  /* title 컬럼이 없는(마이그레이션 미적용) DB에서도 교사 갤러리는 열려야 한다 — 제목만 빠진다 */
  const listArtworks = (withTitle: boolean) =>
    c.env.DB.prepare(
      `SELECT a.id, a.student_id, a.mode, a.thumb_path, a.image_path, a.is_approved, a.like_count, a.created_at,
              ${withTitle ? "a.title," : "NULL AS title,"} s.nickname
     FROM artworks a JOIN students s ON s.id = a.student_id
     WHERE a.class_id = ? ORDER BY a.created_at DESC`,
    )
      .bind(id)
      .all<{ is_approved: number; created_at: number; [k: string]: unknown }>();
  const { results } = await listArtworks(true).catch((e) => {
    if (!isMissingTitleColumn(e)) throw e;
    return listArtworks(false);
  });
  return c.json(
    (results ?? []).map((r) => ({
      ...r,
      is_approved: !!r.is_approved,
      expires_at: r.created_at + RETENTION_MS, // 이 시각 이후 cron이 영구 삭제
    })),
  );
});

/* 학급 학생(별명) 명단 — 아이가 별명을 까먹으면 선생님이 여기서 찾아 알려준다.
 * 작품 수·마지막 활동을 함께 줘 재입장 실수로 생긴 "빈 학생"도 구분 가능. */
app.get("/api/classes/:id/students", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  const id = c.req.param("id");
  const owned = await c.env.DB.prepare("SELECT id FROM classes WHERE id = ? AND teacher_id = ?")
    .bind(id, teacherId)
    .first();
  if (!owned) return c.json({ error: "not_found" }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.nickname, s.created_at,
            COUNT(a.id) AS artwork_count, MAX(a.created_at) AS last_artwork_at
     FROM students s LEFT JOIN artworks a ON a.student_id = s.id
     WHERE s.class_id = ?
     GROUP BY s.id ORDER BY s.created_at ASC`,
  )
    .bind(id)
    .all();
  return c.json(results ?? []);
});

app.patch("/api/artworks/:id", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  const id = c.req.param("id");
  let body: { is_approved?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  if (typeof body.is_approved !== "boolean") return c.json({ error: "bad_request" }, 400);
  const res = await c.env.DB.prepare(
    `UPDATE artworks SET is_approved = ?
     WHERE id = ? AND class_id IN (SELECT id FROM classes WHERE teacher_id = ?)`,
  )
    .bind(body.is_approved ? 1 : 0, id, teacherId)
    .run();
  if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// 작품 영구 삭제(교사 큐레이션) — 소유 학급의 작품만. 승인 게이트 대신 사후 정리 수단.
// 원칙은 만료 purge와 동일: R2 객체 삭제가 성공해야 D1 행을 지운다(깨진 썸네일 orphan 방지),
// D1은 likes+artworks를 batch로 원자 삭제.
app.delete("/api/artworks/:id", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT a.image_path, a.thumb_path, a.timelapse_path
     FROM artworks a JOIN classes cl ON cl.id = a.class_id
     WHERE a.id = ? AND cl.teacher_id = ?`,
  )
    .bind(id, teacherId)
    .first<{ image_path: string; thumb_path: string; timelapse_path: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const paths = [row.image_path, row.thumb_path, ...(row.timelapse_path ? [row.timelapse_path] : [])];
  try {
    await Promise.all(paths.map((p) => c.env.BUCKET.delete(p)));
  } catch {
    // R2 삭제 실패 — D1을 지우지 않고 그대로 둔다(교사가 다시 시도 가능)
    return c.json({ error: "storage" }, 500);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM artwork_likes WHERE artwork_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM artworks WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

// 작품 이미지 스트리밍(Supabase signed URL 대체). 교사가 해당 학급 소유 시에만.
app.get("/api/artwork/file", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  const path = c.req.query("path") ?? "";
  // path = classId/studentId/artId.ext — 경로 주입 방어
  if (!/^[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9-]+(\.[a-z]+)+$/i.test(path)) {
    return c.json({ error: "bad_path" }, 400);
  }
  const classId = path.split("/")[0];
  const owned = await c.env.DB.prepare("SELECT id FROM classes WHERE id = ? AND teacher_id = ?")
    .bind(classId, teacherId)
    .first();
  if (!owned) return c.json({ error: "forbidden" }, 403);
  // 해당 path가 실제 artworks row에 등록된 파일인지 재확인(orphan/미등록 객체 UUID 추측 접근 차단)
  const known = await c.env.DB.prepare(
    "SELECT 1 FROM artworks WHERE class_id = ? AND (image_path = ? OR thumb_path = ? OR timelapse_path = ?) LIMIT 1",
  )
    .bind(classId, path, path, path)
    .first();
  if (!known) return c.json({ error: "not_found" }, 404);
  const obj = await c.env.BUCKET.get(path);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=600");
  return new Response(obj.body, { headers });
});

// ══════════════════════ 교사: 도안 배포 ══════════════════════
app.get("/api/classes/:id/assignment", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  const id = c.req.param("id");
  const owned = await c.env.DB.prepare("SELECT id FROM classes WHERE id = ? AND teacher_id = ?")
    .bind(id, teacherId)
    .first();
  if (!owned) return c.json({ error: "not_found" }, 404);
  const a = await c.env.DB.prepare(
    "SELECT id, template_id, title, image, note, created_at FROM assignments WHERE class_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1",
  )
    .bind(id)
    .first();
  return c.json({ assignment: a ?? null });
});

app.put("/api/classes/:id/assignment", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  const id = c.req.param("id");
  const owned = await c.env.DB.prepare("SELECT id FROM classes WHERE id = ? AND teacher_id = ?")
    .bind(id, teacherId)
    .first();
  if (!owned) return c.json({ error: "not_found" }, 404);
  let body: { template_id?: string; title?: string; image?: string; note?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  // 런타임 타입 검증 — 문자열 아닌 값은 .trim()에서 500이 나지 않게 400으로
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const templateId = str(body.template_id).trim().slice(0, 80);
  const title = str(body.title).trim().slice(0, 60);
  const image = str(body.image).trim();
  const note = str(body.note).trim().slice(0, 200);
  if (!templateId || !TEMPLATE_IMAGE_RE.test(image)) return c.json({ error: "bad_request" }, 400);
  const aid = genId();
  // batch = 단일 트랜잭션 — 비활성화와 삽입 사이에 실패해도 "활성 0건" 상태로 남지 않는다
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE assignments SET is_active = 0 WHERE class_id = ?").bind(id),
    c.env.DB.prepare(
      "INSERT INTO assignments (id, class_id, template_id, title, image, note) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(aid, id, templateId, title, image, note),
  ]);
  return c.json({ id: aid });
});

app.delete("/api/classes/:id/assignment", requireTeacher, async (c) => {
  const teacherId = c.get("teacherId");
  const id = c.req.param("id");
  // 소유권을 UPDATE 조건에 직접 포함(단일 원자 쿼리)
  await c.env.DB.prepare(
    "UPDATE assignments SET is_active = 0 WHERE class_id = ? AND class_id IN (SELECT id FROM classes WHERE teacher_id = ?)",
  )
    .bind(id, teacherId)
    .run();
  return c.json({ ok: true });
});

// ══════════════════════ 학생: 배포된 도안 조회 ══════════════════════
app.get("/api/student/assignment", requireStudent, async (c) => {
  const a = await c.env.DB.prepare(
    "SELECT id, template_id, title, image, note, created_at FROM assignments WHERE class_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1",
  )
    .bind(c.get("studentClassId"))
    .first();
  return c.json({ assignment: a ?? null });
});

// ══════════════════════ 학생: 학급 갤러리(승인작만) ══════════════════════
app.get("/api/student/gallery", requireStudent, async (c) => {
  const classId = c.get("studentClassId");
  const studentId = c.get("studentId");
  // 승인작 전체 + 본인 미승인작(승인 대기 표시용) — /api/student/file의 접근 규칙과 동일 정책
  /* title 컬럼이 없는(마이그레이션 미적용) DB에서도 갤러리는 열려야 한다 — 제목만 빠진다 */
  const listGallery = (withTitle: boolean) =>
    c.env.DB.prepare(
    `SELECT a.id, a.mode, a.thumb_path, a.image_path, a.like_count, a.created_at, a.is_approved, ${withTitle ? "a.title," : "NULL AS title,"} s.nickname,
            EXISTS(SELECT 1 FROM artwork_likes al WHERE al.artwork_id = a.id AND al.voter_key = ?) AS liked,
            (a.student_id = ?) AS mine
     FROM artworks a JOIN students s ON s.id = a.student_id
     WHERE a.class_id = ? AND (a.is_approved = 1 OR a.student_id = ?)
     ORDER BY a.created_at DESC LIMIT 200`,
    )
      .bind(studentId, studentId, classId, studentId)
      .all<{ liked: number; mine: number; is_approved: number; [k: string]: unknown }>();
  const { results } = await listGallery(true).catch((e) => {
    if (!isMissingTitleColumn(e)) throw e;
    return listGallery(false);
  });
  return c.json(
    (results ?? []).map((r) => ({ ...r, liked: !!r.liked, mine: !!r.mine, is_approved: !!r.is_approved })),
  );
});

// 좋아요 토글 — voter_key = studentId(PK 중복 방지), like_count는 원천 재집계로 갱신
app.post("/api/student/artworks/:id/like", requireStudent, async (c) => {
  const classId = c.get("studentClassId");
  const studentId = c.get("studentId");
  const artId = c.req.param("id");
  const art = await c.env.DB.prepare(
    "SELECT id FROM artworks WHERE id = ? AND class_id = ? AND is_approved = 1",
  )
    .bind(artId, classId)
    .first();
  if (!art) return c.json({ error: "not_found" }, 404);
  const existing = await c.env.DB.prepare(
    "SELECT 1 FROM artwork_likes WHERE artwork_id = ? AND voter_key = ?",
  )
    .bind(artId, studentId)
    .first();
  // 쓰기+재집계를 batch(단일 트랜잭션)로 — like_count가 원천과 어긋난 순간이 없게.
  // 동시 더블탭 레이스: 둘 다 INSERT를 타면 한쪽이 PK 충돌 → "이미 좋아요" 상태로 정규화
  // (count는 원천 재집계라 항상 정합, 토글이 좋아요 쪽으로 수렴하는 것은 의도된 완화)
  const recount = c.env.DB.prepare(
    "UPDATE artworks SET like_count = (SELECT COUNT(*) FROM artwork_likes WHERE artwork_id = ?) WHERE id = ?",
  ).bind(artId, artId);
  if (existing) {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM artwork_likes WHERE artwork_id = ? AND voter_key = ?").bind(artId, studentId),
      recount,
    ]);
  } else {
    try {
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO artwork_likes (artwork_id, voter_key) VALUES (?, ?)").bind(artId, studentId),
        recount,
      ]);
    } catch (e) {
      if (!String(e).includes("UNIQUE")) return c.json({ error: "server" }, 500);
      await recount.run(); // 충돌 시 batch 전체가 롤백되므로 재집계만 별도 수행
    }
  }
  const row = await c.env.DB.prepare("SELECT like_count FROM artworks WHERE id = ?")
    .bind(artId)
    .first<{ like_count: number }>();
  return c.json({ liked: !existing, like_count: row?.like_count ?? 0 });
});

// 학생용 작품 이미지 — 자기 학급 + (승인작 또는 본인 작품)만 스트리밍
app.get("/api/student/file", requireStudent, async (c) => {
  const classId = c.get("studentClassId");
  const studentId = c.get("studentId");
  const path = c.req.query("path") ?? "";
  if (!/^[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9-]+(\.[a-z]+)+$/i.test(path)) {
    return c.json({ error: "bad_path" }, 400);
  }
  if (path.split("/")[0] !== classId) return c.json({ error: "forbidden" }, 403);
  const known = await c.env.DB.prepare(
    `SELECT 1 FROM artworks
     WHERE class_id = ? AND (image_path = ? OR thumb_path = ? OR timelapse_path = ?)
       AND (is_approved = 1 OR student_id = ?) LIMIT 1`,
  )
    .bind(classId, path, path, path, studentId)
    .first();
  if (!known) return c.json({ error: "not_found" }, 404);
  const obj = await c.env.BUCKET.get(path);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=600");
  return new Response(obj.body, { headers });
});

// ══════════════════════ 학생: 학급 입장(join-class 포팅) ══════════════════════
app.post("/api/join", async (c) => {
  const ipHash = await hashIp(clientIp(c));

  let body: { code?: string; nickname?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  const code = (body.code ?? "").toUpperCase().trim();
  const nickname = (body.nickname ?? "").trim();
  if (!CODE_RE.test(code)) return c.json({ error: "invalid_code" }, 400);
  if (nickname.length < 1 || nickname.length > 12) return c.json({ error: "bad_nickname" }, 400);
  if (isBannedNickname(nickname)) return c.json({ error: "bad_nickname" }, 400);

  // rate limit(슬라이딩 윈도우) — 실패 시도(success=0)만 카운트.
  // 교실은 한 공용 IP(NAT) 뒤에서 다수 학생이 정상 입장하므로 성공 join은 제외해야
  // 30명 학급의 9번째부터 차단되는 오작동을 막는다. 브루트포스=코드 오답(success=0)만 제한.
  // 교사 인증 표식(__AUTH__)도 제외해 카운트 분리.
  const since = Date.now() - RATE_WINDOW_MS;
  const rl = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM join_attempts WHERE ip_hash = ? AND code_tried != ? AND success = 0 AND created_at >= ?",
  )
    .bind(ipHash, AUTH_MARKER, since)
    .first<{ n: number }>();
  if ((rl?.n ?? 0) >= RATE_MAX) {
    await c.env.DB.prepare("INSERT INTO join_attempts (ip_hash, code_tried, success) VALUES (?, ?, 0)")
      .bind(ipHash, code)
      .run();
    return c.json({ error: "rate_limited" }, 429);
  }

  // 코드 검증
  const cls = await c.env.DB.prepare("SELECT id, name, is_active, teacher_id FROM classes WHERE code = ?")
    .bind(code)
    .first<{ id: string; name: string; is_active: number; teacher_id: string }>();
  if (!cls || !cls.is_active) {
    await c.env.DB.prepare("INSERT INTO join_attempts (ip_hash, code_tried, success) VALUES (?, ?, 0)")
      .bind(ipHash, code)
      .run();
    return c.json({ error: cls ? "inactive" : "invalid_code" }, 404);
  }

  // 같은 별명 재입장 = 기존 학생 재사용 — 매 입장마다 새 행이 쌓여 "20명 반이 정원 초과"가
  // 나던 버그(2026-07-09 실사용 보고)의 정공법. 토큰(6h) 만료 후 재입장해도 내 작품·좋아요 유지.
  const existing = await c.env.DB.prepare(
    "SELECT id FROM students WHERE class_id = ? AND nickname = ?",
  )
    .bind(cls.id, nickname)
    .first<{ id: string }>();
  let studentId: string;
  if (existing) {
    studentId = existing.id; // 재입장은 정원 검사 없이 항상 허용
  } else {
    // 정원 100 고정 — 요금제 보류(2026-07-09)로 plan 구분 제거. 유료화 부활 시 plan별 cap 복원.
    const cnt = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM students WHERE class_id = ?")
      .bind(cls.id)
      .first<{ n: number }>();
    if ((cnt?.n ?? 0) >= 100) return c.json({ error: "full" }, 409);
    studentId = genId();
    await c.env.DB.prepare("INSERT INTO students (id, class_id, nickname, avatar_seed) VALUES (?, ?, ?, ?)")
      .bind(studentId, cls.id, nickname, genId().slice(0, 8))
      .run();
  }
  await c.env.DB.prepare("INSERT INTO join_attempts (ip_hash, code_tried, success) VALUES (?, ?, 1)")
    .bind(ipHash, code)
    .run();

  const token = await signJwt(
    { sub: studentId, student_id: studentId, class_id: cls.id },
    c.env.STUDENT_JWT_SECRET,
    STUDENT_TTL_SEC,
  );
  return c.json({ token, studentId, classId: cls.id, className: cls.name, nickname });
});

// ══════════════════════ 학생: 작품 제출(submit-artwork 포팅) ══════════════════════
app.post("/api/artwork", async (c) => {
  const auth = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const claims = await verifyJwt<{ student_id: string; class_id: string }>(auth, c.env.STUDENT_JWT_SECRET);
  if (!claims?.student_id || !claims?.class_id) return c.json({ error: "unauthorized" }, 401);

  const form = await c.req.formData();
  const mode = String(form.get("mode") ?? "sketch");
  if (!MODES.includes(mode)) return c.json({ error: "bad_mode" }, 400);
  const image = fileOrNull(form.get("image"));
  const thumb = fileOrNull(form.get("thumb"));
  const timelapse = fileOrNull(form.get("timelapse"));
  // dedup: 그리기 세션마다 클라가 발급하는 익명 랜덤 토큰(작품 id 아님). 같은 그림 재저장은
  // 새 행을 만들지 않고 (student_id, draft_id)로 자기 행을 덮어쓴다(upsert) → 갤러리에 최신본만.
  // 삭제 능력을 노출하지 않으므로(자기 행 덮어쓰기뿐) 닉네임 도용으로도 남의 작품을 못 지운다.
  // 길이 상한으로 비정상 입력 차단.
  /* 제목 — 아이가 직접 쓰는 자유 문자열이라 서버에서 정규화한다(클라 신뢰 금지):
   * 제어문자·줄바꿈 제거 → 앞뒤 공백 제거 → 30자 컷. 빈 문자열이면 NULL(제목 없음).
   * 표시는 전부 React 텍스트 노드라 이스케이프는 프레임워크가 하고, 여기선 길이·문자만 본다. */
  const titleRaw = form.get("title");
  const title = typeof titleRaw === "string" ? sanitizeTitle(titleRaw) : null;
  const draftRaw = form.get("draft_id");
  const draftId =
    typeof draftRaw === "string" && draftRaw.length > 0 && draftRaw.length <= 64 ? draftRaw : null;
  if (!image || !thumb) return c.json({ error: "missing_files" }, 400);
  if (image.size > MAX_BYTES || thumb.size > MAX_BYTES) return c.json({ error: "too_large" }, 413);

  // 토큰 위조 이중 방어: 학생이 실제 이 학급 소속인지 + 학급이 열려 있는지 재확인.
  // 승인 게이트 제거(즉시 전시) 후엔 업로드가 곧 공개라, 잠긴 학급으로의 제출을 서버에서 차단
  const student = await c.env.DB.prepare(
    `SELECT s.id, cl.is_active FROM students s JOIN classes cl ON cl.id = s.class_id
     WHERE s.id = ? AND s.class_id = ?`,
  )
    .bind(claims.student_id, claims.class_id)
    .first<{ id: string; is_active: number }>();
  if (!student) return c.json({ error: "unauthorized" }, 401);
  if (!student.is_active) return c.json({ error: "inactive" }, 403);

  // dedup upsert면 이 draft의 기존 행을 찾는다(자기 student_id 소유만 — 남의 행 접근 불가).
  // draft_id는 갤러리/목록 API 어디에도 노출되지 않는 랜덤 토큰이라, 도용자가 피해자의 draft_id를
  // 알 수 없어 피해자 행을 타깃할 수 없다(설계상 권한 상승 차단).
  const existing = draftId
    ? await c.env.DB.prepare(
        `SELECT id, image_path, thumb_path, timelapse_path, created_at
         FROM artworks WHERE student_id = ? AND draft_id = ? LIMIT 1`,
      )
        .bind(claims.student_id, draftId)
        .first<{
          id: string;
          image_path: string;
          thumb_path: string;
          timelapse_path: string | null;
          created_at: number;
        }>()
    : null;

  // rate limit — dedup 덮어쓰기가 방어를 우회하지 못하도록 세 겹(2026-07-22 교차검증 CRITICAL):
  //  ① 총량(원자적): 학생당 60초 "쓰기 시도" 15회. 신규·덮어쓰기를 가리지 않고 세므로
  //     draft를 여러 개 만들어 라운드로빈으로 난타하는 우회가 막힌다. 카운터를
  //     단일 UPDATE...RETURNING으로 증가시켜 SELECT-then-check의 TOCTOU도 함께 제거.
  //     (정상 사용은 그림당 1~2회 저장이라 15회는 매우 여유롭다.)
  //  ② 신규 그림 스팸: 최근 60초에 새로 만든 행 ≥ 5 차단(갤러리 도배 방지 — 기존 방어 유지).
  //  ③ 같은 draft 난타: 같은 그림을 1.5초 안에 또 덮어쓰기 시도하면 차단.
  const now = Date.now();
  const budget = await c.env.DB.prepare(
    `UPDATE students
        SET write_count = CASE WHEN COALESCE(write_window_start, 0) >= ? THEN COALESCE(write_count, 0) + 1 ELSE 1 END,
            write_window_start = CASE WHEN COALESCE(write_window_start, 0) >= ? THEN write_window_start ELSE ? END
      WHERE id = ?
      RETURNING write_count`,
  )
    .bind(now - 60_000, now - 60_000, now, claims.student_id)
    .first<{ write_count: number }>();
  if ((budget?.write_count ?? 0) > 15) return c.json({ error: "rate_limited" }, 429);
  if (existing && now - existing.created_at < 1500) return c.json({ error: "rate_limited" }, 429);
  if (!existing) {
    const recent = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM artworks WHERE student_id = ? AND created_at >= ?",
    )
      .bind(claims.student_id, now - 60_000)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= 5) return c.json({ error: "rate_limited" }, 429);
  }

  // 덮어쓰기는 기존 행의 artId(=R2 키)를 재사용 → 같은 키에 새 내용을 put(제자리 갱신, orphan 없음).
  const artId = existing?.id ?? genId();
  const base = `${claims.class_id}/${claims.student_id}/${artId}`;
  // 원본 확장자·Content-Type은 업로드된 blob 타입에서 파생 — 신규 클라는 webp,
  // 배포 직후 캐시된 구 클라가 보내는 png도 그대로 수용(하위호환). 읽기/삭제/purge는
  // D1에 저장된 경로를 그대로 쓰므로 포맷 혼재(.png/.webp)여도 안전.
  const imageCt = image.type === "image/webp" ? "image/webp" : "image/png";
  const imageExt = imageCt === "image/webp" ? "webp" : "png";
  const imagePath = `${base}.${imageExt}`;
  // 썸네일도 마찬가지 — 구형 웹뷰는 canvas.toBlob("image/webp")가 png로 폴백하므로
  // 무조건 webp로 기록하면 깨진 썸네일이 된다(blob.type을 그대로 신뢰).
  const thumbCt = thumb.type === "image/webp" ? "image/webp" : "image/png";
  const thumbPath = `${base}.thumb.${thumbCt === "image/webp" ? "webp" : "png"}`;
  // 재저장에 타임랩스가 없으면 기존 것을 유지(덮어쓰기가 다른 필드를 지우지 않도록).
  let timelapsePath: string | null = existing?.timelapse_path ?? null;

  // 업로드 바이트가 정말 그 포맷인지 확인한다 — 지금까지 클라가 보낸 MIME만 믿었기에, 조작된
  // 클라가 아무 바이트나(또는 0바이트) 올려 갤러리에 깨진 그림을 만들 수 있었다(교차검증 발견).
  const imageBuf = await image.arrayBuffer();
  const thumbBuf = await thumb.arrayBuffer();
  const matchesFormat = (buf: ArrayBuffer, ct: string): boolean => {
    const b = new Uint8Array(buf);
    if (b.length < 12) return false;
    if (ct === "image/png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    // WebP = "RIFF" ....  "WEBP"
    return (
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
    );
  };
  if (!matchesFormat(imageBuf, imageCt) || !matchesFormat(thumbBuf, thumbCt)) {
    return c.json({ error: "bad_image" }, 400);
  }

  await c.env.BUCKET.put(imagePath, imageBuf, { httpMetadata: { contentType: imageCt } });
  await c.env.BUCKET.put(thumbPath, thumbBuf, { httpMetadata: { contentType: thumbCt } });
  if (timelapse && timelapse.size > 0 && timelapse.size <= MAX_BYTES * 4) {
    timelapsePath = `${base}.webm`;
    await c.env.BUCKET.put(timelapsePath, await timelapse.arrayBuffer(), {
      httpMetadata: { contentType: "video/webm" },
    });
  }

  // 신규 행 삽입 — 같은 draft로 요청이 동시에 들어와도(더블탭·재시도) UNIQUE(student_id, draft_id)에
  // 걸려 두 번째는 새 행 대신 기존 행을 갱신한다(dedup을 DB 레벨에서 원자적으로 보장).
  // 승인 게이트 비활성(2026-07-09 사용자 결정): 제출 즉시 전시(is_approved=1).
  // 되살리려면 아래 1을 0으로 — 조회(is_approved=1 필터)·PATCH 승인 엔드포인트·교사 UI는 보존됨.
  /* ⚠️ title 컬럼은 2026-09-01 마이그레이션에서 추가됐다. 마이그레이션보다 워커가 먼저 배포되면
   * 이 문장이 "no such column: title"로 실패하는데, 그건 **제목이 안 붙는 정도가 아니라 학급 전체의
   * 그림 저장이 통째로 막히는 전면 장애**다(교차검증 CRITICAL). 배포 스크립트가 순서를 강제하지만,
   * 이미 어긋난 상태를 구제할 안전망을 코드에도 둔다 — 제목만 포기하고 그림은 반드시 저장한다. */
  const insertRow = (withTitle = true) =>
    c.env.DB.prepare(
      withTitle
        ? `INSERT INTO artworks (id, class_id, student_id, mode, image_path, thumb_path, timelapse_path, draft_id, title, is_approved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(student_id, draft_id) DO UPDATE SET
         mode = excluded.mode, image_path = excluded.image_path, thumb_path = excluded.thumb_path,
         timelapse_path = excluded.timelapse_path, created_at = excluded.created_at,
         -- 제목은 보낸 경우에만 갈아끼운다 — 제목 없이 재저장했다고 붙여 둔 제목이 사라지면 안 된다
         title = COALESCE(excluded.title, artworks.title)
       RETURNING id`
        : `INSERT INTO artworks (id, class_id, student_id, mode, image_path, thumb_path, timelapse_path, draft_id, is_approved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(student_id, draft_id) DO UPDATE SET
         mode = excluded.mode, image_path = excluded.image_path, thumb_path = excluded.thumb_path,
         timelapse_path = excluded.timelapse_path, created_at = excluded.created_at
       RETURNING id`,
    )
      .bind(
        ...(withTitle
          ? [artId, claims.class_id, claims.student_id, mode, imagePath, thumbPath, timelapsePath, draftId, title, now]
          : [artId, claims.class_id, claims.student_id, mode, imagePath, thumbPath, timelapsePath, draftId, now]),
      )
      .first<{ id: string }>();

  const insertWithFallback = () =>
    insertRow().catch((e) => {
      if (!isMissingTitleColumn(e)) throw e;
      console.warn("[artwork] title 컬럼 없음 — 제목 없이 저장(마이그레이션 미적용)");
      return insertRow(false);
    });

  const updateRow = (withTitle = true) =>
    c.env.DB.prepare(
      withTitle
        ? `UPDATE artworks SET mode = ?, image_path = ?, thumb_path = ?, timelapse_path = ?, created_at = ?,
                             title = COALESCE(?, title)
         WHERE id = ? AND student_id = ?`
        : `UPDATE artworks SET mode = ?, image_path = ?, thumb_path = ?, timelapse_path = ?, created_at = ?
         WHERE id = ? AND student_id = ?`,
    )
      .bind(
        ...(withTitle
          ? [mode, imagePath, thumbPath, timelapsePath, now, title, artId, claims.student_id]
          : [mode, imagePath, thumbPath, timelapsePath, now, artId, claims.student_id]),
      )
      .run();

  let rowId = artId;
  try {
    if (existing) {
      // 덮어쓰기: 새 행을 만들지 않고 자기 행을 갱신(삭제 없음). created_at를 올려 최신 저장 기준으로
      // 정렬·리텐션(180일) 재산정. student_id 조건으로 자기 행만 갱신됨을 이중 보장.
      const res = await updateRow().catch((e) => {
        if (!isMissingTitleColumn(e)) throw e;
        console.warn("[artwork] title 컬럼 없음 — 제목 없이 저장(마이그레이션 미적용)");
        return updateRow(false);
      });
      // 조회와 갱신 사이에 교사가 그 작품을 지웠으면 갱신 대상이 없다(changes=0). 그대로 200을 주면
      // 방금 올린 R2 파일이 어떤 행에도 안 붙은 영구 고아가 되므로, 새 행으로 되살린다.
      if ((res.meta?.changes ?? 0) === 0) rowId = (await insertWithFallback())?.id ?? artId;
    } else {
      rowId = (await insertWithFallback())?.id ?? artId;
    }
  } catch (e) {
    // 신규 INSERT 실패 → 방금 올린 R2 객체를 best-effort 정리(orphan 방지).
    // UPDATE(덮어쓰기) 실패는 기존 행의 키라 지우면 안 됨(기존 작품 파괴) — 이미지만 갱신된 채 둔다.
    // (이때 R2 바이트는 이미 새 그림으로 바뀌어 있고 mode·created_at만 옛 값으로 남는다. 학생이
    //  의도적으로 덮어쓴 그림이라 유실은 아니며, 500을 받은 클라가 재시도하면 그대로 수렴한다.)
    if (!existing) {
      const paths = [imagePath, thumbPath, ...(timelapsePath ? [timelapsePath] : [])];
      await Promise.allSettled(paths.map((p) => c.env.BUCKET.delete(p)));
    }
    return c.json({ error: "db" }, 500);
  }

  // 덮어쓰기에서 포맷이 바뀌면(구 클라 png → 신규 webp, 또는 썸네일 폴백) 옛 키가 참조를 잃는다.
  // D1 갱신이 성공한 뒤에만(=행이 새 경로를 가리킨 뒤) best-effort 정리 — 실패해도 제출은 성공.
  if (existing) {
    // 지우기 직전에 행이 지금 가리키는 경로를 다시 읽는다 — 같은 draft로 다른 포맷 요청이 동시에
    // 들어와 순서가 엇갈리면, 옛 경로라고 믿은 키가 실은 최종 행이 참조하는 키일 수 있다(사진 증발).
    const live = await c.env.DB.prepare("SELECT image_path, thumb_path FROM artworks WHERE id = ?")
      .bind(rowId)
      .first<{ image_path: string; thumb_path: string }>();
    const inUse = new Set([imagePath, thumbPath, live?.image_path, live?.thumb_path].filter(Boolean));
    const stale = [existing.image_path, existing.thumb_path].filter((p) => p && !inUse.has(p));
    if (stale.length) await Promise.allSettled(stale.map((p) => c.env.BUCKET.delete(p)));
  }

  // rowId ≠ artId인 경우 = 동시 요청 경쟁에서 ON CONFLICT로 기존 행을 갱신했을 때(그 행의 id를 반환).
  return c.json({ id: rowId });
});

// ══════════════════════ 협동(함께 그리기) — 2026-10-07 종료 ══════════════════════
// 옛 클라이언트(서비스 워커에 남은 구버전)가 접속을 시도해도 DO 를 깨우지 않고 바로 410.
app.get("/api/collab/:room", (c) => c.json({ error: "collab_ended" }, 410));

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// ══════════════════════ 만료 작품 정리(Cron Trigger) ══════════════════════
// 매일 실행: created_at 이 보관기간(180일)을 넘긴 작품을 R2·D1에서 영구 삭제.
// 안전 원칙:
//  · cutoff = now − RETENTION_MS 보다 오래된 것만. 더 최신 작품은 절대 건드리지 않는다.
//  · R2 객체 삭제가 성공한 배치만 D1 행을 지운다(깨진 이미지=D1 있는데 R2 없음 방지).
//  · BATCH=90(D1 바인딩 파라미터 상한 100 이내) · 무료 플랜 subrequest(50) 대비 배치당 3개·상한 10.
async function purgeExpiredArtworks(env: Env): Promise<{ deleted: number }> {
  const cutoff = Date.now() - RETENTION_MS;
  const MAX_BATCHES = 10;
  // ⚠️ BATCH는 D1 바인딩 파라미터 상한(쿼리당 100)보다 작아야 한다. DELETE … IN (?×BATCH)가
  // 100을 넘으면 R2는 이미 지운 뒤 D1 삭제가 throw → 깨진 썸네일 orphan + purge 영구정지.
  const BATCH = 90;
  let deleted = 0;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const { results } = await env.DB.prepare(
      "SELECT id, image_path, thumb_path, timelapse_path FROM artworks WHERE created_at < ? LIMIT ?",
    )
      .bind(cutoff, BATCH)
      .all<{ id: string; image_path: string; thumb_path: string; timelapse_path: string | null }>();
    const rows = results ?? [];
    if (rows.length === 0) break;

    // R2 키 수집 + 빈 값 방어(손상 행 하나가 배치 전체를 막는 poison pill 방지)
    const keys = rows
      .flatMap((r) => [r.image_path, r.thumb_path, r.timelapse_path])
      .filter((k): k is string => typeof k === "string" && k.length > 0);
    try {
      await env.BUCKET.delete(keys); // 존재하지 않는 키는 무시(멱등). 실패 시 throw.
    } catch {
      break; // R2 삭제 실패 → 이 배치 D1 삭제 보류(다음 실행 재시도, R2없는데 D1남는 orphan 방지)
    }

    // likes→artworks를 batch()로 원자 삭제(한쪽만 실패해 부분상태 남는 것 방지).
    // FK CASCADE는 D1에서 기본 미보장 → likes 명시 삭제 필수.
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => "?").join(",");
    const res = await env.DB.batch([
      env.DB.prepare(`DELETE FROM artwork_likes WHERE artwork_id IN (${ph})`).bind(...ids),
      // ⚠️ created_at를 다시 확인한다 — SELECT와 DELETE 사이에 학생이 그 작품을 다시 저장하면
      //    created_at이 현재 시각으로 갱신돼 더 이상 만료가 아니다(dedup 덮어쓰기 도입 전에는
      //    created_at이 불변이라 문제가 없었다). id만으로 지우면 방금 저장한 작품이 사라진다.
      env.DB.prepare(`DELETE FROM artworks WHERE created_at < ? AND id IN (${ph})`).bind(cutoff, ...ids),
    ]);
    deleted += res[1]?.meta.changes ?? rows.length;
    if (rows.length < BATCH) break;
  }
  return { deleted };
}

// join_attempts(IP 해시 rate-limit 로그)는 무기한 쌓이면 안 된다 — rate 윈도우는 5분이라
// 7일 지난 행은 감사 가치도 없다. 개인정보(IP 파생) 보관 최소화 원칙으로 매일 정리.
const JOIN_ATTEMPT_RETENTION_MS = 7 * DAY_MS;
/* 한 번에 지우는 행 수. 처음 도는 날이나 정리가 며칠 밀린 뒤엔 대상이 수십만 행일 수 있는데,
 * 한 문장으로 지우면 그 트랜잭션 하나가 워커 CPU 한도에 걸려 통째로 롤백된다 —
 * 그러면 영영 아무것도 못 지운다. 나눠 지우면 중간까지는 확실히 줄어든다. */
const JOIN_PURGE_BATCH = 500;
const JOIN_PURGE_MAX_BATCHES = 40; // 한 번의 cron 에서 최대 2만 행 — 나머지는 다음 날

async function purgeOldJoinAttempts(env: Env): Promise<{ deleted: number }> {
  // ⚠️ created_at 은 정수 밀리초 컬럼이다(schema.sql: unixepoch() * 1000).
  //    SQL 의 날짜 함수(now-1d 류)를 쓰면 단위가 어긋나 아무것도 안 지워지거나 전부 지운다.
  const cutoff = Date.now() - JOIN_ATTEMPT_RETENTION_MS;
  let deleted = 0;
  for (let i = 0; i < JOIN_PURGE_MAX_BATCHES; i++) {
    const res = await env.DB.prepare(
      "DELETE FROM join_attempts WHERE id IN (SELECT id FROM join_attempts WHERE created_at < ? LIMIT ?)",
    )
      .bind(cutoff, JOIN_PURGE_BATCH)
      .run();
    const n = res.meta?.changes ?? 0;
    deleted += n;
    if (n < JOIN_PURGE_BATCH) break; // 더 지울 게 없다
  }
  return { deleted };
}

export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(
      Promise.allSettled([
        purgeExpiredArtworks(env).then(
          (r) => console.log(`[cron] purged ${r.deleted} expired artworks`),
          (e) => console.error("[cron] purge failed", e),
        ),
        purgeOldJoinAttempts(env).then(
          (r) => console.log(`[cron] purged ${r.deleted} old join_attempts`),
          (e) => console.error("[cron] join_attempts purge failed", e),
        ),
      ]),
    );
  },
} satisfies ExportedHandler<Env>;
