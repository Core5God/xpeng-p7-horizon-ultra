// ---------- HMI Driving HUD (Stage 3.2.1) ----------
// 电车座舱「环绕曲面屏 cockpit 信息带」：运行时注入结构 + CSS（不在 index.html 里硬堆 markup/样式）。
// 用 PR3.1 的 HMI design tokens（:root CSS 变量 --hmi-*），含 PR3.2.1 新增 glass band token。
//   把原本散点漂浮的 左/中/右 信息整合进 一条横向、贴底、低位、轻微弧面 的 cockpit 信息带：
//   · 左信息区：电量(SOC) + 续航(CLTC) 占位 + 里程(大数字 + KILOMETERS)
//   · 中状态位：AUTOSTEER 标签 + 状态字（本轮恒 OFF 占位；已移除原中部静态假导航 SVG 弧线）
//   · 右信息区：时速(大数字 + KILOMETERS PER HOUR + 锁占位) + 档位(D/N/R)
// 视觉：深灰半透明玻璃底 + backdrop blur + 顶沿细高光 hairline + 上沿大圆角 + 极轻 perspective 弧面，
//   夜间像一块自发光 OLED 屏，但克制不过曝；数字带极轻科技蓝/青白调微光。
// 数据接入：updateHmiDrivingHud(speedKmh, distanceM, racePhase, gear) 现有签名继续更新里程/时速/档位。
//   电量续航本轮静态占位（DOM 写死，不接真实能耗逻辑）。AUTOSTEER 状态恒 OFF。
// 不做 autosteer 真功能、不接物理、不接键、不动小地图、不做路线绘制、不动世界资产。

import { installHmiTokens } from './hmiTokens.js';

let installed = false;
let elDistNum = null;
let elSpeedNum = null;
let elGear = null;
let elAutoState = null;

const ROOT_ID = 'hmi-driving-hud';
const STYLE_ID = 'hmi-driving-hud-style';

const STYLE = `
  /* HMI 驾驶 cockpit 信息带 — 电车座舱质感：环绕曲面屏 + OLED 屏感克制发光。
     全部驾驶态可见性由 body.drive 控制，4K 下走 tokens clamp() 自适应。 */
  #${ROOT_ID}{position:fixed;inset:0;z-index:11;pointer-events:none;
    font-family:var(--hmi-font);color:var(--hmi-text-primary);display:none}
  body.drive #${ROOT_ID}{display:block}

  /* —— cockpit 信息带容器：贴底、低位、宽居中、轻微弧面 —— */
  #${ROOT_ID} .hmi-band{position:fixed;left:50%;bottom:0;
    width:min(1400px,92vw);
    transform:translateX(-50%) perspective(1400px) rotateX(2.6deg);
    transform-origin:50% 100%;
    display:flex;align-items:flex-end;justify-content:space-between;
    gap:clamp(16px,3vw,64px);
    padding:clamp(16px,2vmin,30px) clamp(28px,4vw,72px) clamp(14px,1.6vmin,26px);
    background:linear-gradient(180deg,
      rgba(20,26,34,.10) 0%,
      var(--hmi-glass-bandBg) 34%,
      var(--hmi-glass-bandBg) 100%);
    border:1px solid var(--hmi-glass-bandBorder);
    border-bottom:none;
    border-radius:var(--hmi-glass-bandRadius) var(--hmi-glass-bandRadius) 0 0;
    -webkit-backdrop-filter:blur(var(--hmi-glass-bandBlur));
    backdrop-filter:blur(var(--hmi-glass-bandBlur));
    box-shadow:0 -14px 60px var(--hmi-glass-bandGlow),
      0 -2px 30px rgba(0,0,0,.34),
      inset 0 1px 0 rgba(255,255,255,.05)}
  /* 顶沿一条细高光 hairline（自发光屏上沿质感） */
  #${ROOT_ID} .hmi-band::before{content:'';position:absolute;left:6%;right:6%;top:0;height:1px;
    background:linear-gradient(90deg,transparent,var(--hmi-glass-bandHairline),transparent);
    border-radius:2px;pointer-events:none;
    box-shadow:0 0 8px var(--hmi-glass-bandHairline)}

  /* —— 三组排版：左/中/右 嵌在同一块曲面屏结构 —— */
  #${ROOT_ID} .hmi-grp{display:flex;flex-direction:column;
    text-shadow:0 1px 14px rgba(0,0,0,.42)}
  #${ROOT_ID} .hmi-left{align-items:flex-start;text-align:left;gap:clamp(6px,0.9vmin,14px)}
  #${ROOT_ID} .hmi-mid{align-items:center;text-align:center;align-self:flex-end;
    padding-bottom:clamp(2px,0.4vmin,6px)}
  #${ROOT_ID} .hmi-right{align-items:flex-end;text-align:right}

  /* 大数字 + 标签 公共样式 */
  #${ROOT_ID} .hmi-num{font-size:calc(var(--hmi-scale-speed) * 0.56);font-weight:200;line-height:1;
    color:var(--hmi-text-primary);font-variant-numeric:tabular-nums;letter-spacing:.01em;
    text-shadow:0 0 16px var(--hmi-glass-bandGlow),0 1px 14px rgba(0,0,0,.42)}
  #${ROOT_ID} .hmi-label{font-size:var(--hmi-scale-label);font-weight:500;
    letter-spacing:.22em;text-transform:uppercase;color:var(--hmi-text-secondary);
    margin-top:clamp(4px,0.5vmin,9px)}

  /* 左侧：电量 / 续航 占位（次级灰、大写、大字距，克制） */
  #${ROOT_ID} .hmi-batt{display:flex;flex-direction:column;gap:clamp(3px,0.4vmin,6px);
    margin-bottom:clamp(2px,0.3vmin,5px)}
  #${ROOT_ID} .hmi-stat{font-size:var(--hmi-scale-small);font-weight:500;
    letter-spacing:.2em;text-transform:uppercase;color:var(--hmi-text-secondary);
    font-variant-numeric:tabular-nums;display:inline-flex;align-items:baseline;gap:.5em}
  #${ROOT_ID} .hmi-stat .v{color:var(--hmi-glass-accent);font-weight:600;letter-spacing:.04em;
    text-shadow:0 0 10px var(--hmi-glass-bandGlow)}
  #${ROOT_ID} .hmi-stat .u{color:var(--hmi-text-tertiary);font-size:.88em}

  /* 右侧：时速标签内联锁图标 + 档位 */
  #${ROOT_ID} .hmi-right .hmi-label{display:inline-flex;align-items:center;justify-content:flex-end;gap:.6em}
  #${ROOT_ID} .hmi-lock{color:var(--hmi-text-tertiary);flex:0 0 auto}
  #${ROOT_ID} .hmi-gear{font-size:var(--hmi-scale-small);font-weight:500;
    letter-spacing:.32em;text-transform:uppercase;color:var(--hmi-text-secondary);
    font-variant-numeric:tabular-nums;margin-top:clamp(3px,0.4vmin,7px)}

  /* 中部状态位：仅 AUTOSTEER 标签 + 状态字（已移除原静态假导航 SVG 弧线） */
  #${ROOT_ID} .hmi-mid .hmi-label{letter-spacing:.28em;color:var(--hmi-text-secondary);margin-top:0}
  #${ROOT_ID} .hmi-auto-state{font-size:var(--hmi-scale-label);font-weight:600;
    letter-spacing:.3em;text-transform:uppercase;color:var(--hmi-text-tertiary);
    margin-top:clamp(3px,0.4vmin,7px);transition:color var(--hmi-motion-normal)}
  /* 状态字上方一颗极小指示点（克制屏感，无路线绘制） */
  #${ROOT_ID} .hmi-auto-dot{width:5px;height:5px;border-radius:50%;
    background:var(--hmi-text-tertiary);margin-bottom:clamp(6px,0.9vmin,12px);
    box-shadow:0 0 6px rgba(255,255,255,.18)}
`;

const MARKUP = `
  <div class="hmi-band">
    <div class="hmi-grp hmi-left">
      <div class="hmi-batt">
        <div class="hmi-stat"><span class="v">82%</span> BATTERY</div>
        <div class="hmi-stat">CLTC <span class="v">610</span> <span class="u">KM</span></div>
      </div>
      <div class="hmi-num" id="hmiDistNum">0.0</div>
      <div class="hmi-label">KILOMETERS</div>
    </div>
    <div class="hmi-grp hmi-mid">
      <div class="hmi-auto-dot"></div>
      <div class="hmi-label">AUTOSTEER</div>
      <div class="hmi-auto-state" id="hmiAutoState">OFF</div>
    </div>
    <div class="hmi-grp hmi-right">
      <div class="hmi-num" id="hmiSpeedNum">0</div>
      <div class="hmi-label">KILOMETERS PER HOUR<svg class="hmi-lock" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4.4 7V5.2a3.6 3.6 0 0 1 7.2 0V7" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="3.3" y="7" width="9.4" height="6.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></div>
      <div class="hmi-gear" id="hmiGear">N</div>
    </div>
  </div>
`;

export function installHmiDrivingHud() {
  if (installed) return;
  if (typeof document === 'undefined') return;
  installed = true;

  installHmiTokens(); // 确保 :root --hmi-* 变量就位（含 PR3.2.1 glass band token）

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
  elGear = root.querySelector('#hmiGear');
  elAutoState = root.querySelector('#hmiAutoState');
}

// 每帧调用：speedKmh 时速(km/h)、distanceM 里程(米)、racePhase 竞速阶段(占位预留)、
//   gear 档位字符串(D/N/R，由调用处依据 state.speed 符号算好传入)。
// 电量/续航本轮静态占位（DOM 写死，不入参、不接能耗逻辑）。autosteer 状态恒为 OFF 占位。
export function updateHmiDrivingHud(speedKmh = 0, distanceM = 0, racePhase = 'free', gear = 'N') {
  if (!installed) return;
  if (elDistNum) elDistNum.textContent = ((distanceM || 0) / 1000).toFixed(1);
  if (elSpeedNum) elSpeedNum.textContent = Math.round(speedKmh || 0);
  // 档位：由调用处算好传入（D/N/R），与 main.js elGear 同口径。
  if (elGear) elGear.textContent = gear || 'N';
  // 状态位占位：本轮恒 OFF（不接物理/键/逻辑）。racePhase 参数预留给后续阶段。
  if (elAutoState && elAutoState.textContent !== 'OFF') elAutoState.textContent = 'OFF';
}
