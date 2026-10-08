#!/usr/bin/env python3
"""
물감 표면 요철 타일 — Firefly 짧은 붓털 이랑 사진(paintdab) → public/brush-tips/paint-relief.png (256² 회색, 128 = 중립)

납작붓 셰이더가 «획 굵기와 무관한 고정 픽셀 크기»로, 획 진행 방향을 따라 아주 옅게 입힌다.
띠 텍스처에 구워 넣으면 굵기에 비례해 이랑이 커져 굵은 획이 나무껍질처럼 보였다(2026-10-08 사용자 «징그러워»).
  python3 scripts/process-paint-relief.py
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

sys.path.insert(0, str(Path(__file__).parent))
from texture_lib import fft_highpass, quilt_tile, resize_area, seam_ratio, to_gray  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets-src/textures/sources/firefly-paintdab.png"
OUT = ROOT / "public/brush-tips/paint-relief.png"
PROV = ROOT / "assets-src/textures/PROVENANCE-paint-relief.json"
SIZE = 256
CROP = 768
OV = 64
AMP = 40


def main() -> int:
    g = to_gray(np.asarray(Image.open(SRC).convert("RGB")))
    h, w = g.shape
    F = np.fft.fft2(g)
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = g - np.real(np.fft.ifft2(F * np.exp(-(fx**2 + fy**2) * (2 * np.pi * 30) ** 2 / 2)))  # 조명 기울기 제거
    n = CROP + OV
    y0 = (h - n) // 2
    x0 = (w - n) // 2
    t = resize_area(quilt_tile(g[y0 : y0 + n, x0 : x0 + n], CROP), SIZE)
    t = fft_highpass(t, 3)
    t = (t - t.mean()) / max(1e-6, t.std())
    v = np.clip(128 + t * AMP, 0, 255).round().astype(np.uint8)
    seam = seam_ratio(v.astype(np.float64))
    xmp = Image.open(SRC).info.get("XML:com.adobe.xmp") or ""
    m = re.search(r'dcterms:provenance="([^"]+)"', xmp)
    info = PngInfo()
    if m:  # Firefly Content Credentials 참조 보존(Adobe 생성형 AI 약관 §3.1)
        info.add_itxt(
            "XML:com.adobe.xmp",
            '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
            '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" '
            'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dc="http://purl.org/dc/elements/1.1/" '
            f'dcterms:provenance="{m.group(1)}" dc:source="{SRC.name}" '
            'dc:description="Derived paint relief texture from an Adobe Firefly generated image. Generated with AI."/>'
            "</rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>",
        )
    Image.fromarray(v, mode="L").save(OUT, optimize=True, pnginfo=info)
    PROV.write_text(
        json.dumps(
            {
                "output": str(OUT.relative_to(ROOT)),
                "sha256": hashlib.sha256(OUT.read_bytes()).hexdigest(),
                "source": str(SRC.relative_to(ROOT)),
                "content_credentials": m.group(1) if m else None,
                "crop": CROP,
                "size": SIZE,
                "seam_ratio": round(float(seam), 3),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    print(f"→ {OUT.relative_to(ROOT)} seam={seam:.3f} cc={'yes' if m else 'NO'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
