import type { BackendCaps, Dab, RGB } from "../types";
import { getTipCanvas, getTipEpoch, getTipPixels, makeTipHighlightCanvas, unionDabBounds, type RendererBackend, type StrokeContext } from "./backend";
import { isRibbonTip } from "./ribbon";
import { applyImpastoRelief, applyWetEdge, compositeGlaze, growRect, IMPASTO_REACH, paperGrainTile, type PaperKind, type PxRect } from "./paper";
import type { TipKind } from "../brushes/BrushBase";

/*
 * WebGL2Backend: GPU 가속 dab 스탬핑.
 * 실패(컨텍스트 없음/셰이더 컴파일 오류) 시 CanvasManager가 Canvas2D로 폴백한다.
 *
 * 렌더 모델:
 *  - strokeFbo: 현재 스트로크를 누적(브러시 composite 내 겹침 통제)
 *  - endStroke에서 strokeFbo를 (종이 결 모듈레이션 후) 레이어 캔버스에 2D drawImage로 합성
 *
 * ⚠️ 과거 wet-map 확산 시뮬은 제거됨: dab 루프 도중 injectWet이 framebuffer/VAO를
 * 오염시켜 배치당 첫 dab만 화면에 남는 "점선 수채" 버그의 원인이었고,
 * 확산 결과는 어디에도 렌더되지 않는 죽은 코드였다. 수채 look은
 * wet 팁(edge darkening 베이크) + 종이 결로 표현한다.
 */

const QUAD_VS = `#version 300 es
in vec2 a_pos;      // -0.5..0.5 quad
in vec2 a_uv;
uniform vec2 u_resolution;
uniform vec2 u_center;   // px
uniform float u_size;    // px (획 폭 방향)
uniform float u_len;     // px (획 진행 방향) — 일반 dab 은 u_size 와 같다
uniform vec4 u_uvr;      // 팁 텍스처에서 쓸 구간(u0,v0,u1,v1) — 일반 dab 은 (0,0,1,1)
uniform float u_rot;
uniform float u_seg;     // 1 = 이음 띠(앞 중심 u_p0·법선 u_n0 → 이 dab), 0 = 회전 사각형
uniform vec2 u_p0;
uniform vec2 u_n0;       // 앞 끝의 반폭 법선(px)
out vec2 v_uv;
out vec2 v_px;      // 캔버스 픽셀 좌표(종이 결 샘플용 — dab이 아니라 캔버스에 고정)
void main() {
  float c = cos(u_rot); float s = sin(u_rot);
  vec2 q = vec2(a_pos.x * u_len, a_pos.y * u_size);
  vec2 p = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  vec2 px = u_center + p;
  if (u_seg > 0.5) {
    // 사다리꼴: 왼쪽 변 = 앞 dab 중심의 폭 단면, 오른쪽 변 = 이 dab 중심의 폭 단면
    vec2 n1 = vec2(-s, c) * (u_size * 0.5);
    float t = a_pos.x + 0.5;
    px = mix(u_p0, u_center, t) + mix(u_n0, n1, t) * (a_pos.y * 2.0);
  }
  vec2 clip = (px / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = mix(u_uvr.xy, u_uvr.zw, a_uv);
  v_px = px;
}`;

const DAB_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_px;
uniform sampler2D u_tip;
uniform sampler2D u_paper;  // 종이 결 타일(256, repeat) — 골짜기 알파
uniform float u_grain;      // 종이 결 강도 0~1 (dab 단위 실시간 — 프리뷰=최종)
uniform float u_grainLift;  // 1=결을 색 백화로(불투명 유지, 유화) / 0=알파 침식(수채 등)
uniform sampler2D u_tipHl;  // 붓 방향 밝은 스트릭 맵(팁 UV) — 마른 붓털 하이라이트
uniform float u_streaks;    // 스트릭 강도 0~1
uniform float u_hlTip;      // 1 = 하이라이트를 팁 G 채널에서(납작붓 띠 — 붓결이 밝은 줄), 0 = u_tipHl
uniform float u_cloud;      // 수채 농담 구름(저주파, 캔버스 고정) 강도 0~1
uniform float u_edgeNoise;  // 가장자리 요철(알파<1 폴오프 영역만 침식, 캔버스 고정) 0~1
uniform vec4 u_color;       // rgb(0..1) + alpha
out vec4 frag;
void main() {
  vec4 t = texture(u_tip, v_uv);
  // u_color.a는 1을 넘을 수 있다(수채: 팁 플래토 0.94×필압을 뚫고 내부를 포화시키는 부스트).
  // premultiplied 저장이라 a>1이면 색이 왜곡되므로 반드시 여기서 클램프.
  float a = min(1.0, t.a * u_color.a);
  // 종이 결 — 두 모드(u_grainLift로 선택):
  //  · 침식(수채 등): 골짜기에서 안료가 빠진다(알파 ↓). 계수 0.5(0.85는 붓결 위장 실측).
  //  · 백화(유화): 알파는 유지하고 색에 흰 캔버스가 배어난다 — 알파 침식이면 겹친 획이
  //    진해져 불투명 물감이 아니라 반투명 마커로 읽힌다(i-scream 비교 사용자 실측 2026-07-06).
  float g = texture(u_paper, v_px / 256.0).a * u_grain;
  a *= 1.0 - g * 0.5 * (1.0 - u_grainLift);
  // 가장자리 요철(수채 스밈): 팁 폴오프(가장자리) 영역만 캔버스 고정 노이즈로 침식.
  // ⚠️ 게이트는 픽셀 알파(1−a)가 아니라 팁 알파(t.a) 기준 — buildup 수채는 내부도
  // 픽셀 알파 <1이라 (1−a) 게이트면 획 전면이 잔점 스프레이가 된다(2026-07-10 실측).
  // 팁 플래토(0.94) 내부는 침식 0 → 획 안은 매끈, 실루엣만 종이 결 따라 울퉁불퉁.
  if (u_edgeNoise > 0.0) {
    float e1 = texture(u_paper, v_px / 1400.0).a;          // ~15px 요철(스밈 덩어리)
    float e2 = texture(u_paper, v_px / 520.0 + vec2(0.71, 0.23)).a; // ~4px 잔결
    float en = clamp((e1 * 0.7 + e2 * 0.3) * 1.8, 0.0, 1.0);
    float tipEdge = 1.0 - clamp(t.a / 0.9, 0.0, 1.0);
    a *= mix(1.0, en, u_edgeNoise * tipEdge);
  }
  // 임파스토 셰이드(t.r, 1=중립): 방향을 색 밝기로 "선택"한다(step) —
  // ① 크로스페이드(가중 평균)는 중간 회색에서 ±상쇄 널포인트(실측),
  // ② 팁에 밝은 밴드를 섞으면 모든 색이 회색빛(검정 실측). 둘 다 금지.
  // 밝은 색(밝기≥0.4) = 물감이 어두워지는 골, 어두운 색 = 빛 받는 하이라이트.
  // ⚠️ 침식 모드(grainLift=0)에서 결로 색까지 어둡게 하던 항(× (1−g·0.35))은 제거했다:
  // 결 골짜기는 이미 알파가 빠지는데(위) 색까지 검은 쪽으로 곱하면 이중 계산이라
  // 밝은 색이 탁해진다(크레용 노랑 → 올리브, 2026-07-13 사용자 실측). 결은 알파로만.
  float f = t.r;
  vec3 col = u_color.rgb;
  float dk = 1.0 - max(col.r, max(col.g, col.b)); // 검을수록 1
  // 붓 방향 밝은 스트릭(마른 붓털 하이라이트) — 밝은 값은 wash(MAX)에서 살아남아
  // 덧칠 내부에도 붓결이 유지된다(어두운 골은 MAX가 지움 — i-scream 비교 실측)
  float hl = mix(texture(u_tipHl, v_uv).a, t.g, u_hlTip) * u_streaks;
  // 백화 모드의 밝은 색: 결 이랑 흰색 혼입 + 스트릭. 합산 캡 0.34 — 0.5는 채도 높은
  // 색(로열블루)이 분필처럼 바랜다("흰색 섞은 듯", 2026-07-06 사용자 실측). 직조는
  // 획 전체에 상시 깔리는 항이라 특히 낮게(0.4) — 스트릭은 국소라 좀 더 허용.
  // (0.3/0.32는 i-scream 대비 디테일 부족, 2026-07-10 사용자 실측 → 캡 안에서 소폭 상향)
  // 납작붓 띠(u_hlTip)는 붓결이 텍스처 G 에 국소로만 있어 캡을 더 연다(2026-10-08 «붓결 더 강하게»)
  vec3 darkened = mix(col * f, vec3(1.0), min(mix(0.34, 0.44, u_hlTip), g * 0.4 * u_grainLift + hl * mix(0.62, 0.78, u_hlTip)));
  // 어두운 색 하이라이트는 상한 필수 — 깊은 골(f=0.6)에 비례 계수만 쓰면 골마다
  // 37% 백색 혼입 → 검정이 회색빛 + 흰 줄 스팸(실기기 실측). 0.2 캡이면
  // 결이 보이면서 검정은 검정으로 남는다(0.16은 i-scream 대비 디테일 부족 실측,
  // 백화·스트릭 기여도 같은 캡 안).
  float lift = min(mix(0.2, 0.3, u_hlTip), (1.0 - f) * 0.5 + g * 0.3 * u_grainLift + hl * 0.5) * dk;
  vec3 lightened = mix(col, vec3(1.0), lift);
  col = mix(darkened, lightened, step(0.6, dk));
  // 수채 농담 구름 — 종이가 물을 먹는 정도의 저주파 요동(옅은 자리/안료 고임).
  // ⚠️ 반드시 캔버스 좌표 고정·결정론이어야 한다: 겹쳐 칠해도 픽셀마다 같은 값이 나와
  // darken(min) 수렴이 유지된다(획 경계 단차 없음). dab/획 단위 랜덤이면 얼룩 재발.
  // 균일 워시는 "연한 마커"로 읽힌다(2026-07-10 사용자 실측, i-scream 대비).
  if (u_cloud > 0.0) {
    // 스케일 주의: uv = v_px/scale 에서 텍셀 1개의 화면 크기 = scale/256 px.
    // 구름 덩어리가 30~60px가 되려면 scale이 8천~1만이어야 한다(263은 1:1 = 미세 입자, 실측).
    float n1 = texture(u_paper, v_px / 9800.0).a;
    float n2 = texture(u_paper, v_px / 3700.0 + vec2(0.37, 0.61)).a;
    float n = (n1 * 0.62 + n2 * 0.38 - 0.5) * 2.0; // -1..1
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    // i-scream 원본 전수검수(2026-07-10, 명도 p5~p95 실측): 워시 내부 변동 폭 62/255,
    // 비대칭 — 안료 고임(어두워짐 -37)이 백화(+25)보다 크다. 우리 이전 값(0.26·대칭·
    // luma 감쇠)은 변동 13 = "연한 마커"(사용자 실측).
    // · 백화는 색 밝기 비례(어두운 색의 흰 얼룩 = 지운 자국 실측) — 밝은 색에서만.
    // · 고임(진해짐)은 luma 무관 — 어두운 색에서도 안전한 주력 변동.
    col = mix(col, vec3(1.0), max(n, 0.0) * u_cloud * (0.15 + 0.85 * lum) * 0.7);
    // 안료 고임 — 원본의 주 변동. ⚠️ 전 채널 등비 곱(×(1-k))은 채도가 죽어 회색빛
    // 탁색이 된다(실측): 자기 색의 제곱 방향(col²)으로 깊어져야 안료답다.
    // ⚠️ 고임은 저주파(큰 물번짐) 위주 — 고주파 n2를 타면 3~8px 어두운 반점이
    // 곰팡이/때처럼 흩뿌려진다(2026-07-10 실측, washCloud 0.48에서 가시화).
    float nPool = (n1 * 0.82 + n2 * 0.18 - 0.5) * 2.0;
    col = mix(col, col * col, max(-nPool, 0.0) * u_cloud * 1.5);
    // 물이 고였다 마른 밝은 bloom — 넓은 램프(좁으면 표백 점, 실측). 밝은 색 전용.
    float bloom = smoothstep(0.58, 0.9, n1) * u_cloud * lum;
    col = mix(col, vec3(1.0), bloom * 0.3);
  }
  frag = vec4(col * a, a);  // premultiplied
}`;

const FULLSCREEN_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const COPY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 frag;
void main() { frag = texture(u_tex, v_uv); }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`셰이더 컴파일 실패: ${log}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`프로그램 링크 실패: ${log}`);
  }
  return p;
}

interface Fbo {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
}

export class WebGL2Backend implements RendererBackend {
  readonly caps: BackendCaps;
  private gl: WebGL2RenderingContext;
  private glCanvas: HTMLCanvasElement;

  private dabProg: WebGLProgram;
  private copyProg: WebGLProgram;

  private quadVao: WebGLVertexArrayObject;
  private fsVao: WebGLVertexArrayObject;

  private strokeFbo: Fbo;
  private tipTextures = new Map<TipKind, { tex: WebGLTexture; epoch: number }>();
  /** 종이 결 타일 텍스처(repeat, 종이 종류별) — dab 셰이더가 캔버스 좌표로 샘플(실시간 종이 결) */
  private paperTex = new Map<PaperKind, WebGLTexture>();

  private ctx: StrokeContext | null = null;
  /** 종이 결 모듈레이션 등 2D 포스트프로세스용(지연 생성) */
  private post2d: CanvasRenderingContext2D | null = null;
  /** 임파스토 라이브 프리뷰 캐시 — 획이 변한 프레임만 릴리프 재계산(팬·줌 리컴포짓 절약) */
  private live2d: CanvasRenderingContext2D | null = null;
  private strokeRev = 0;
  private liveRev = -1;
  private lostCb: (() => void) | null = null;
  private handleLost = (e: Event) => {
    e.preventDefault();
    this.ctx = null;
    this.lostCb?.();
  };

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    const glCanvas = document.createElement("canvas");
    glCanvas.width = width;
    glCanvas.height = height;
    const gl = glCanvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error("WebGL2 컨텍스트 생성 실패");
    this.gl = gl;
    this.glCanvas = glCanvas;
    // GL 컨텍스트는 이 내부 캔버스에 있다 — 로스 감지도 여기(display 캔버스는 2D라 이 이벤트가 안 옴)
    glCanvas.addEventListener("webglcontextlost", this.handleLost);

    this.dabProg = link(gl, QUAD_VS, DAB_FS);
    this.copyProg = link(gl, FULLSCREEN_VS, COPY_FS);

    this.quadVao = this.makeQuadVao(this.dabProg);
    this.fsVao = this.makeFsVao(this.copyProg);

    this.strokeFbo = this.makeFbo(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);

    this.caps = { webgl2: true };
  }

  private makeQuadVao(prog: WebGLProgram): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    // pos(-0.5..0.5) + uv(0..1)
    const data = new Float32Array([
      -0.5, -0.5, 0, 0, 0.5, -0.5, 1, 0, -0.5, 0.5, 0, 1,
      -0.5, 0.5, 0, 1, 0.5, -0.5, 1, 0, 0.5, 0.5, 1, 1,
    ]);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    const aUv = gl.getAttribLocation(prog, "a_uv");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
    return vao;
  }

  private makeFsVao(prog: WebGLProgram): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const data = new Float32Array([-1, -1, 3, -1, -1, 3]);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  private makeFbo(internal: number, format: number, type: number): Fbo {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, this.width, this.height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex };
  }

  private tipTexture(kind: TipKind): WebGLTexture {
    const gl = this.gl;
    const epoch = getTipEpoch();
    let entry = this.tipTextures.get(kind);
    // AI 알파맵이 늦게 로드되면 epoch가 올라간다 → 캐시된 텍스처 재생성
    if (entry && entry.epoch !== epoch) {
      gl.deleteTexture(entry.tex);
      this.tipTextures.delete(kind);
      entry = undefined;
    }
    if (!entry) {
      // 캔버스가 아니라 픽셀 배열로 업로드 — 셰이드 채널의 "빈 텍셀"이 중립(255)으로
      // 메워진 데이터라야 밉맵 평균이 색을 검게 끌지 않는다(getTipPixels 주석 참조)
      const src = getTipPixels(kind);
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
      // 밉맵 필수 — 팁(128px+)을 얇은 dab(수 px)로 축소할 때 LINEAR만으로는 4텍셀
      // 샘플이라 가장자리가 픽셀로 튄다(유화 얇은 획 재깅, 2026-07-10 사용자 실측).
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry = { tex, epoch };
      this.tipTextures.set(kind, entry);
    }
    return entry.tex;
  }

  private paperTexture(kind: PaperKind): WebGLTexture {
    let tex = this.paperTex.get(kind);
    if (!tex) {
      const gl = this.gl;
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paperGrainTile(kind));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      this.paperTex.set(kind, tex);
    }
    return tex;
  }

  /** 팁 하이라이트 스트릭 텍스처(팁 종류별) — 프로시저럴 고정(epoch 무관) */
  private tipHlTex = new Map<TipKind, WebGLTexture>();

  private tipHlTexture(kind: TipKind): WebGLTexture {
    let tex = this.tipHlTex.get(kind);
    if (!tex) {
      const gl = this.gl;
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makeTipHighlightCanvas(kind));
      gl.generateMipmap(gl.TEXTURE_2D); // 스트릭 맵도 축소 앨리어싱 동일(얇은 획 흰 점 튐)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.tipHlTex.set(kind, tex);
    }
    return tex;
  }

  beginStroke(ctx: StrokeContext): void {
    this.ctx = ctx;
    this.previewDabs = [];
    this.strokeRev++;
    this.liveRev = -1;
    this.liveDirty = null;
    const gl = this.gl;
    // 스트로크 버퍼 클리어
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.strokeFbo.fb);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  drawDabs(dabs: Dab[]): void {
    if (!this.ctx) return;
    this.strokeRev++;
    this.drawDabsInto(this.strokeFbo.fb, dabs);
    this.liveDirty = unionDabBounds(this.liveDirty, dabs);
  }

  /** 라이브 임파스토 부분 갱신 — 지난 계산 이후 바뀐 영역 */
  private liveDirty: PxRect | null = null;

  /** 아직 확정 안 된 꼬리(납작붓 끝 모양) — 표시에만 덧그리고 스트로크 버퍼엔 안 남긴다 */
  private previewDabs: Dab[] = [];
  setPreviewDabs(dabs: Dab[]): void {
    if (!this.ctx) return;
    // 지난 꼬리 자리도 다시 칠해야 지워진다
    this.liveDirty = unionDabBounds(unionDabBounds(this.liveDirty, this.previewDabs), dabs);
    this.previewDabs = dabs;
    this.strokeRev++;
  }

  private drawDabsInto(fb: WebGLFramebuffer | null, dabs: Dab[]): void {
    if (!this.ctx) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.dabProg);
    gl.bindVertexArray(this.quadVao);
    gl.enable(gl.BLEND);
    // wash: 픽셀별 최대 알파만 유지(MAX) → 겹침 포화 없이 팁 붓결이 획 전체에 보존.
    // (premultiplied + 스트로크 내 단색이라 채널별 max가 일관됨. 무지개 같은
    //  dab별 색 변화 브러시는 buildup을 유지해야 한다.)
    if (this.ctx.wash && !this.ctx.washOver) {
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
    } else if (this.ctx.composite === "lighter") {
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
    } else {
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tipTexture(this.ctx.tip));
    gl.uniform1i(gl.getUniformLocation(this.dabProg, "u_tip"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paperTexture(this.ctx.paperKind));
    gl.uniform1i(gl.getUniformLocation(this.dabProg, "u_paper"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.tipHlTexture(this.ctx.tip));
    gl.uniform1i(gl.getUniformLocation(this.dabProg, "u_tipHl"), 2);
    // 지우개는 종이 결·반점 미적용(기존 endStroke 정책과 동일)
    const eraser = this.ctx.composite === "destination-out";
    gl.uniform1f(gl.getUniformLocation(this.dabProg, "u_grain"), eraser ? 0 : this.ctx.paperGrain);
    gl.uniform1f(gl.getUniformLocation(this.dabProg, "u_grainLift"), this.ctx.grainLift ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.dabProg, "u_streaks"), eraser ? 0 : this.ctx.streaks);
    gl.uniform1f(gl.getUniformLocation(this.dabProg, "u_hlTip"), isRibbonTip(this.ctx.tip) ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.dabProg, "u_cloud"), eraser ? 0 : this.ctx.washCloud);
    gl.uniform1f(
      gl.getUniformLocation(this.dabProg, "u_edgeNoise"),
      eraser ? 0 : this.ctx.edgeNoise,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(gl.getUniformLocation(this.dabProg, "u_resolution"), this.width, this.height);
    const uCenter = gl.getUniformLocation(this.dabProg, "u_center");
    const uSize = gl.getUniformLocation(this.dabProg, "u_size");
    const uRot = gl.getUniformLocation(this.dabProg, "u_rot");
    const uLen = gl.getUniformLocation(this.dabProg, "u_len");
    const uUvr = gl.getUniformLocation(this.dabProg, "u_uvr");
    const uColor = gl.getUniformLocation(this.dabProg, "u_color");
    const uSeg = gl.getUniformLocation(this.dabProg, "u_seg");
    const uP0 = gl.getUniformLocation(this.dabProg, "u_p0");
    const uN0 = gl.getUniformLocation(this.dabProg, "u_n0");

    // dab별 팁 오버라이드(글리터 별 글린트) — 팁이 바뀔 때만 텍스처 리바인드.
    // 글리터도 베이스 dab이 연속이고 입자가 간헐이라 리바인드는 이벤트당 몇 회 수준.
    let boundTip = this.ctx.tip;
    for (const dab of dabs) {
      const dabTip = dab.tip ?? this.ctx.tip;
      if (dabTip !== boundTip) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tipTexture(dabTip));
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.tipHlTexture(dabTip));
        gl.activeTexture(gl.TEXTURE0);
        boundTip = dabTip;
      }
      const col = dab.color ?? this.ctx.color;
      gl.uniform2f(uCenter, dab.x, dab.y);
      gl.uniform1f(uSize, dab.size);
      gl.uniform1f(uRot, dab.rotation);
      // 띠 조각(리본 붓) — 텍스처 가로 구간만, 획 방향 길이 len
      const seg = dab.slice?.seg;
      gl.uniform1f(uSeg, seg ? 1 : 0);
      if (seg) {
        gl.uniform2f(uP0, seg.x, seg.y);
        gl.uniform2f(uN0, -Math.sin(seg.rot) * seg.size * 0.5, Math.cos(seg.rot) * seg.size * 0.5);
      }
      if (dab.slice) {
        gl.uniform1f(uLen, dab.slice.len);
        gl.uniform4f(uUvr, dab.slice.u0, 0, dab.slice.u1, 1);
      } else {
        gl.uniform1f(uLen, dab.size);
        gl.uniform4f(uUvr, 0, 0, 1, 1);
      }
      gl.uniform4f(uColor, col.r / 255, col.g / 255, col.b / 255, dab.alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  tick(): boolean {
    return false; // 시간 진행 시뮬 없음
  }

  /** strokeFbo → glCanvas(기본 프레임버퍼) 복사 — 프리뷰/합성 공용 */
  private blitStrokeToScreen(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.copyProg);
    gl.bindVertexArray(this.fsVao);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.strokeFbo.tex);
    gl.uniform1i(gl.getUniformLocation(this.copyProg, "u_tex"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  presentStroke(target: CanvasRenderingContext2D): void {
    if (!this.ctx) return;
    this.blitStrokeToScreen();
    if (this.previewDabs.length) this.drawDabsInto(null, this.previewDabs);
    const c = this.ctx.composite;
    if (c === "glaze") {
      // 수채 글레이징(겹침 1단계 진해짐 + 포화) — 프리뷰=최종(endStroke와 같은 함수)
      compositeGlaze(target, this.glCanvas, this.width, this.height);
      return;
    }
    // 임파스토 릴리프는 프리뷰=최종(같은 함수) — 손 떼는 순간 명암이 변하는
    // 팝인 제거(2026-07-10 사용자 실측: "유화 손 떼면 색이 변한다").
    // 획이 변한 프레임만 재계산(리비전 캐시) — 팬·줌 리컴포짓은 캐시 재사용.
    let src: HTMLCanvasElement = this.glCanvas;
    if (this.ctx.impasto > 0 && c !== "destination-out") {
      if (!this.live2d) {
        const cv = document.createElement("canvas");
        cv.width = this.width;
        cv.height = this.height;
        this.live2d = cv.getContext("2d")!;
      }
      if (this.liveRev !== this.strokeRev) {
        // 바뀐 영역(+릴리프 도달 거리)만 다시 — 매 프레임 캔버스 전체는 저사양에서 끊겼다(2026-10-08 실측)
        // 획 시작 = 버퍼가 비어 있으니 지우기만 하고, 그다음부터는 dab 이 닿은 곳만
        if (this.liveRev < 0) this.live2d.clearRect(0, 0, this.width, this.height);
        const R = this.liveDirty && growRect(this.liveDirty, IMPASTO_REACH, this.width, this.height);
        if (R && R.w > 0 && R.h > 0) {
          this.live2d.clearRect(R.x, R.y, R.w, R.h);
          this.live2d.drawImage(this.glCanvas, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
          applyImpastoRelief(
            this.live2d,
            this.width,
            this.height,
            this.ctx.impasto,
            this.ctx.impastoShadow,
            R,
          );
        }
        this.liveRev = this.strokeRev;
        this.liveDirty = null;
      }
      src = this.live2d.canvas;
    }
    target.save();
    target.globalAlpha = this.ctx.strokeOpacity; // wash 획 전체 불투명도(프리뷰=최종)
    target.globalCompositeOperation =
      c === "destination-out"
        ? "destination-out"
        : c === "multiply"
          ? "multiply"
          : c === "darken"
            ? "darken"
            : c === "lighter"
              ? "lighter"
              : "source-over";
    target.drawImage(src, 0, 0);
    target.restore();
  }

  endStroke(): void {
    if (!this.ctx) return;
    this.previewDabs = []; // 꼬리는 brush.end() 가 확정 dab 으로 이미 그렸다
    // 스트로크 버퍼(premultiplied)를 화면 캔버스로 복사해 2D 레이어에 합성
    this.blitStrokeToScreen();

    // 종이 결·마른 붓 반점은 dab 셰이더에서 실시간 적용됨(프리뷰=최종 — 펜 뗄 때
    // 구멍 팝인 금지, 2026-07-06 사용자 실측). wet edge·임파스토 릴리프만 2D 후처리
    let src: HTMLCanvasElement = this.glCanvas;
    const post = this.ctx.wetEdge > 0 || this.ctx.impasto > 0;
    if (post && this.ctx.composite !== "destination-out") {
      if (!this.post2d) {
        const c = document.createElement("canvas");
        c.width = this.width;
        c.height = this.height;
        this.post2d = c.getContext("2d")!;
      }
      this.post2d.clearRect(0, 0, this.width, this.height);
      this.post2d.drawImage(this.glCanvas, 0, 0);
      if (this.ctx.wetEdge > 0)
        applyWetEdge(this.post2d, this.width, this.height, this.ctx.wetEdge, this.ctx.paperKind);
      if (this.ctx.impasto > 0)
        applyImpastoRelief(this.post2d, this.width, this.height, this.ctx.impasto, this.ctx.impastoShadow);
      src = this.post2d.canvas;
    }

    const layerCtx = (this.ctx.layerCanvas as HTMLCanvasElement).getContext("2d")!;
    if (this.ctx.composite === "glaze") {
      compositeGlaze(layerCtx, src, this.width, this.height);
      this.ctx = null;
      return;
    }
    layerCtx.save();
    layerCtx.globalAlpha = this.ctx.strokeOpacity;
    if (this.ctx.composite === "destination-out") {
      layerCtx.globalCompositeOperation = "destination-out";
    } else if (this.ctx.composite === "multiply") {
      layerCtx.globalCompositeOperation = "multiply";
    } else if (this.ctx.composite === "darken") {
      layerCtx.globalCompositeOperation = "darken";
    } else if (this.ctx.composite === "lighter") {
      layerCtx.globalCompositeOperation = "lighter";
    }
    layerCtx.drawImage(src, 0, 0);
    layerCtx.restore();
    this.ctx = null;
  }

  cancelStroke(): void {
    // 버퍼는 다음 beginStroke가 클리어 — ctx만 끊으면 present/end가 no-op
    this.previewDabs = [];
    this.ctx = null;
  }

  /** 컨텍스트 로스 콜백(화면 꺼짐→GPU 리셋 등) — CanvasManager가 백엔드 핫스왑에 사용 */
  onContextLost(cb: () => void): void {
    this.lostCb = cb;
  }

  dispose(): void {
    this.glCanvas.removeEventListener("webglcontextlost", this.handleLost);
    this.lostCb = null;
    const gl = this.gl;
    gl.deleteProgram(this.dabProg);
    gl.deleteProgram(this.copyProg);
    this.tipTextures.forEach((t) => gl.deleteTexture(t.tex));
    this.paperTex.forEach((t) => gl.deleteTexture(t));
    this.paperTex.clear();
    this.tipHlTex.forEach((t) => gl.deleteTexture(t));
    this.tipHlTex.clear();
    this.tipTextures.clear();
    gl.deleteFramebuffer(this.strokeFbo.fb);
    gl.deleteTexture(this.strokeFbo.tex);
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
  }
}

export function tryCreateWebGL2Backend(
  width: number,
  height: number,
  allowSoftware = false,
): WebGL2Backend | null {
  try {
    // 소프트웨어 렌더러(SwiftShader) 감지 → 폴백 유도 (?backend=gl 테스트 시엔 허용)
    const probe = document.createElement("canvas").getContext("webgl2");
    if (!probe) return null;
    let software = false;
    const dbg = probe.getExtension("WEBGL_debug_renderer_info");
    if (dbg) {
      const renderer = String(probe.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? "");
      software = /swiftshader|software|llvmpipe/i.test(renderer);
    }
    // probe 컨텍스트는 즉시 반납(마운트 반복 시 브라우저 GL 컨텍스트 한도 잠식 방지)
    probe.getExtension("WEBGL_lose_context")?.loseContext();
    if (software && !allowSoftware) return null;
    return new WebGL2Backend(width, height);
  } catch {
    return null;
  }
}
