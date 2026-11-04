/*
 * 모래 소리 — 녹음 파일 없이 걸러 낸 잡음 하나로. 손이 빠를수록 커지고, 멈추면 잦아든다.
 *   붓기 = 높고 가는 «사르르» · 손가락 = 가운데 «사각» · 손바닥 = 낮고 넓은 «쓰윽»
 * 교실에서 스물다섯 대가 같이 울리므로 크게 만들지 않는다(최대 0.18).
 */
import type { SandTool } from "./SandSim";

const TONE: Record<SandTool, { f: number; q: number; base: number; k: number }> = {
  pour: { f: 5200, q: 0.8, base: 0.07, k: 0 },
  finger: { f: 2600, q: 1.1, base: 0, k: 0.22 },
  palm: { f: 1100, q: 0.7, base: 0, k: 0.12 },
};

export class SandAudio {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  enabled = true;

  /** 첫 손대기에서 부른다(자동재생 막힘 풀기) */
  unlock(): void {
    if (!this.enabled) return;
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!AC) return;
    try {
      const ctx = new AC();
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      // 낱알 소리: 흰 잡음에 드문드문 작은 «톡»을 섞는다
      let s = 12345;
      for (let i = 0; i < len; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const r = s / 0x7fffffff;
        ch[i] = (r * 2 - 1) * (r > 0.985 ? 1 : 0.45);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2600;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();
      this.ctx = ctx;
      this.gain = gain;
      this.filter = filter;
    } catch {
      this.ctx = null;
    }
  }

  /** tool=null 이면 조용히. speed = 칸/ms */
  set(tool: SandTool | null, speed: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.gain || !this.filter) return;
    const t = ctx.currentTime;
    if (!tool || !this.enabled) {
      this.gain.gain.setTargetAtTime(0, t, 0.06);
      return;
    }
    const tone = TONE[tool];
    this.filter.frequency.setTargetAtTime(tone.f * (0.85 + Math.min(0.4, speed * 0.3)), t, 0.05);
    this.filter.Q.setTargetAtTime(tone.q, t, 0.05);
    const v = Math.min(0.18, tone.base + tone.k * Math.min(1, speed));
    this.gain.gain.setTargetAtTime(v, t, 0.04);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.set(null, 0);
  }

  dispose(): void {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
