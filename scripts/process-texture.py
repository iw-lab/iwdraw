#!/usr/bin/env python3
"""종이 결 팩 가공 — 실물 재질 원본 → 앱이 읽는 순위 타일(public/textures/).

  python3 scripts/process-texture.py            # assets-src/textures/spec.json 대로 전부
  python3 scripts/process-texture.py --dry-run  # 지표만 출력

순서(검수 반영 — 바꾸지 말 것):
  잘라내기 → 축소(BOX) → 이음매 제거(분산 보존 크로스페이드) → FFT 고역통과 → 순위화
  · 고역통과를 이음매 제거 «뒤», 주기 FFT 로 해야 이음매가 다시 열리지 않는다.
  · 축소 «뒤» 타일 해상도 기준으로 고역통과해야 차단 대역이 얼룩 게이트와 같다.
  · 크롭 크기는 자동: 결과 결의 무게중심 주파수가 기존 프로시저럴 결과 가장 가까운 크기
    (브러시 상수 — 크레용 틈 크기 등 — 가 그 결 크기에 튜닝돼 있다).

출력: public/textures/paper-<kind>-<layer>.png(8비트 그레이 순위) · public/textures/pack.json
      assets-src/textures/PROVENANCE.json(원본·납품 sha256, 출처·라이선스)
게이트: scripts/gate-textures.py(pnpm gate:textures)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from texture_lib import (  # noqa: E402
    fft_highpass,
    lowfreq_ratio,
    make_seamless,
    patch_heterogeneity,
    procedural,
    rank_uniform,
    resize_area,
    seam_ratio,
    spectral_centroid,
    to_gray,
)

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "assets-src" / "textures"
OUT_DIR = ROOT / "public" / "textures"
HP_CUT = 4  # cycles/tile — 얼룩 게이트(lowfreq_ratio cut=4)와 같은 대역


def source_provenance(p: Path) -> str | None:
    """Firefly 출력의 Content Credentials 참조(XMP dcterms:provenance → Adobe C2PA 클라우드 매니페스트)."""
    import re

    xmp = Image.open(p).info.get("XML:com.adobe.xmp") or ""
    m = re.search(r'dcterms:provenance="([^"]+)"', xmp)
    return m.group(1) if m else None


def derived_xmp(prov_url: str, source_name: str) -> str:
    """파생물 XMP — 원본의 Content Credentials 참조를 지우지 않고 그대로 싣는다(Adobe 생성형 AI 약관 §3.1)."""
    return (
        '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" '
        'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dc="http://purl.org/dc/elements/1.1/" '
        f'dcterms:provenance="{prov_url}" dc:source="{source_name}" '
        'dc:description="Derived texture (rank tile) from an Adobe Firefly generated image. Generated with AI."/>'
        '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
    )


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def build(src: np.ndarray, crop: int, x: int, y: int, size: int) -> np.ndarray:
    c = src[y : y + crop, x : x + crop]
    t = resize_area(c, size)
    return fft_highpass(make_seamless(t), HP_CUT * size / 256)


def auto_crop(src: np.ndarray, x: int, y: int, size: int, target: float, max_crop: int) -> int:
    """결 크기(무게중심 주파수)가 target 에 가장 가까운 크롭 크기(타일 256 기준 크롭 × size/256)."""
    best, best_err = None, 1e9
    for base in range(96, 1025, 8):
        crop = int(base * size / 256)
        if crop > max_crop:
            break
        c = spectral_centroid(build(src, crop, x, y, size))
        err = abs(c - target) / target
        if err < best_err:
            best, best_err = crop, err
    return best


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    spec = json.loads((SRC_DIR / "spec.json").read_text())
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    prov = {"_note": "종이 결 팩 출처 원장 — scripts/process-texture.py 가 쓴다. 게이트가 sha256 을 대조한다.", "files": {}}
    files: dict[str, dict[str, str]] = {}
    for kind, layers in spec["paper"].items():
        for layer, s in layers.items():
            srcp = SRC_DIR / s["src"]
            src = to_gray(np.asarray(Image.open(srcp)))
            # 높이맵은 «높을수록 봉우리» — 종이 필드는 «클수록 골짜기»(안료가 덜 앉는 곳)라 뒤집는다
            if s.get("invert"):
                src = -src
            size = s.get("size", 256)
            x, y = s.get("x", 0), s.get("y", 0)
            max_crop = min(src.shape[0] - y, src.shape[1] - x)
            ref = procedural(kind, layer if kind == "linen" else "grain")
            target = spectral_centroid(ref if ref.shape[0] == size else procedural(kind, "grain"))
            # 줄무늬 재질(캔버스 위브)은 무게중심이 실 간격을 대변하지 못한다(기존 linen 은 실이 아니라
            # 픽셀 난수 줄) → "scale"(캔버스 px / 원본 px)로 실 간격을 직접 정한다. 등방 재질은 자동.
            if "scale" in s:
                crop = int(round(size / s["scale"]))
            else:
                crop = s.get("crop") or auto_crop(src, x, y, size, target, max_crop)
            tile = build(src, crop, x, y, size)
            # 침식 결 이어 붙이기(soften): 평직의 실 사이 틈은 짧은 점선이라 문턱(grainLo)을 넘는 곳이
            # 흩어진 점이 된다 → 유화 획 안에서 짜임이 사라졌다(시각 확인). 주기 가우시안으로 틈을 줄로 잇는다.
            if s.get("soften"):
                f = np.fft.fftfreq(size)
                g = np.exp(-2 * (np.pi * s["soften"]) ** 2 * (f[:, None] ** 2 + f[None, :] ** 2))
                tile = np.real(np.fft.ifft2(np.fft.fft2(tile) * g))
            # C′ 요철 음영 굽기(표시 tint 전용): 좌상단 광원 — 빛을 등진 경사면을 골짜기처럼 어둡게.
            # tile = 깊이(클수록 골)라 «등진 면» = ∂깊이/∂x + ∂깊이/∂y (주기 중앙차분 = 이음매 유지).
            # 실측 높이맵(ambientCG Displacement)에서만 의미가 있다 — 사진 명도는 높이가 아니다(검수 지적).
            if s.get("relief"):
                g = (np.roll(tile, -1, 1) - np.roll(tile, 1, 1)) + (np.roll(tile, -1, 0) - np.roll(tile, 1, 0))
                tile = tile / tile.std() + s["relief"] * g / g.std()
            ph = patch_heterogeneity(tile)
            print(
                f"{kind}-{layer}: crop {crop}→{size} centroid {spectral_centroid(tile):.3f} (기준 {target:.3f}) "
                f"seam {seam_ratio(tile):.2f} lowf {lowfreq_ratio(tile):.4f} patch {ph[0]:.2f}/{ph[1]:.2f}"
            )
            if args.dry_run:
                continue
            u8 = np.clip(np.round(rank_uniform(tile) * 256 - 0.5), 0, 255).astype(np.uint8)
            name = f"paper-{kind}-{layer}.png"
            out = OUT_DIR / name
            prov_url = source_provenance(srcp)
            pnginfo = None
            if prov_url:
                from PIL.PngImagePlugin import PngInfo

                pnginfo = PngInfo()
                pnginfo.add_itxt("XML:com.adobe.xmp", derived_xmp(prov_url, s["src"]))
            Image.fromarray(u8, mode="L").save(out, optimize=True, pnginfo=pnginfo)
            files.setdefault(kind, {})[layer] = f"/textures/{name}"
            prov["files"][name] = {
                "kind": kind,
                "layer": layer,
                "source": s["src"],
                "source_sha256": sha(srcp),
                "sha256": sha(out),
                "origin": s["origin"],
                "license": s["license"],
                "crop": [x, y, crop],
                **({"content_credentials": prov_url} if prov_url else {}),
                "size": size,
            }
            print(f"   → {out.relative_to(ROOT)} {out.stat().st_size // 1024}KB")
    if not args.dry_run:
        (OUT_DIR / "pack.json").write_text(json.dumps({"version": spec.get("version", 1), "files": files}, indent=2) + "\n")
        (SRC_DIR / "PROVENANCE.json").write_text(json.dumps(prov, indent=2, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
