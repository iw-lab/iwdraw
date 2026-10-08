"""종이 결 텍스처 공용 라이브러리 — 가공(process-texture.py)과 게이트(gate-textures.py)가 같이 쓴다.

필드 = 0..1 실수 배열(타일, wrap). 런타임(src/engine/core/paperPack.ts)은 이 파일들을 «순위»로 읽어
기존 프로시저럴 필드의 값 분포에 다시 입힌다(히스토그램 매칭) → grainLo/Hi·tint 곡선이 그대로 유효.
그래서 여기서 중요한 건 값 분포가 아니라 «공간 구조»(결의 크기·이음매·얼룩)다.
"""
from __future__ import annotations

import numpy as np

TILE = 256


# ── 프로시저럴 필드 이식(src/engine/core/paper.ts 와 같은 식) — 결 크기 기준선 ──────────
def lattice_noise(size: int, cells: int, rng: np.random.Generator) -> np.ndarray:
    lat = rng.random((cells, cells))
    k = cells / size
    f = np.arange(size) * k
    i0 = np.floor(f).astype(int) % cells
    i1 = (i0 + 1) % cells
    t = f - np.floor(f)
    a = lat[np.ix_(i0, i0)]
    b = lat[np.ix_(i0, i1)]
    c = lat[np.ix_(i1, i0)]
    d = lat[np.ix_(i1, i1)]
    tx = t[None, :]
    ty = t[:, None]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def weave_line(size: int, rng: np.random.Generator, spread: float = 1.0) -> np.ndarray:
    raw = 0.5 + (rng.random(size) - 0.5) * spread
    return (np.roll(raw, 1) + raw * 2 + np.roll(raw, -1)) / 4


def procedural(kind: str, which: str = "grain", seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    if kind == "smooth":
        return 0.35 * lattice_noise(TILE, 40, rng) + 0.65 * lattice_noise(TILE, 120, rng)
    if kind == "linen" and which == "grain":
        n2 = lattice_noise(TILE, 96, rng)
        rows, cols = weave_line(TILE, rng), weave_line(TILE, rng)
        return 0.14 * n2 + 0.43 * rows[:, None] + 0.43 * cols[None, :]
    if kind == "linen":
        S = 512
        n2 = lattice_noise(S, 256, rng)
        rows, cols = weave_line(S, rng, 0.4), weave_line(S, rng, 0.4)
        return 0.12 * n2 + 0.44 * rows[:, None] + 0.44 * cols[None, :]
    if kind == "hanji":
        return 0.55 * lattice_noise(TILE, 80, rng) + 0.45 * lattice_noise(TILE, 150, rng)
    raise ValueError(kind)


# ── 가공 ─────────────────────────────────────────────────────────────────────
def to_gray(arr: np.ndarray) -> np.ndarray:
    a = arr.astype(np.float64)
    if a.ndim == 3:
        a = a[..., :3] @ np.array([0.299, 0.587, 0.114])
    return a


def make_seamless(img: np.ndarray) -> np.ndarray:
    """반 타일 오프셋 + 분산 보존 크로스페이드. 가장자리에서 가중 0인 창 w 로
    T = (w·I + (1−w)·R) / sqrt(w² + (1−w)²) (평균 제거 후) — 단순 평균은 블렌드 띠의 대비가
    떨어져 «십자 얼룩»이 된다. 결과의 wrap 경계 = 원본 내부라 연속이다."""
    n, m = img.shape
    I = img - img.mean()
    R = np.roll(np.roll(I, n // 2, 0), m // 2, 1)
    wy = np.sin(np.pi * (np.arange(n) + 0.5) / n) ** 2
    wx = np.sin(np.pi * (np.arange(m) + 0.5) / m) ** 2
    w = np.sqrt(wy[:, None] * wx[None, :])
    return (w * I + (1 - w) * R) / np.sqrt(w**2 + (1 - w) ** 2)


def fft_highpass(tile: np.ndarray, cut: float) -> np.ndarray:
    """주기 타일의 FFT 고역통과 — cycles/tile ≤ cut 성분을 부드럽게 제거(이음매를 다시 열지 않는다)."""
    n, m = tile.shape
    F = np.fft.fft2(tile)
    fy = np.fft.fftfreq(n) * n
    fx = np.fft.fftfreq(m) * m
    r = np.hypot(fy[:, None], fx[None, :])
    lo, hi = cut, cut * 2
    g = np.clip((r - lo) / (hi - lo), 0, 1)
    g = g * g * (3 - 2 * g)
    return np.real(np.fft.ifft2(F * g))


def rank_uniform(tile: np.ndarray) -> np.ndarray:
    """값 → 순위 백분위(0..1). 런타임 히스토그램 매칭의 입력 형식."""
    flat = tile.ravel()
    order = np.argsort(flat, kind="stable")
    r = np.empty_like(order, dtype=np.float64)
    r[order] = (np.arange(flat.size) + 0.5) / flat.size
    return r.reshape(tile.shape)


def resize_area(img: np.ndarray, size: int) -> np.ndarray:
    from PIL import Image

    im = Image.fromarray(img.astype(np.float32), mode="F")
    # 축소 = BOX(면적 평균), 확대 = BICUBIC — BOX 로 확대하면 최근접처럼 계단이 진다
    flt = Image.Resampling.BOX if img.shape[0] >= size else Image.Resampling.BICUBIC
    return np.asarray(im.resize((size, size), flt), dtype=np.float64)


# ── 지표 ─────────────────────────────────────────────────────────────────────
def radial_power(tile: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    t = tile - tile.mean()
    P = np.abs(np.fft.fft2(t)) ** 2
    n = tile.shape[0]
    f = np.fft.fftfreq(n) * n
    r = np.hypot(f[:, None], f[None, :]).astype(int)
    tot = np.bincount(r.ravel(), P.ravel())
    return np.arange(tot.size), tot


def spectral_centroid(tile: np.ndarray) -> float:
    """결 크기 지표 — 파워 가중 평균 주파수(cycles/px). 프로시저럴과 맞출 대상."""
    k, p = radial_power(tile)
    n = tile.shape[0]
    p = p[1 : n // 2]
    k = k[1 : n // 2]
    return float((k * p).sum() / p.sum() / n)


def lowfreq_ratio(tile: np.ndarray, cut: int = 4) -> float:
    """cycles/tile ≤ cut 대역의 파워 비율 — «얼룩»(지적 3회+)의 정체."""
    k, p = radial_power(tile)
    return float(p[1 : cut + 1].sum() / p[1:].sum())


def seam_ratio(tile: np.ndarray) -> float:
    """wrap 경계 열쌍의 평균 차분 / 내부 열쌍 255개 중 최댓값(가로·세로 중 큰 쪽).
    이음매가 없으면 경계도 열쌍 중 하나일 뿐이라 ≤ 1 근처. ⚠️ «내부 평균 대비»로 재면
    줄무늬(캔버스 위브)는 경계가 표본 1개짜리 통계라 이음매 없이도 1.4~3.0 으로 튄다(실측)."""
    out = 0.0
    for t in (tile, tile.T):
        edge = np.abs(t[:, 0] - t[:, -1]).mean()
        inner = np.abs(np.diff(t, axis=1)).mean(axis=0)
        out = max(out, edge / inner.max())
    return float(out)


def patch_heterogeneity(tile: np.ndarray, patch: int = 32) -> tuple[float, float]:
    """반복 타일이 «격자»로 읽히는 건 주기가 아니라(타일은 항상 정확히 주기적 — 자기상관 피크는
    언제나 1이라 죽은 지표다) 눈에 띄는 국소 특징이 주기마다 다시 나타나서다.
    (패치 평균의 편차 / 전체 std, 패치 std 의 변동계수) — 둘 다 작아야 균질한 결."""
    n = tile.shape[0] // patch
    t = tile[: n * patch, : n * patch].reshape(n, patch, n, patch)
    means = t.mean(axis=(1, 3))
    stds = t.std(axis=(1, 3))
    return float(np.abs(means - tile.mean()).max() / tile.std()), float(stds.std() / stds.mean())


def periodic_component(img: np.ndarray) -> np.ndarray:
    """Moisan 주기+평활 분해의 주기 성분 — 크로스페이드 없이 이음매를 없앤다.
    make_seamless(반 타일 크로스페이드)는 결이 고운 사진에서 십자 띠가 보였다(2026-10-08 canvasfine 실측)."""
    u = img.astype(np.float64)
    m, n = u.shape
    v = np.zeros_like(u)
    v[0, :] += u[-1, :] - u[0, :]
    v[-1, :] += u[0, :] - u[-1, :]
    v[:, 0] += u[:, -1] - u[:, 0]
    v[:, -1] += u[:, 0] - u[:, -1]
    q = np.arange(m)[:, None]
    r = np.arange(n)[None, :]
    den = 2 * np.cos(2 * np.pi * q / m) + 2 * np.cos(2 * np.pi * r / n) - 4
    den[0, 0] = 1
    S = np.fft.fft2(v) / den
    S[0, 0] = 0
    return u - np.real(np.fft.ifft2(S))


def _quilt_wrap_x(C: np.ndarray, n: int) -> np.ndarray:
    """가로 이음매 — C(폭 n+ov)의 오른쪽 넘침 A 와 왼쪽 시작 B 를 최소 오차 경로(DP)로 잘라 붙인다.
    결과(폭 n)의 오른쪽 끝 → 왼쪽 끝이 원본에서 실제로 이웃한 픽셀이 되어 무늬 위상까지 이어진다."""
    ov = C.shape[1] - n
    A = C[:, n:]
    B = C[:, :ov]
    E = (A - B) ** 2
    h = E.shape[0]
    cost = E.copy()
    back = np.zeros(E.shape, dtype=int)
    for y in range(1, h):
        for x in range(ov):
            lo, hi = max(0, x - 1), min(ov, x + 2)
            k = lo + int(np.argmin(cost[y - 1, lo:hi]))
            back[y, x] = k
            cost[y, x] += cost[y - 1, k]
    out = C[:, :n].copy()
    cut = np.zeros(h, dtype=int)
    x = int(np.argmin(cost[-1]))
    for y in range(h - 1, -1, -1):
        cut[y] = x
        x = back[y, x]
    # 경로 왼쪽 = 넘침(끝에서 이어짐), 오른쪽 = 원래 시작. 경로 둘레 ±feather px 는 섞는다 —
    # 딱 자르면 경로가 실을 끊어 밝은 점선이 보였다(2026-10-08 canvasfine 시뮬)
    feather = max(2, ov // 8)
    xs = np.arange(ov)[None, :]
    wA = np.clip((cut[:, None] - xs) / (2 * feather) + 0.5, 0, 1)
    out[:, :ov] = A * wA + B * (1 - wA)
    return out


def quilt_tile(C: np.ndarray, n: int) -> np.ndarray:
    """(n+ov)² 크롭 → 이음매 없는 n² 타일(가로·세로 최소 오차 경계)."""
    return _quilt_wrap_x(_quilt_wrap_x(C, n).T, n).T
