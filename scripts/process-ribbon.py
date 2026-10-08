#!/usr/bin/env python3
"""납작붓(리본 유화) 띠 텍스처 가공 — Firefly 붓자국 사진 → public/brush-tips/oil-ribbon.png

  python3 scripts/process-ribbon.py [원본] [--preview 경로]

입력 = 검은 바탕 위 흰 유화 붓자국 한 획(왼쪽 붓 대는 끝 → 오른쪽 마른 붓 끝, 가로).
출력 = 2048×256 RGBA. RGB = 물감 명암(셰이더가 색 × 명암), A = 물감 유무.
배치는 src/engine/core/ribbon.ts 의 RIBBON 과 같아야 한다(시작 256 | 몸통 1536 | 끝 256).

이음매:
  · 시작→몸통: 원본에서 이어져 있던 자리를 그대로 자른다(연속).
  · 몸통 반복: 몸통 조각 P 의 끝 일부를 앞쪽으로 크로스페이드해 가로 주기화, 1408 = P × k 로 채운다.
  · 몸통→끝: 끝은 손 뗄 때 아무 위상에서나 이어 붙는다 — 붓결이 가로줄이라 줄 명암은 그대로 이어진다.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "assets-src" / "textures"
OUT = ROOT / "public" / "brush-tips" / "oil-ribbon.png"
W, H = 2048, 256
DETAIL = 0.2  # 몸통 조각 세부 — 0.35 는 몸통 반복마다 어두운 얼룩이 구슬처럼 줄지었다(2026-10-08)
STREAK_GAIN = 5.5  # 2026-10-08 사용자 «붓결 더 진하게» — 3.0 은 몸통이 거의 단색
OUT_BOLD = ROOT / "public" / "brush-tips" / "oil-ribbon-bold.png"
START, BODY, END = (0, 256), (256, 1792), (1792, 2048)


def smooth(lo, hi, v):
    t = np.clip((v - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def resize(a: np.ndarray, w: int, h: int) -> np.ndarray:
    im = Image.fromarray(a.astype(np.float32), mode="F")
    flt = Image.Resampling.LANCZOS
    return np.asarray(im.resize((w, h), flt), dtype=np.float64)


def build(src_path: Path):
    im = Image.open(src_path).convert("RGB")
    lum = np.asarray(im, dtype=np.float64) @ np.array([0.299, 0.587, 0.114])
    alpha = smooth(28, 120, lum)

    # 1) 기울기 보정 — 열마다 물감 무게중심의 직선 맞춤
    cols = np.where(alpha.sum(0) > alpha.shape[0] * 0.04)[0]
    ys = np.arange(alpha.shape[0])[:, None]
    cy = (alpha[:, cols] * ys).sum(0) / np.maximum(1e-6, alpha[:, cols].sum(0))
    slope = np.polyfit(cols, cy, 1)[0]
    ang = np.degrees(np.arctan(slope))
    if abs(ang) > 0.3:
        im = im.rotate(ang, resample=Image.Resampling.BICUBIC, fillcolor=(0, 0, 0))
        lum = np.asarray(im, dtype=np.float64) @ np.array([0.299, 0.587, 0.114])
        alpha = smooth(28, 120, lum)

    # 2) 세로 범위 — 몸통(가운데 열들)에서 물감이 절반 넘는 행 + 털 여백
    colcov = alpha.mean(0)
    cols = np.where(colcov > colcov.max() * 0.5)[0]
    x0, x1 = int(np.where(alpha.max(0) > 0.3)[0].min()), int(np.where(alpha.max(0) > 0.3)[0].max())
    mid = alpha[:, cols[len(cols) // 4] : cols[3 * len(cols) // 4]]
    rows = np.where(mid.mean(1) > 0.5)[0]
    top, bot = rows.min(), rows.max()
    pad = int((bot - top) * 0.07)
    top, bot = max(0, top - pad), min(alpha.shape[0] - 1, bot + pad)
    lum, alpha = lum[top : bot + 1], alpha[top : bot + 1]
    h0 = lum.shape[0]
    k = H / h0  # 원본 px → 텍스처 px

    # 3) 구간 자르기(원본 좌표)
    s_len = int(round((START[1] - START[0]) / k))  # 시작 구간 원본 길이
    e_len_tex = END[1] - END[0]
    # 끝: 마지막으로 물감이 있는 열에서 거꾸로, 털이 갈라지기 시작하는 곳(열 피복 < 0.85)까지 + 약간
    cov = alpha.mean(0)
    body_cov = np.median(cov[x0 + s_len : x1])
    split = x1
    for x in range(x1, x0 + s_len, -1):
        if cov[x] > body_cov * 0.9:
            split = x
            break
    e0 = max(x0 + s_len + 40, split - int(0.25 * (x1 - split)))
    b0, b1 = x0 + s_len, e0  # 몸통 원본 구간
    body_tex_len = BODY[1] - BODY[0]
    p_src = b1 - b0

    def crop(a, xa, xb, wt):
        return resize(a[:, xa:xb], wt, H)

    lum_s, al_s = crop(lum, x0, x0 + s_len, START[1] - START[0]), crop(alpha, x0, x0 + s_len, START[1] - START[0])
    # 몸통 = 줄별 프로필(가로로 일정한 붓결) + 원본 세부(조명 기울기 제거·약하게).
    # ⚠️ 짧은 원본 조각을 반복하면 이음매마다 밝기 띠·가장자리 패임이 주기적으로 보였다(시각 확인).
    seg_l = crop(lum, b0, b1, max(64, int(p_src * k)))
    seg_a = crop(alpha, b0, b1, max(64, int(p_src * k)))
    prof_l = np.median(seg_l, 1)[:, None]
    prof_a = np.median(seg_a, 1)[:, None]
    det = seg_l - prof_l
    det -= det.mean(0, keepdims=True)  # 열 평균(가로 조명 기울기) 제거
    n = det.shape[1]
    fade = max(8, n // 5)
    w = np.linspace(0, 1, fade)[None, :]
    per = det[:, : n - fade].copy()
    per[:, :fade] = det[:, n - fade :] * (1 - w) + det[:, :fade] * w  # 가로 주기화
    reps = int(np.ceil(body_tex_len / per.shape[1]))
    det_t = np.tile(per, (1, reps))[:, :body_tex_len]
    body_l = prof_l + DETAIL * det_t
    body_a = np.repeat(prof_a, body_tex_len, 1)
    P = per.shape[1]
    # 시작 구간 오른쪽 30% 를 몸통 프로필로 이어 준다(시작→몸통 연속)
    bw = int((START[1] - START[0]) * 0.3)
    ww = np.linspace(0, 1, bw)[None, :]
    lum_s[:, -bw:] = lum_s[:, -bw:] * (1 - ww) + (prof_l + DETAIL * det_t[:, :1]) * ww
    al_s[:, -bw:] = al_s[:, -bw:] * (1 - ww) + prof_a * ww
    lum_e, al_e = crop(lum, e0, x1 + 2, e_len_tex), crop(alpha, e0, x1 + 2, e_len_tex)
    # 끝 구간 왼쪽 25% 를 몸통 프로필에서 출발(몸통→끝 연속 — 끝은 아무 위상에서나 붙는다)
    ew = int(e_len_tex * 0.25)
    we = np.linspace(1, 0, ew)[None, :]
    lum_e[:, :ew] = lum_e[:, :ew] * (1 - we) + prof_l * we
    al_e[:, :ew] = np.maximum(al_e[:, :ew] * (1 - we) + prof_a * we, al_e[:, :ew] * 0)

    L = np.concatenate([lum_s, body_l, lum_e], 1)
    A = np.clip(np.concatenate([al_s, body_a, al_e], 1), 0, 1)
    # 가장자리 명암 복원: 사진의 테두리는 흰 물감이 검은 바탕과 섞여 회색으로 찍혔다 — 그걸 물감 명암으로
    # 읽으면 획 둘레에 회색 테(물번짐처럼 보임 — 2026-10-07 사용자 지적과 같은 꼴)가 생긴다. 알파로 나눠 되돌린다.
    L = np.minimum(L / np.maximum(A, 0.25), np.percentile(L[A > 0.9], 99.5))
    # 4) 명암 정규화 — 몸통 물감 명암 중앙값이 0.95(기존 유화 팁 평균 셰이드와 같은 밝기)
    paint = A > 0.8
    med = np.median(L[paint])
    rel = L / med
    # 붓결 대비 키우기 — 사진의 줄 명암(±3~5%)은 색을 곱하면 거의 안 보인다(첫 렌더 실측: 몸통이 단색)
    dev = (rel - 1) * STREAK_GAIN
    # 테두리는 물감색 그대로(밝게) — 원본 사진은 가장자리가 그늘져 획 둘레에 검은 테가 돌았다
    # (2026-10-08 사용자 «테두리가 검은 빛, 아트봉봉은 흰빛»). 알파 경계에서 18줄 안쪽까지 셰이드를 1로 올린다.
    lift = edge_lift(A)
    out = pack_channels(dev, A, lift)
    # 가는 획용(획 폭 < 40px): 256 줄을 붓털 9가닥으로 묶고 대비를 더 키운다 — 원본은 몇 px 로
    # 줄어들면 가는 결이 평균으로 사라진다(유화붓 bristle-bold 와 같은 이유)
    bands = 9
    edges = np.linspace(0, H, bands + 1).astype(int)
    # 몸통의 줄별 프로필 하나를 세로로 흐려 굵은 가닥으로 묶고, 획 방향으로는 일정하게 깐다.
    # (띠별 열 중앙값 = 벽돌 무늬, 2D 흐림 = 얼룩 — 2026-10-08 시각 확인. 시작·끝 모양은 알파가 만든다)
    prof = np.median(L[:, START[1] : BODY[1]], 1)
    sig = H / bands / 3
    kk = np.arange(-int(3 * sig), int(3 * sig) + 1)
    ker = np.exp(-(kk**2) / (2 * sig**2))
    ker /= ker.sum()
    prof = np.convolve(np.pad(prof, len(kk) // 2, mode="edge"), ker, mode="valid")
    # 원본 조명의 넓은 명암(아래쪽 절반이 통째로 어두움 → 가는 획이 원통처럼 보임)을 빼고 가닥 무늬만 남긴다
    s2 = 40
    k2 = np.arange(-3 * s2, 3 * s2 + 1)
    g2 = np.exp(-(k2**2) / (2 * s2**2))
    g2 /= g2.sum()
    trend = np.convolve(np.pad(prof, len(k2) // 2, mode="edge"), g2, mode="valid")
    prof = prof - trend + med
    Lb = np.repeat(prof[:, None], L.shape[1], 1)
    # 가닥 대비를 일정하게(줄 명암 표준편차 2.5%) — 흐림·추세 제거로 얼마나 줄었든 같은 진하기로 되돌린다
    dev = Lb[:, START[1] : BODY[1]] / med - 1
    Lb = med * (1 + (Lb / med - 1) * (0.025 / max(1e-4, float(dev[A[:, START[1] : BODY[1]] > 0.8].std()))))
    yy = np.arange(H)[:, None]
    groove = np.zeros_like(yy, dtype=float)
    for e in edges[1:-1]:
        groove += np.exp(-((yy - e) ** 2) / (2 * 2.5**2))  # 가닥 사이 골
    relb = Lb / med - 0.035 * groove
    dev_b = (relb - 1) * STREAK_GAIN * 1.2
    # 가는 획에선 18줄이 1px 도 안 된다 — 테두리 쪽 가닥 두 개 폭(≈56줄)까지 밝혀 «검은 테»로 안 읽히게
    lift_b = edge_lift(A, rows=56)
    out_bold = pack_channels(dev_b, A, lift_b)
    info = dict(angle=round(float(ang), 2), crop=[int(top), int(bot), x0, x1], start_src=[x0, x0 + s_len], body_src=[b0, b0 + p_src],
                body_period_tex=P, reps=reps, end_src=[e0, x1], body_cov=round(float(body_cov), 3))
    return out, out_bold, info


def pack_channels(dev: np.ndarray, A: np.ndarray, lift: np.ndarray) -> np.ndarray:
    """
    R = 물감 명암(골만 살짝 어둡게, 하한 0.72) · G = 붓결 하이라이트(밝은 줄 → 셰이더가 흰빛을 섞는다) · B = R.
    붓결을 어두운 골로만 그리면 획 전체가 고른 색보다 어둡고 «검은 느낌»이 났다(2026-10-08 사용자 두 번째 지적).
    아트봉봉처럼 몸통은 제 색 그대로, 결은 밝은 줄로. 테두리는 어둡게 하지 않고 옅은 흰 테.
    """
    r = np.clip(1 + np.minimum(dev, 0) * 0.5, 0.76, 1.0)
    g = np.clip(np.maximum(dev, 0) * 3.4, 0, 1)  # 2.5 → 3.4: 2026-10-08 «붓결 더 강하게»(4.0 은 획이 하얗게 바램)
    r = r * (1 - lift) + lift
    g = np.maximum(g * (1 - lift), lift * 0.5)
    paint = A > 0.004
    R = np.where(paint, r * 255, 255.0)
    G = np.where(paint, g * 255, 128.0)  # 투명 이웃 필터링이 테두리 흰 테(0.5)와 같은 값이 되게
    return np.dstack([R, G, R, A * 255]).round().astype(np.uint8)


def edge_lift(A: np.ndarray, rows: int = 18) -> np.ndarray:
    """세로로 알파 경계(0.5)에서 가까울수록 1 — 열마다 위·아래 경계까지 거리"""
    inside = A > 0.5
    h = A.shape[0]
    top = np.zeros(A.shape)
    bot = np.zeros(A.shape)
    run = np.zeros(A.shape[1])
    for y in range(h):
        run = np.where(inside[y], run + 1, 0)
        top[y] = run
    run = np.zeros(A.shape[1])
    for y in range(h - 1, -1, -1):
        run = np.where(inside[y], run + 1, 0)
        bot[y] = run
    d = np.minimum(top, bot)
    t = np.clip(d / rows, 0, 1)
    return 1 - t * t * (3 - 2 * t)


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    src = Path(args[0]) if args else SRC_DIR / "sources" / "firefly-oilstroke.png"
    out, out_bold, info = build(src)
    print("ribbon", json.dumps(info, ensure_ascii=False))
    xmp = Image.open(src).info.get("XML:com.adobe.xmp") or ""
    m = re.search(r'dcterms:provenance="([^"]+)"', xmp)
    pnginfo = PngInfo()
    if m:  # Firefly Content Credentials 참조 보존(Adobe 생성형 AI 약관 §3.1 — 종이 결 팩과 같은 방식)
        pnginfo.add_itxt(
            "XML:com.adobe.xmp",
            '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
            '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" '
            'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dc="http://purl.org/dc/elements/1.1/" '
            f'dcterms:provenance="{m.group(1)}" dc:source="{src.name}" '
            'dc:description="Derived brush-stroke texture from an Adobe Firefly generated image. Generated with AI."/>'
            "</rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>",
        )
    if "--preview" in sys.argv:
        pv = Path(sys.argv[sys.argv.index("--preview") + 1])
        bg = np.full((H, W, 3), 60.0)
        a = out[..., 3:4] / 255
        Image.fromarray((out[..., :3] * a + bg * (1 - a)).astype(np.uint8)).save(pv)
        Image.fromarray((out_bold[..., :3] * a + bg * (1 - a)).astype(np.uint8)).save(str(pv).replace(".png", "-bold.png"))
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, mode="RGBA").save(OUT, optimize=True, pnginfo=pnginfo)
    Image.fromarray(out_bold, mode="RGBA").save(OUT_BOLD, optimize=True, pnginfo=pnginfo)
    prov = {
        "file": "public/brush-tips/oil-ribbon.png",
        "sha256": hashlib.sha256(OUT.read_bytes()).hexdigest(),
        "bold_sha256": hashlib.sha256(OUT_BOLD.read_bytes()).hexdigest(),
        "source": str(src.relative_to(SRC_DIR)),
        "source_sha256": hashlib.sha256(src.read_bytes()).hexdigest(),
        "origin": "Adobe Firefly (Firefly Image 5) 2026-10-07 — prompts/oilstroke.txt",
        "license": "Adobe Firefly output — Adobe Generative AI Product Specific Terms 2026-04-23 (개인 Premium, IP 면책 없음)",
        **({"content_credentials": m.group(1)} if m else {}),
        "layout": {"W": W, "H": H, "start": START, "body": BODY, "end": END},
        **info,
    }
    (SRC_DIR / "PROVENANCE-ribbon.json").write_text(json.dumps(prov, indent=2, ensure_ascii=False) + "\n")
    print("→", OUT.relative_to(ROOT), OUT.stat().st_size // 1024, "KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
