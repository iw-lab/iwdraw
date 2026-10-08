#!/usr/bin/env python3
"""
물감 높이 타일 — Firefly 붓털 물감 높이 렌더(paintheight) → public/brush-tips/paint-height.png (512×256 회색, 128 = 중립)
납작붓 셰이더가 ?relief=ff 일 때 절차 높이장(paintH) 대신 쓴다(비교 실험, 2026-10-08 사용자 요청).
  python3 scripts/process-paint-height.py
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
from texture_lib import _quilt_wrap_x, to_gray  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets-src/textures/sources/firefly-paintheight.png"
OUT = ROOT / "public/brush-tips/paint-height.png"
PROV = ROOT / "assets-src/textures/PROVENANCE-paint-height.json"
W, H = 512, 256  # 타일 px (셰이더가 캔버스 px 로 늘려 붙인다)
CW, CH, OV = 1024, 512, 96  # 원본 크롭(가로는 넘침 OV 포함)


def main() -> int:
    g = to_gray(np.asarray(Image.open(SRC).convert("RGB")))
    h, w = g.shape
    F = np.fft.fft2(g)
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = g - np.real(np.fft.ifft2(F * np.exp(-(fx**2 + fy**2) * (2 * np.pi * 20) ** 2 / 2)))  # 조명 기울기 제거
    y0 = (h - CH - OV) // 2
    x0 = (w - CW - OV) // 2
    c = g[y0 : y0 + CH + OV, x0 : x0 + CW + OV]
    t = _quilt_wrap_x(_quilt_wrap_x(c, CW).T, CH).T  # 가로·세로 이음매
    t = np.asarray(Image.fromarray(t.astype(np.float32), mode="F").resize((W, H), Image.Resampling.BOX))
    t = (t - t.mean()) / max(1e-6, t.std())
    v = np.clip(128 + t * 42, 0, 255).round().astype(np.uint8)
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
            'dc:description="Derived paint height texture from an Adobe Firefly generated image. Generated with AI."/>'
            "</rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>",
        )
    Image.fromarray(v, mode="L").save(OUT, optimize=True, pnginfo=info)
    PROV.write_text(json.dumps({
        "output": str(OUT.relative_to(ROOT)), "sha256": hashlib.sha256(OUT.read_bytes()).hexdigest(),
        "source": str(SRC.relative_to(ROOT)), "content_credentials": m.group(1) if m else None,
        "crop": [CW, CH, OV], "size": [W, H],
    }, ensure_ascii=False, indent=2) + "\n")
    print(f"→ {OUT.relative_to(ROOT)} cc={'yes' if m else 'NO'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
