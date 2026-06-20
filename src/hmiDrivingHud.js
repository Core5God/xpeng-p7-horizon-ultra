// ---------- HMI Driving HUD (Stage 3.2) ----------
// Slow Roads 式驾驶态 HUD：运行时注入结构 + CSS（不在 index.html 里硬堆 markup/样式）。
// 用 PR3.1 的 HMI design tokens（:root CSS 变量 --hmi-*）。
//   · 左下角：大数字 里程 + 小字 KILOMETERS
//   · 底部中心：弧形 Road Preview 发光占位 + 下方小字 AUTOSTEER + 状态字（本轮恒 OFF 占位）
//   · 右下角：大数字 时速 + 小字 KILOMETERS PER HOUR + 置灰锁图标（限速/锁速占位，不接逻辑）
// 数据接入：迁移自原 index.html 内联 srhud（#srDist/#srSpeed/#srAuto）。
// 本模块负责 注入 DOM + 每帧 update(speedKmh, distanceM, racePhase)。
// 不做 autosteer 真功能、不接物理、不接键、不动小地图、不动世界资产。

import { installHmiTokens } from './hmiTokens.js';

let installed = false;
let elDistNum = null;
let elSpeedNum = null;
let elAutoState = null;

const ROOT_ID = 'hmi-driving-hud';
const STYLE_ID = 'hmi-driving-hud-style';

const STYLE = `
  /* HMI 驾驶 HUD — slowroads 安静极简：大写大字距、超轻字体、细线、靠位置层级。
     全部驾驶态可见性由 body.drive 控制，4K 下走 tokens clamp() 自适应。 */
  #${ROOT_ID}{position:fixed;inset:0;z-index:11;pointer-events:none;
    font-family:var(--hmi-font);color:var(--hmi-text-primary);display:none}
  body.drive #${ROOT_ID}{display:block}

  #${ROOT_ID} .hmi-slot{position:fixed;display:flex;flex-direction:column;
    text-shadow:0 2px 18px rgba(0,0,0,.5)}
  #${ROOT_ID} .hmi-num{font-size:calc(var(--hmi-scale-speed) * 0.62);font-weight:200;line-height:1;
    color:var(--hmi-text-primary);font-variant-numeric:tabular-nums;letter-spacing:.01em}
  #${ROOT_ID} .hmi-label{font-size:var(--hmi-scale-label);font-weight:500;
    letter-spacing:.22em;text-transform:uppercase;color:var(--hmi-text-secondary);
    margin-top:clamp(5px,0.6vmin,11px)}

  /* 左下：里程 */
  #${ROOT_ID} .hmi-dist{bottom:clamp(26px,3.2vmin,64px);left:clamp(150px,12vmin,260px);
    align-items:flex-start;text-align:left}

  /* 右下：时速 + 锁图标占位 */
  #${ROOT_ID} .hmi-speed{bottom:clamp(26px,3.2vmin,64px);right:clamp(40px,4vmin,90px);
    align-items:flex-end;text-align:right}
  #${ROOT_ID} .hmi-speed .hmi-label{display:inline-flex;align-items:center;justify-content:flex-end;gap:.6em}
  #${ROOT_ID} .hmi-lock{color:var(--hmi-text-tertiary);flex:0 0 auto}

  /* 底部居中：弧形 Road Preview 占位 + AUTOSTEER 状态位 */
  #${ROOT_ID} .hmi-auto{bottom:clamp(20px,2.4vmin,52px);left:50%;transform:translateX(-50%);
    align-items:center;text-align:center}
  #${ROOT_ID} .hmi-arc{filter:drop-shadow(0 0 10px rgba(255,255,255,.34));opacity:.92}
  #${ROOT_ID} .hmi-auto .hmi-label{letter-spacing:.28em;color:var(--hmi-text-secondary)}
  #${ROOT_ID} .hmi-auto-state{font-size:var(--hmi-scale-label);font-weight:600;
    letter-spacing:.3em;text-transform:uppercase;color:var(--hmi-text-tertiary);
    margin-top:clamp(2px,0.3vmin,6px);transition:color var(--hmi-motion-normal)}
`;

const MARKUP = `
  <div class="hmi-slot hmi-dist">
    <div class="hmi-num" id="hmiDistNum">0.0</div>
    <div class="hmi-label">KILOMETERS</div>
  </div>
  <div class="hmi-slot hmi-speed">
    <div class="hmi-num" id="hmiSpeedNum">0</div>
    <div class="hmi-label">KILOMETERS PER HOUR<svg class="hmi-lock" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4.4 7V5.2a3.6 3.6 0 0 1 7.2 0V7" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="3.3" y="7" width="9.4" height="6.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></div>
  </div>
  <div class="hmi-slot hmi-auto">
    <svg class="hmi-arc" viewBox="0 0 40 64" width="38" height="60" aria-hidden="true"><path d="M20 56 C20 40 14 34 22 18 C25 12 24 9 22 7" fill="none" stroke="url(#hmiArcG)" stroke-width="2.6" stroke-linecap="round"/><circle cx="20" cy="57" r="2.6" fill="#fff"/><defs><linearGradient id="hmiArcG" x1="0" y1="64" x2="0" y2="0"><stop offset="0" stop-color="rgba(255,255,255,.95)"/><stop offset="1" stop-color="rgba(255,255,255,.15)"/></linearGradient></defs></svg>
    <div class="hmi-label">AUTOSTEER</div>
    <div class="hmi-auto-state" id="hmiAutoState">OFF</div>
  </div>
`;

export function installHmiDrivingHud() {
  if (installed) return;
  if (typeof document === 'undefined') return;
  installed = true;

  installHmiTokens(); // 确保 :root --hmi-* 变量就位

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = MARKUP;
  document.body.appendChild(root);

  elDistNum = root.querySelector('#hmiDistNum');
  elSpeedNum = root.querySelector('#hmiSpeedNum');
  elAutoState = root.querySelector('#hmiAutoState');
}

// 每帧调用：speedKmh 时速(km/h)、distanceM 里程(米)、racePhase 当前竞速阶段(占位预留)。
// 本轮 autosteer 状态恒为 OFF 占位，不做真功能。
export function updateHmiDrivingHud(speedKmh = 0, distanceM = 0, racePhase = 'free') {
  if (!installed) return;
  if (elDistNum) elDistNum.textContent = ((distanceM || 0) / 1000).toFixed(1);
  if (elSpeedNum) elSpeedNum.textContent = Math.round(speedKmh || 0);
  // 状态位占位：本轮恒 OFF（不接物理/键/逻辑）。racePhase 参数预留给后续阶段。
  if (elAutoState && elAutoState.textContent !== 'OFF') elAutoState.textContent = 'OFF';
}
