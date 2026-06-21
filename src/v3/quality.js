// Horizon V3 — quality tier skeleton (PR1)
// task-20260621-V3-PR1
//
// Auto / Low / Medium / High 画质档骨架。PR1 先做：
//   - 分辨率缩放（renderer.setPixelRatio 倍率）
//   - 占位开关（阴影/抗锯齿意图标记，供后续 PR 接管）
//   - Auto：按设备 devicePixelRatio + 简单帧率反馈估算档位
// 不做完整后处理，仅预留接口。

export const QUALITY_TIERS = {
  Low:    { pixelScale: 0.6,  shadows: false, antialias: false, label: '低' },
  Medium: { pixelScale: 0.85, shadows: true,  antialias: true,  label: '中' },
  High:   { pixelScale: 1.0,  shadows: true,  antialias: true,  label: '高' },
};

export class QualityManager {
  constructor(renderer) {
    this.renderer = renderer;
    this.mode = 'Auto';
    this.resolved = 'Medium';
    this._frameAcc = 0;
    this._frameN = 0;
    this._lastEval = 0;
  }

  set(mode) {
    this.mode = mode;
    if (mode === 'Auto') this.resolved = this._autoPick();
    else this.resolved = mode;
    this._apply();
    return this.resolved;
  }

  _autoPick() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    if (dpr <= 1 && w < 1280) return 'Low';
    if (dpr >= 2 || w >= 1920) return 'High';
    return 'Medium';
  }

  _apply() {
    const t = QUALITY_TIERS[this.resolved] || QUALITY_TIERS.Medium;
    if (this.renderer) {
      const base = Math.min(window.devicePixelRatio || 1, 2);
      this.renderer.setPixelRatio(base * t.pixelScale);
    }
    this.tier = t;
  }

  // 每帧喂入 dt（秒），Auto 模式下据帧率微调（PR1 仅降不升，留温和反馈）
  tick(dt) {
    if (this.mode !== 'Auto') return;
    this._frameAcc += dt; this._frameN++;
    const now = performance.now();
    if (now - this._lastEval < 2000) return;
    this._lastEval = now;
    if (this._frameN < 10) { this._frameAcc = 0; this._frameN = 0; return; }
    const avg = this._frameAcc / this._frameN;
    this._frameAcc = 0; this._frameN = 0;
    const fps = 1 / avg;
    if (fps < 30 && this.resolved !== 'Low') {
      this.resolved = this.resolved === 'High' ? 'Medium' : 'Low';
      this._apply();
    }
  }
}
