#!/usr/bin/env python3
"""
캔버스 요철(릴리프) 타일 — Firefly 캔버스천 사진 → public/textures/paper-linen-relief.png

아트봉봉 비교(2026-10-08 사용자): 그쪽은 캔버스 천의 입체 요철(빛·그림자)이 빈 종이와 물감 위에
똑같이 비쳐 «천 위에 물감이 앉은» 느낌이다. 우리 tint 는 갈색 그림자 한 가지를 곱해(multiply)
하이라이트가 없고, 절차 패턴에 히스토그램을 맞춰 가로줄만 남았다.
여기서는 사진의 밝기 고역(조명 기울기 제거)을 그대로 높이 음영으로 쓴다 — 회색 128 = 중립,
엔진이 화면 맨 위에 soft-light 로 덮는다(밝은 곳은 물감을 밝히고 골은 어둡힌다).

  python3 scripts/process-relief.py [--preview 경로]
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
# 젯소로 메운 고운 캔버스(Firefly canvasfine) — 아트봉봉 캔버스처럼 고르고 부드러운 결.
# 레이킹 라이트 canvas3d 는 가로 실 줄이 강해 «가로 점선·얼룩»으로 보였다(2026-10-08 사용자 «기본 캔버스가 얼룩덜룩»)
SRC = ROOT / "assets-src/textures/sources/firefly-canvasfine.png"
OUT = ROOT / "public/textures/paper-linen-relief.png"
PROV = ROOT / "assets-src/textures/PROVENANCE-relief.json"
SIZE = 256  # 타일(캔버스 px)
CROP = 768  # 원본 768px → 타일 256 — 384 의 절반 간격(2026-10-08 사용자 «캔버스 간격 지금의 절반»)
OV = 64  # 퀼팅 겹침
AMP = 52  # 128 ± AMP·(표준편차 단위) — 엔진의 soft-light 세기는 globalAlpha 로 따로 조절


def main() -> int:
    src = np.asarray(Image.open(SRC).convert("RGB"))
    g = to_gray(src)
    h, w = g.shape
    # 조명(σ≈12px 넘는 저주파) 제거 — 남겨 두면 퀼팅 경계가 밝기 단차 선으로 보였다
    F = np.fft.fft2(g)
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = g - np.real(np.fft.ifft2(F * np.exp(-(fx**2 + fy**2) * (2 * np.pi * 12) ** 2 / 2)))
    n = CROP + OV
    y0 = (h - n) // 2
    x0 = (w - n) // 2
    # 최소 오차 경계 퀼팅 + 경로 둘레 섞기 — 반 타일 크로스페이드는 고운 직조에서 십자 띠, 딱 자르면 점선
    t = resize_area(quilt_tile(g[y0 : y0 + n, x0 : x0 + n], CROP), SIZE)
    t = fft_highpass(t, 3)
    F = np.fft.fft2(t)
    fy = np.fft.fftfreq(SIZE)[:, None]
    fx = np.fft.fftfreq(SIZE)[None, :]
    t = np.real(np.fft.ifft2(F * np.exp(-(fx**2 + fy**2) / (2 * 0.14**2))))  # 결이 절반 크기라 흐림 반경도 절반(0.07 이면 결이 지워진다)
    t = (t - t.mean()) / max(1e-6, t.std())
    v = np.clip(128 + t * AMP, 0, 255).round().astype(np.uint8)
    seam = seam_ratio(v.astype(np.float64))

    xmp = Image.open(SRC).info.get("XML:com.adobe.xmp") or ""
    m = re.search(r'dcterms:provenance="([^"]+)"', xmp)
    info = PngInfo()
    if m:  # Firefly Content Credentials 참조 보존(Adobe 생성형 AI 약관 §3.1 — 종이 결 팩과 같은 방식)
        info.add_itxt(
            "XML:com.adobe.xmp",
            '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
            '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" '
            'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dc="http://purl.org/dc/elements/1.1/" '
            f'dcterms:provenance="{m.group(1)}" dc:source="{SRC.name}" '
            'dc:description="Derived canvas relief texture from an Adobe Firefly generated image. Generated with AI."/>'
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
                "overlap": OV,
                "size": SIZE,
                "amp": AMP,
                "seam_ratio": round(float(seam), 3),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    print(f"→ {OUT.relative_to(ROOT)} seam={seam:.3f} cc={'yes' if m else 'NO'}")
    if "--preview" in sys.argv:
        pv = Path(sys.argv[sys.argv.index("--preview") + 1])
        Image.fromarray(np.tile(v, (3, 3)), mode="L").save(pv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
