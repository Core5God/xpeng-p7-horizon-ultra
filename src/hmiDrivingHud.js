// ---------- HMI Driving HUD (Stage 3.2.1) ----------
// 电车座舱「环绕曲面屏 cockpit 信息带」：运行时注入结构 + CSS（不在 index.html 里硬堆 markup/样式）。
// 用 PR3.1 的 HMI design tokens（:root CSS 变量 --hmi-*），含 PR3.2.1 新增 band/text/glow token。
//
// 把原本散点漂浮的 左/中/右 信息整合进 一条贴底、低位、轻微环绕 的 cockpit display band：
//   · 左信息区（电车身份优先级 — 三行有层级）：
//       82%  BATTERY            ← 主行（次数字 + 标签，略突出）
//       CLTC 610 km             ← 主行
//       TRIP 10.0 km            ← 次级（小、灰、窄屏隐藏）
//   · 中状态位：极小指示圆点 + AUTOSTEER 标签 + 状态字 OFF（已移除原 .hmi-arc 静态假导航 SVG 弧线）
//   · 右信息区：时速大数字（主） + km/h（含弱化锁占位） + 档位 D/N/R 小 pill
//
// 视觉：min(88vw,1760px) × clamp(78px,7.2vw,132px) cockpit display band，
//   椭圆上沿（border-radius:40%/100%）做出中心略低、两端略上扬的轻微环绕感；
//   底层 radial(底部中心微蓝光) + linear(两端暗中央亮) + backdrop blur(18px) saturate(125%)
//   + 顶沿 hairline border-top + 柔和 box-shadow + 文字克制双层冷蓝 text-shadow。
// 配色：冷白/低饱和蓝白/少量青蓝光。避免高饱和蓝/纯白 glow/霓虹/红黄绿游戏色。
// 字号：主数字 clamp(28,3.2vw,72)、次数字 clamp(18,1.6vw,34)、标签 clamp(9,.72vw,14)，字距 .16em-.28em。
//
// 数据接入：updateHmiDrivingHud(speedKmh, distanceM, racePhase, gear) 现有签名继续更新里程/时速/档位。
//   speed 守护：NaN/负数/非数 → 0；停车显示 0。
//   电量续航本轮静态占位（DOM 写死，不接能耗逻辑）。AUTOSTEER 状态恒 OFF（按 F 不响应）。
//
// 不做 autosteer 真功能、不接物理、不接键、不动小地图算法、不做路线绘制、不动世界资产。

import { installHmiTokens } from './hmiTokens.js';

let installed = false;
let elDistNum = null;
let elSpeedNum = null;
let elGear = null;
let elAutoState = null;

const ROOT_ID = 'hmi-driving-hud';
const STYLE_ID = 'hmi-driving-hud-style';

const STYLE = `
  /* HMI 驾驶 cockpit 信息带 — 电车座舱质感：环绕曲面屏 + OLED 屏感克制发光（PR3.2.1）。
     全部驾驶态可见性由 body.drive 控制，4K 下走 tokens clamp() 自适应；窄屏隐藏次级 TRIP。 */
  #${ROOT_ID}{position:fixed;inset:0;z-index:11;pointer-events:none;
    font-family:var(--hmi-font);color:var(--hmi-text-bandPrimary);display:none}
  body.drive #${ROOT_ID}{display:block}

  /* 驾驶态把小地图上抬，避免与左区 Battery/Range 重叠（不改算法，仅位置/尺寸/透明度避让） */
  body.drive #minimap{
    bottom:calc(var(--hmi-glass-bandH) + var(--hmi-glass-bandBottom) + 12px) !important;
    left:22px !important;
    width:84px !important; height:84px !important;
    opacity:.34 !important;
    transition:opacity 300ms ease, transform 300ms ease !important;
  }
  body.drive #minimap:hover{opacity:.78 !important}

  /* —— cockpit display band 容器：贴底、低位、宽居中、椭圆上沿做轻微环绕 —— */
  #${ROOT_ID} .hmi-band{position:fixed;left:50%;
    bottom:var(--hmi-glass-bandBottom);
    width:var(--hmi-glass-bandW);
    height:var(--hmi-glass-bandH);
    transform:translateX(-50%);
    display:flex;align-items:center;justify-content:space-between;
    gap:clamp(16px,3vw,72px);
    padding:0 clamp(28px,4vw,96px);
    /* 底用 radial(底部中心微蓝光) + linear(两端暗中央亮)，营造中心略亮、自发光屏感 */
    background:
      radial-gradient(120% 90% at 50% 110%, var(--hmi-glass-bandGlow) 0%, rgba(0,0,0,0) 60%),
      linear-gradient(90deg,
        rgba(8,12,16,.04) 0%,
        var(--hmi-glass-bandBg) 22%,
        rgba(14,22,28,.32) 50%,
        var(--hmi-glass-bandBg) 78%,
        rgba(8,12,16,.04) 100%);
    border-top:1px solid var(--hmi-glass-bandBorder);
    /* 椭圆上沿：中心略低、两端略上扬的轻微环绕感 */
    border-radius:40% 40% 0 0 / 100% 100% 0 0;
    -webkit-backdrop-filter:blur(var(--hmi-glass-bandBlur)) saturate(var(--hmi-glass-bandSat));
    backdrop-filter:blur(var(--hmi-glass-bandBlur)) saturate(var(--hmi-glass-bandSat));
    box-shadow:
      0 -10px 48px var(--hmi-glass-bandGlow),
      0 -2px 24px rgba(0,0,0,.30),
      inset 0 1px 0 rgba(255,255,255,.04);
    overflow:hidden}
  /* 顶沿一条更亮的细高光 hairline（自发光屏上沿质感，弧形伪元素配合椭圆上沿） */
  #${ROOT_ID} .hmi-band::before{content:'';position:absolute;left:8%;right:8%;top:0;height:1px;
    background:linear-gradient(90deg,transparent 0%,var(--hmi-glass-bandEdge) 30%,
      rgba(220,240,255,.32) 50%,var(--hmi-glass-bandEdge) 70%,transparent 100%);
    border-radius:50%;pointer-events:none;
    box-shadow:0 0 6px var(--hmi-glass-bandEdge)}
  /* 底沿一条更弱的暗影线，强化"屏体"厚度 */
  #${ROOT_ID} .hmi-band::after{content:'';position:absolute;left:0;right:0;bottom:0;height:1px;
    background:linear-gradient(90deg,transparent,rgba(0,0,0,.30),transparent);pointer-events:none}

  /* —— 三组排版：左/中/右 嵌在同一条 band 内（flex space-between） —— */
  #${ROOT_ID} .hmi-grp{display:flex;flex-direction:column;position:relative}
  #${ROOT_ID} .hmi-left{align-items:flex-start;text-align:left;
    gap:clamp(2px,0.4vmin,6px);justify-content:center;flex:0 0 auto}
  #${ROOT_ID} .hmi-mid{align-items:center;text-align:center;justify-content:center;flex:1 1 auto}
  #${ROOT_ID} .hmi-right{align-items:flex-end;text-align:right;justify-content:center;
    flex:0 0 auto;gap:clamp(2px,0.4vmin,6px)}

  /* —— 标签：冷调次文字 + 大字距 —— */
  #${ROOT_ID} .hmi-label{font-size:var(--hmi-scale-bandLabel);font-weight:500;
    letter-spacing:.22em;text-transform:uppercase;color:var(--hmi-text-bandSecondary)}

  /* —— 左区：Battery / CLTC / TRIP 三行有优先级 —— */
  #${ROOT_ID} .hmi-row{display:inline-flex;align-items:baseline;gap:.55em;
    font-variant-numeric:tabular-nums;line-height:1.05}
  /* 主行：Battery / CLTC（次数字 = 略突出，主文字色） */
  #${ROOT_ID} .hmi-row-pri .v{font-size:var(--hmi-scale-bandNum2);font-weight:300;
    color:var(--hmi-text-bandPrimary);letter-spacing:.02em;
    text-shadow:var(--hmi-glow-bandText)}
  #${ROOT_ID} .hmi-row-pri .k,
  #${ROOT_ID} .hmi-row-pri .u{font-size:var(--hmi-scale-bandLabel);font-weight:500;
    letter-spacing:.22em;text-transform:uppercase;color:var(--hmi-text-bandSecondary)}
  /* 次行：TRIP 里程（更小、更次级，区分游戏计分板） */
  #${ROOT_ID} .hmi-row-sec{margin-top:clamp(2px,0.3vmin,5px)}
  #${ROOT_ID} .hmi-row-sec .k{font-size:calc(var(--hmi-scale-bandLabel) * 0.95);font-weight:500;
    letter-spacing:.28em;text-transform:uppercase;color:var(--hmi-text-bandSecondary);opacity:.78}
  #${ROOT_ID} .hmi-row-sec .v{font-size:calc(var(--hmi-scale-bandNum2) * 0.78);font-weight:300;
    color:var(--hmi-text-bandSecondary);letter-spacing:.02em;
    text-shadow:var(--hmi-glow-bandTextSoft)}
  #${ROOT_ID} .hmi-row-sec .u{font-size:calc(var(--hmi-scale-bandLabel) * 0.9);font-weight:500;
    letter-spacing:.22em;text-transform:uppercase;color:var(--hmi-text-bandSecondary);opacity:.7}

  /* —— 中区：极小指示点 + AUTOSTEER 标签 + 状态字 OFF（已删除原 .hmi-arc 静态假导航 SVG 弧线） —— */
  #${ROOT_ID} .hmi-mid .hmi-label{letter-spacing:.32em}
  #${ROOT_ID} .hmi-auto-row{display:inline-flex;align-items:center;gap:.7em}
  #${ROOT_ID} .hmi-auto-dot{width:5px;height:5px;border-radius:50%;
    background:var(--hmi-text-bandSecondary);
    box-shadow:0 0 5px rgba(170,220,255,.22)}
  #${ROOT_ID} .hmi-auto-state{font-size:var(--hmi-scale-bandLabel);font-weight:600;
    letter-spacing:.32em;text-transform:uppercase;color:var(--hmi-text-bandSecondary);
    margin-top:clamp(3px,0.4vmin,6px);transition:color var(--hmi-motion-normal);
    text-shadow:var(--hmi-glow-bandTextSoft)}

  /* —— 右区：时速主体（最大元素）+ km/h 标签（含弱化锁占位）+ 档位 D/N/R 小 pill —— */
  #${ROOT_ID} .hmi-speed-num{font-size:var(--hmi-scale-bandNum);font-weight:200;line-height:.95;
    color:var(--hmi-text-bandPrimary);font-variant-numeric:tabular-nums;letter-spacing:.005em;
    text-shadow:var(--hmi-glow-bandText)}
  #${ROOT_ID} .hmi-right .hmi-meta{display:inline-flex;align-items:center;gap:.55em;
    margin-top:clamp(2px,0.3vmin,5px)}
  #${ROOT_ID} .hmi-right .hmi-label{display:inline-flex;align-items:center;gap:.5em;letter-spacing:.18em}
  /* 锁图标：弱化、不抢时速 */
  #${ROOT_ID} .hmi-lock{color:var(--hmi-text-bandSecondary);opacity:.42;flex:0 0 auto}
  /* 档位小 pill */
  #${ROOT_ID} .hmi-gear{display:inline-flex;align-items:center;justify-content:center;
    min-width:1.65em;padding:.18em .5em;
    font-size:calc(var(--hmi-scale-bandLabel) * 1.05);font-weight:600;
    letter-spacing:.22em;text-transform:uppercase;color:var(--hmi-text-bandPrimary);
    font-variant-numeric:tabular-nums;
    background:rgba(20,30,38,.40);
    border:1px solid var(--hmi-glass-bandEdge);border-radius:999px;
    box-shadow:inset 0 0 8px rgba(120,180,255,.08),0 0 6px var(--hmi-glass-bandGlow);
    text-shadow:var(--hmi-glow-bandTextSoft)}

  /* —— 响应式兜底：窄屏（≤640px）band 收 94vw、隐藏次级 TRIP、不堆一起 —— */
  @media (max-width: 640px){
    #${ROOT_ID} .hmi-band{width:94vw;gap:clamp(8px,2vw,18px);padding:0 clamp(14px,3vw,28px)}
    #${ROOT_ID} .hmi-row-sec{display:none}
  }
`;

const MARKUP = `
  <div class="hmi-band">
    <div class="hmi-grp hmi-left">
      <div class="hmi-row hmi-row-pri"><span class="v">82%</span><span class="k">Battery</span></div>
      <div class="hmi-row hmi-row-pri"><span class="k">CLTC</span><span class="v">610</span><span class="u">km</span></div>
      <div class="hmi-row hmi-row-sec"><span class="k">Trip</span><span class="v" id="hmiDistNum">0.0</span><span class="u">km</span></div>
    </div>
    <div class="hmi-grp hmi-mid">
      <div class="hmi-auto-row">
        <span class="hmi-auto-dot"></span>
        <span class="hmi-label">Autosteer</span>
      </div>
      <div class="hmi-auto-state" id="hmiAutoState">OFF</div>
    </div>
    <div class="hmi-grp hmi-right">
      <div class="hmi-speed-num" id="hmiSpeedNum">0</div>
      <div class="hmi-meta">
        <span class="hmi-label">km/h<svg class="hmi-lock" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M4.4 7V5.2a3.6 3.6 0 0 1 7.2 0V7" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="3.3" y="7" width="9.4" height="6.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></span>
        <span class="hmi-gear" id="hmiGear">N</span>
      </div>
    </div>
  </div>
`;

export function installHmiDrivingHud() {
  if (installed) return;
  if (typeof document === 'undefined') return;
  installed = true;

  installHmiTokens(); // 确保 :root --hmi-* 变量就位（含 PR3.2.1 band/text/glow token）

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

// 每帧调用：speedKmh 时速(km/h)、distanceM 里程(米)、racePhase 竞速阶段(占位预留)、gear 档位(D/N/R)。
// speed 守护：停车显示 0，禁止 NaN/负数/非数。
// 电量/续航本轮静态占位（DOM 写死，不接能耗逻辑）。AUTOSTEER 状态恒 OFF（按 F 不响应）。
export function updateHmiDrivingHud(speedKmh = 0, distanceM = 0, racePhase = 'free', gear = 'N') {
  if (!installed) return;
  // 距离：NaN/负数 → 0
  const dRaw = Number(distanceM);
  const dKm = (Number.isFinite(dRaw) && dRaw > 0 ? dRaw : 0) / 1000;
  if (elDistNum) elDistNum.textContent = dKm.toFixed(1);
  // 时速：NaN/负数/非数 → 0；停车显示 0
  let s = Number(speedKmh);
  if (!Number.isFinite(s) || s < 0) s = 0;
  if (elSpeedNum) elSpeedNum.textContent = String(Math.round(s));
  // 档位：由调用处算好传入（D/N/R），与 main.js 同口径
  if (elGear) elGear.textContent = gear || 'N';
  // 状态位占位：本轮恒 OFF（不接物理/键/逻辑）。racePhase 参数预留给后续阶段。
  if (elAutoState && elAutoState.textContent !== 'OFF') elAutoState.textContent = 'OFF';
}
