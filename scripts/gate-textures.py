#!/usr/bin/env python3
"""종이 결 팩 게이트 — 납품 파일(public/textures)을 «디코드해서» 잰다. pnpm gate:textures

  python3 scripts/gate-textures.py            # 납품 팩 검사(FAIL 이면 exit 1)
  python3 scripts/gate-textures.py --selftest # 일부러 망가뜨린 타일이 전부 FAIL 하는지(게이트의 해상력 증명)

지표와 임계(근거는 texture_lib.py 주석·docs/PLAN-FIREFLY-TEXTURE-2026-10.md):
  seam      wrap 경계 열쌍 / 내부 열쌍 최댓값 ≤ 1.10        (원본 크롭 그대로 = 1.34 실측)
  lowf      cycles/tile ≤ 4 파워 비율 ≤ 0.005             («얼룩» — 조명 기울기 = 수십 %)
  patch     패치 평균 최대편차/std ≤ 0.30, 패치 std CV ≤ 0.20 (덩어리 하나 = 0.76 실측)
  centroid  결 크기 = 프로시저럴의 ±25%                   (브러시 상수가 그 결에 튜닝됨)
  uniform   순위 히스토그램 최대 편차 ≤ 30%               (런타임 히스토그램 매칭의 전제)
  size      grain = 256², 개당 ≤ 64KB, 합계 ≤ 640KB, 8비트 그레이
  provenance 원본·납품 sha256 일치, 라이선스 기재
⚠️ 자기상관 «주기 피크»는 쓰지 않는다 — 반복 타일은 항상 정확히 주기적이라 언제나 1(죽은 지표).
"""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from texture_lib import (  # noqa: E402
    lowfreq_ratio,
    patch_heterogeneity,
    procedural,
    spectral_centroid,
    seam_ratio,
)

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "public" / "textures"
SRC = ROOT / "assets-src" / "textures"
LIM = dict(seam=1.10, lowf=0.005, pmean=0.30, pstd=0.20, centroid=0.25, uniform=0.30, file_kb=64, total_kb=640)


def check_tile(name: str, kind: str, layer: str, path: Path) -> list[str]:
    errs = []
    im = Image.open(path)
    if im.mode != "L":
        errs.append(f"{name}: 8비트 그레이가 아님({im.mode})")
    a = np.asarray(im.convert("L")).astype(np.float64)
    if a.shape[0] != a.shape[1]:
        return errs + [f"{name}: 정사각이 아님 {a.shape}"]
    if layer == "grain" and a.shape[0] != 256:
        errs.append(f"{name}: 침식 결은 256 이어야 한다(셰이더가 256 주기로 읽음) — {a.shape[0]}")
    kb = path.stat().st_size / 1024
    if kb > LIM["file_kb"]:
        errs.append(f"{name}: {kb:.0f}KB > {LIM['file_kb']}KB")
    s = seam_ratio(a)
    lf = lowfreq_ratio(a)
    pm, ps = patch_heterogeneity(a)
    c = spectral_centroid(a)
    ref = spectral_centroid(procedural(kind, "grain"))
    hist = np.bincount(a.astype(int).ravel(), minlength=256)
    uni = np.abs(hist / hist.mean() - 1).max()
    if s > LIM["seam"]:
        errs.append(f"{name}: 이음매 {s:.2f} > {LIM['seam']}")
    if lf > LIM["lowf"]:
        errs.append(f"{name}: 얼룩(저주파) {lf:.4f} > {LIM['lowf']}")
    if pm > LIM["pmean"] or ps > LIM["pstd"]:
        errs.append(f"{name}: 국소 덩어리 patch {pm:.2f}/{ps:.2f} > {LIM['pmean']}/{LIM['pstd']}")
    if abs(c - ref) / ref > LIM["centroid"]:
        errs.append(f"{name}: 결 크기 {c:.3f} vs 프로시저럴 {ref:.3f} (±{LIM['centroid']:.0%} 밖)")
    if uni > LIM["uniform"]:
        errs.append(f"{name}: 순위 히스토그램 편차 {uni:.2f} > {LIM['uniform']} (순위화 안 된 파일?)")
    print(f"  {name}: seam {s:.2f} lowf {lf:.4f} patch {pm:.2f}/{ps:.2f} centroid {c:.3f}(기준 {ref:.3f}) uniform {uni:.2f} {kb:.0f}KB")
    return errs


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def gate(pub: Path = PUB, src: Path = SRC) -> list[str]:
    errs: list[str] = []
    idx_p = pub / "pack.json"
    if not idx_p.exists():
        return ["pack.json 없음"]
    files = json.loads(idx_p.read_text()).get("files", {})
    prov = json.loads((src / "PROVENANCE.json").read_text()).get("files", {}) if (src / "PROVENANCE.json").exists() else {}
    total = 0.0
    for kind, layers in files.items():
        if kind == "cotton":
            errs.append("cotton 팩 금지 — 수채 구름·가장자리 노이즈가 이 필드를 수십 배 늘려 쓴다")
        for layer, url in layers.items():
            name = url.rsplit("/", 1)[-1]
            p = pub / name
            if not p.exists():
                errs.append(f"{name}: 파일 없음")
                continue
            total += p.stat().st_size / 1024
            errs += check_tile(name, kind, layer, p)
            pr = prov.get(name)
            if not pr:
                errs.append(f"{name}: 출처 원장(PROVENANCE.json)에 없음")
                continue
            if pr.get("sha256") != sha(p):
                errs.append(f"{name}: 납품 파일 해시가 원장과 다름(가공 스크립트를 거치지 않은 수정)")
            sp = src / pr.get("source", "")
            if not sp.is_file() or pr.get("source_sha256") != sha(sp):
                errs.append(f"{name}: 원본 {pr.get('source')} 없음/해시 불일치")
            if not pr.get("license"):
                errs.append(f"{name}: 라이선스 미기재")
            if "firefly" in str(pr.get("origin", "")).lower():
                cc = pr.get("content_credentials")
                xmp = Image.open(p).info.get("XML:com.adobe.xmp") or ""
                if not cc:
                    errs.append(f"{name}: Firefly 원본인데 Content Credentials 참조가 원장에 없음(약관 §3.1)")
                elif cc not in xmp:
                    errs.append(f"{name}: 납품 파일에서 Content Credentials 참조가 빠졌다(약관 §3.1 — 제거·변조 금지)")
    # 납작붓 띠 텍스처(public/brush-tips/oil-ribbon.png) — 크기·출처·Content Credentials
    rp = pub.parent / "brush-tips" / "oil-ribbon.png"
    rprov_p = src / "PROVENANCE-ribbon.json"
    if rp.exists():
        r = Image.open(rp)
        if r.size != (2048, 256) or r.mode != "RGBA":
            errs.append(f"oil-ribbon.png: 2048×256 RGBA 여야 한다(ribbon.ts RIBBON) — {r.size} {r.mode}")
        if not rprov_p.exists():
            errs.append("oil-ribbon.png: PROVENANCE-ribbon.json 없음")
        else:
            rpv = json.loads(rprov_p.read_text())
            if rpv.get("sha256") != sha(rp):
                errs.append("oil-ribbon.png: 해시가 원장과 다름(process-ribbon.py 를 거치지 않은 수정)")
            rb = rp.with_name("oil-ribbon-bold.png")
            if not rb.exists() or rpv.get("bold_sha256") != sha(rb):
                errs.append("oil-ribbon-bold.png: 없음/해시가 원장과 다름")
            cc = rpv.get("content_credentials")
            if "firefly" in str(rpv.get("origin", "")).lower() and (not cc or cc not in (r.info.get("XML:com.adobe.xmp") or "")):
                errs.append("oil-ribbon.png: Firefly Content Credentials 참조 누락(약관 §3.1)")
            print(f"  oil-ribbon.png: {r.size} {rp.stat().st_size // 1024}KB 출처 {rpv.get('origin', '')[:30]}")
    # 캔버스 요철(public/textures/paper-linen-relief.png) — 회색 256 타일·원장 해시·Content Credentials
    lp = pub / "paper-linen-relief.png"
    lprov_p = src / "PROVENANCE-relief.json"
    if lp.exists():
        li = Image.open(lp)
        if li.size != (256, 256) or li.mode != "L":
            errs.append(f"paper-linen-relief.png: 256×256 L 이어야 한다(process-relief.py) — {li.size} {li.mode}")
        if not lprov_p.exists():
            errs.append("paper-linen-relief.png: PROVENANCE-relief.json 없음")
        else:
            lpv = json.loads(lprov_p.read_text())
            if lpv.get("sha256") != sha(lp):
                errs.append("paper-linen-relief.png: 해시가 원장과 다름(process-relief.py 를 거치지 않은 수정)")
            cc = lpv.get("content_credentials")
            if not cc or cc not in (li.info.get("XML:com.adobe.xmp") or ""):
                errs.append("paper-linen-relief.png: Firefly Content Credentials 참조 누락(약관 §3.1)")
        print(f"  paper-linen-relief.png: {li.size} {lp.stat().st_size // 1024}KB")
    # 물감 높이 타일(public/brush-tips/paint-height.png, ?relief=ff 비교 실험) — 원장 해시·Content Credentials
    hp = pub.parent / "brush-tips" / "paint-height.png"
    hprov_p = src / "PROVENANCE-paint-height.json"
    if hp.exists():
        hi = Image.open(hp)
        if hi.size != (512, 256) or hi.mode != "L":
            errs.append(f"paint-height.png: 512×256 L 이어야 한다 — {hi.size} {hi.mode}")
        if not hprov_p.exists():
            errs.append("paint-height.png: PROVENANCE-paint-height.json 없음")
        else:
            hpv = json.loads(hprov_p.read_text())
            if hpv.get("sha256") != sha(hp):
                errs.append("paint-height.png: 해시가 원장과 다름(process-paint-height.py 를 거치지 않은 수정)")
            cc = hpv.get("content_credentials")
            if not cc or cc not in (hi.info.get("XML:com.adobe.xmp") or ""):
                errs.append("paint-height.png: Firefly Content Credentials 참조 누락(약관 §3.1)")
        print(f"  paint-height.png: {hi.size} {hp.stat().st_size // 1024}KB")
    if total > LIM["total_kb"]:
        errs.append(f"합계 {total:.0f}KB > {LIM['total_kb']}KB")
    return errs


def selftest() -> int:
    """게이트가 «통과해도 아무것도 증명 못 하는» 지표가 아님을 보인다 — 나쁜 타일마다 FAIL 해야 한다."""
    rng = np.random.default_rng(1)
    good = np.asarray(Image.open(PUB / "paper-smooth-grain.png")).astype(np.float64)

    def rank8(t):
        r = np.argsort(np.argsort(t.ravel())).reshape(t.shape)
        return np.clip(r * 256 // r.size, 0, 255).astype(np.uint8)

    yy, xx = np.mgrid[:256, :256]
    # 실제 이음매 = 원본 사진을 이음매 처리 없이 잘라 쓴 타일(내부는 연속, wrap 경계만 끊김)
    src = -np.asarray(Image.open(SRC / "sources" / "ambientcg-Paper001-disp.png")).astype(np.float64)
    from texture_lib import resize_area
    raw = resize_area(src[:168, :168], 256)
    raw = raw - np.real(np.fft.ifft2(np.fft.fft2(raw) * (np.hypot(*np.meshgrid(np.fft.fftfreq(256) * 256, np.fft.fftfreq(256) * 256)) < 4)))
    # (라벨, 타일, 걸려야 할 이유 키워드)
    bad = [
        ("seam(이음매 처리 안 한 크롭)", rank8(raw), "이음매"),
        ("blob(덩어리 하나)", rank8(good + good.std() * 1.2 * np.exp(-((yy - 80) ** 2 + (xx - 90) ** 2) / (2 * 18**2))), "얼룩|덩어리"),
        ("lowf(조명 기울기)", rank8(good + 0.6 * good.std() * np.sin(2 * np.pi * xx / 256)), "얼룩"),
        ("scale(결이 너무 큼)", rank8(np.kron(good[:64, :64], np.ones((4, 4)))), "결 크기"),
        ("raw(순위화 안 함)", np.clip(good * 0.3 + 90, 0, 255).astype(np.uint8), "순위"),
    ]
    import re

    fails = 0
    with tempfile.TemporaryDirectory() as d:
        for label, arr, why in bad:
            p = Path(d) / "t.png"
            Image.fromarray(arr, mode="L").save(p)
            e = check_tile(label, "smooth", "grain", p)
            ok = any(re.search(why, x) for x in e)
            print(f"  {'✅ 의도한 이유로 FAIL' if ok else '❌ 못 잡음'} — {label} [{why}]: {e}")
            fails += 0 if ok else 1
        # 해시 변조
        tmp_pub = Path(d) / "pub"
        tmp_pub.mkdir()
        for f in PUB.iterdir():
            (tmp_pub / f.name).write_bytes(f.read_bytes())
        victim = tmp_pub / "paper-smooth-grain.png"
        a = np.asarray(Image.open(victim)).copy()
        a[0, 0] ^= 1
        Image.fromarray(a, mode="L").save(victim)
        e = [x for x in gate(tmp_pub, SRC) if "해시" in x]
        print(f"  {'✅ FAIL 잡음' if e else '❌ 통과해 버림'} — 해시 변조: {e[:1]}")
        fails += 0 if e else 1
        # Content Credentials 제거(메타데이터 없이 다시 저장)
        for f in PUB.iterdir():
            (tmp_pub / f.name).write_bytes(f.read_bytes())
        victim = tmp_pub / "paper-linen-grain.png"
        Image.fromarray(np.asarray(Image.open(victim)), mode="L").save(victim)
        e = [x for x in gate(tmp_pub, SRC) if "Content Credentials" in x]
        print(f"  {'✅ FAIL 잡음' if e else '❌ 통과해 버림'} — 출처 메타데이터 제거: {e[:1]}")
        fails += 0 if e else 1
    return 1 if fails else 0


def main() -> int:
    if "--selftest" in sys.argv:
        print("종이 결 게이트 자체 시험(나쁜 타일은 전부 FAIL 해야 한다)")
        return selftest()
    print("종이 결 팩 게이트")
    errs = gate()
    for e in errs:
        print("  ❌", e)
    print("  ✅ 통과" if not errs else f"  FAIL {len(errs)}건")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
