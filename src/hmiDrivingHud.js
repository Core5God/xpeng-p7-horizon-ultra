// ---------- HMI Driving HUD (HMI Recovery 20260620) ----------
// 拆掉整块厚重黑底栏，改成「左/中/右 三个独立信息岛 + 一条贴底细弧光」。
//   - 无整块深色容器；底部 UI 总高 ≤ 12vh；信息岛极淡薄玻璃或无底。
//   - 唯一「屏感」载体 = 一条贴底蓝白曲面弧光（中心略下沉、两端略上扬）。
//   - 左：电车能量模块（82% / BATTERY / 分段能量条 / 610 CLTC KM）。
//   - 中：路面带导航预览（两条路缘线向前收窄 + 车位点）+ AUTOSTEER OFF。
//   - 右：时速 + 档位 pill，减重但完整可读。
//   只改 UI/HMI；不接 autosteer 真功能；电量/续航静态占位。
import { installHmiTokens } from './hmiTokens.js';
let installed = false;
let elSpeedNum = null, elGear = null, elAutoState = null;
let elRouteCanvas = null, routeCtx = null, routeDpr = 1, routeW = 0, routeH = 0;
const ROOT_ID = 'hmi-driving-hud';
const STYLE_ID = 'hmi-driving-hud-style';
const ROUTE_FORWARD_M = 110;   // 前方可视距离（米）
let ROUTE_HALF_W_M = 6.2;      // 路面半宽（米），由 main.js 传入 HALF_W 覆盖

const STYLE = `
  #${ROOT_ID}{position:fixed;inset:0;z-index:11;pointer-events:none;
    font-family:var(--hmi-font);color:var(--hmi-text-primary);display:none}
  body.drive #${ROOT_ID}{display:block}

  /* 底部 UI 容器：纯定位层，无任何背景/阴影。总高度 ≤ 12vh。 */
  #${ROOT_ID} .hmi-dock{position:fixed;left:0;right:0;bottom:0;
    height:min(12vh,132px);min-height:84px;
    display:flex;align-items:flex-end;justify-content:space-between;
    padding:0 clamp(20px,3.4vw,60px) clamp(14px,1.8vh,26px);
    box-sizing:border-box}

  /* 贴底曲面弧光：唯一的「屏感」载体。SVG 占满 dock 宽度，贴最底。 */
  #${ROOT_ID} .hmi-arc{position:fixed;left:0;right:0;bottom:0;
    width:100%;height:min(12vh,132px);pointer-events:none;
    overflow:visible}
  #${ROOT_ID} .hmi-arc svg{display:block;width:100%;height:100%}

  /* 信息岛通用：极淡薄玻璃（≤0.12），两侧自然存在感，不抢画面。 */
  #${ROOT_ID} .hmi-island{position:relative;display:flex;flex-direction:column;
    padding:clamp(6px,0.8vh,12px) clamp(12px,1.2vw,22px);
    border-radius:18px;
    text-shadow:0 1px 10px rgba(0,0,0,.42)}
  #${ROOT_ID} .hmi-island.glass{
    background:var(--hmi-glass-islandBg);
    -webkit-backdrop-filter:blur(var(--hmi-glass-islandBlur)) saturate(112%);
    backdrop-filter:blur(var(--hmi-glass-islandBlur)) saturate(112%);
    border:1px solid var(--hmi-glass-islandBorder);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
  #${ROOT_ID} .hmi-left{align-items:flex-start;text-align:left;flex:0 0 auto;min-width:0;white-space:nowrap}
  #${ROOT_ID} .hmi-mid{align-items:center;text-align:center;flex:1 1 auto;min-width:0;
    max-width:min(38vw,460px);margin:0 clamp(10px,2vw,40px)}
  #${ROOT_ID} .hmi-right{align-items:flex-end;text-align:right;flex:0 0 auto;min-width:0;white-space:nowrap}
  #${ROOT_ID} .hmi-label{font-size:var(--hmi-scale-labelTiny);font-weight:500;letter-spacing:.24em;
    text-transform:uppercase;color:var(--hmi-text-secondary);line-height:1.1}
  #${ROOT_ID} .hmi-label.dim{color:var(--hmi-text-tertiary);letter-spacing:.28em}

  /* 左：Energy 能量模块（电车身份） */
  #${ROOT_ID} .hmi-energy{display:flex;flex-direction:column;align-items:flex-start;gap:clamp(3px,0.5vh,7px)}
  #${ROOT_ID} .hmi-soc{display:inline-flex;align-items:baseline;gap:.16em;
    font-size:var(--hmi-scale-socNum);font-weight:200;line-height:.95;color:var(--hmi-text-primary);
    font-variant-numeric:tabular-nums;letter-spacing:.005em;
    text-shadow:0 0 14px var(--hmi-glass-arcGlow),0 1px 12px rgba(0,0,0,.42)}
  #${ROOT_ID} .hmi-soc .pct{font-size:.42em;color:var(--hmi-text-secondary);font-weight:300;letter-spacing:.05em;margin-left:.04em}
  /* 分段能量条：若干小格，按 SOC 点亮，像车机能量状态 */
  #${ROOT_ID} .hmi-segs{display:flex;align-items:center;gap:clamp(2px,0.3vw,4px);margin:clamp(1px,0.2vh,3px) 0}
  #${ROOT_ID} .hmi-seg{width:clamp(9px,0.9vw,16px);height:clamp(5px,0.55vh,9px);border-radius:2px;
    background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)}
  #${ROOT_ID} .hmi-seg.on{background:linear-gradient(180deg,rgba(196,230,255,.95),var(--hmi-glass-accent));
    box-shadow:0 0 7px var(--hmi-glass-arcGlow),inset 0 0 0 1px rgba(220,240,255,.30)}
  #${ROOT_ID} .hmi-seg.low.on{background:linear-gradient(180deg,rgba(255,210,170,.95),rgba(255,170,120,.9));
    box-shadow:0 0 7px rgba(255,170,120,.35)}
  #${ROOT_ID} .hmi-range{display:inline-flex;align-items:baseline;gap:.30em;
    font-size:var(--hmi-scale-rangeNum);font-weight:300;line-height:1;
    color:var(--hmi-glass-accent);font-variant-numeric:tabular-nums;letter-spacing:.01em}
  #${ROOT_ID} .hmi-range .tag{font-size:.5em;color:var(--hmi-text-tertiary);font-weight:600;letter-spacing:.24em;text-transform:uppercase}
  #${ROOT_ID} .hmi-range .u{font-size:.5em;color:var(--hmi-text-tertiary);font-weight:600;letter-spacing:.2em;text-transform:uppercase}

  /* 中：路面带导航预览 + AUTOSTEER */
  #${ROOT_ID} .hmi-route-wrap{position:relative;width:100%;
    height:clamp(48px,8vh,92px);display:flex;align-items:flex-end;justify-content:center}
  #${ROOT_ID} .hmi-route{display:block;width:100%;height:100%}
  #${ROOT_ID} .hmi-assist{display:flex;align-items:center;justify-content:center;gap:.6em;line-height:1;margin-top:clamp(2px,0.4vh,6px)}
  #${ROOT_ID} .hmi-auto-dot{width:5px;height:5px;border-radius:50%;background:var(--hmi-text-tertiary);box-shadow:0 0 5px rgba(255,255,255,.18)}
  #${ROOT_ID} .hmi-auto-state{font-size:var(--hmi-scale-labelTiny);font-weight:600;letter-spacing:.30em;text-transform:uppercase;color:var(--hmi-text-tertiary);transition:color var(--hmi-motion-normal)}

  /* 右：Speed + Gear pill */
  #${ROOT_ID} .hmi-speed{display:flex;align-items:baseline;gap:clamp(6px,0.7vw,14px);justify-content:flex-end}
  #${ROOT_ID} .hmi-speed-num{font-size:var(--hmi-scale-speedNum);font-weight:200;line-height:.92;
    color:var(--hmi-text-primary);font-variant-numeric:tabular-nums;letter-spacing:-.01em;
    text-shadow:0 0 16px var(--hmi-glass-arcGlow),0 1px 14px rgba(0,0,0,.42)}
  #${ROOT_ID} .hmi-speed-side{display:flex;flex-direction:column;align-items:flex-end;gap:clamp(4px,0.7vh,9px);padding-bottom:clamp(3px,0.5vh,8px)}
  #${ROOT_ID} .hmi-speed-label{font-size:var(--hmi-scale-labelTiny);font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:var(--hmi-text-secondary);line-height:1.1;white-space:nowrap}
  #${ROOT_ID} .hmi-gear{display:inline-flex;align-items:center;justify-content:center;
    min-width:clamp(26px,2.2vw,38px);padding:.16em .66em;
    font-size:var(--hmi-scale-labelTiny);font-weight:700;letter-spacing:.30em;text-transform:uppercase;
    color:var(--hmi-text-primary);background:rgba(120,170,255,.10);
    border:1px solid rgba(170,210,255,.22);border-radius:999px;
    box-shadow:0 0 8px rgba(120,170,255,.10),inset 0 0 6px rgba(170,210,255,.06)}
  #${ROOT_ID} .hmi-gear[data-gear="D"]{color:rgba(190,230,255,.95);border-color:rgba(170,210,255,.34)}
  #${ROOT_ID} .hmi-gear[data-gear="R"]{color:rgba(255,196,170,.95);border-color:rgba(255,180,140,.34);background:rgba(255,170,120,.08);box-shadow:0 0 8px rgba(255,170,120,.10),inset 0 0 6px rgba(255,170,120,.06)}
  #${ROOT_ID} .hmi-gear[data-gear="N"]{color:var(--hmi-text-secondary);border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.05)}
`;

// 分段能量条：14 段，按 SOC 点亮。
const SOC = 82, SEG_COUNT = 14;
function buildSegs() {
  const lit = Math.round((SOC / 100) * SEG_COUNT);
  let s = '';
  for (let i = 0; i < SEG_COUNT; i++) {
    const on = i < lit ? ' on' : '';
    const low = SOC <= 15 ? ' low' : '';
    s += `<span class="hmi-seg${low}${on}"></span>`;
  }
  return s;
}

const MARKUP = `
  <div class="hmi-arc">
    <svg viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="hmiArcGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="rgba(196,228,255,0)"/>
          <stop offset="0.18" stop-color="rgba(196,228,255,0.55)"/>
          <stop offset="0.5" stop-color="rgba(220,240,255,0.62)"/>
          <stop offset="0.82" stop-color="rgba(196,228,255,0.55)"/>
          <stop offset="1" stop-color="rgba(196,228,255,0)"/>
        </linearGradient>
        <filter id="hmiArcBlur" x="-5%" y="-50%" width="110%" height="300%">
          <feGaussianBlur stdDeviation="2.2"/>
        </filter>
      </defs>
      <!-- 曲面座舱基线：两端略上扬、中心略下沉的浅弧；先一条柔光垫底，再一条锐线。 -->
      <path d="M0,86 Q500,112 1000,86" fill="none" stroke="rgba(130,185,255,0.30)" stroke-width="5" filter="url(#hmiArcBlur)" opacity="0.9"/>
      <path d="M0,86 Q500,112 1000,86" fill="none" stroke="url(#hmiArcGrad)" stroke-width="1.4"/>
    </svg>
  </div>
  <div class="hmi-dock">
    <div class="hmi-island hmi-left">
      <div class="hmi-energy">
        <div class="hmi-soc">${SOC}<span class="pct">%</span></div>
        <div class="hmi-label dim">BATTERY</div>
        <div class="hmi-segs" aria-hidden="true">${buildSegs()}</div>
        <div class="hmi-range">610<span class="tag">CLTC</span><span class="u">KM</span></div>
      </div>
    </div>
    <div class="hmi-island hmi-mid">
      <div class="hmi-route-wrap">
        <canvas class="hmi-route" id="hmiRouteCanvas" aria-hidden="true"></canvas>
      </div>
      <div class="hmi-assist">
        <div class="hmi-auto-dot"></div>
        <div class="hmi-label">AUTOSTEER</div>
        <div class="hmi-auto-state" id="hmiAutoState">OFF</div>
      </div>
    </div>
    <div class="hmi-island hmi-right">
      <div class="hmi-speed">
        <div class="hmi-speed-num" id="hmiSpeedNum">0</div>
        <div class="hmi-speed-side">
          <div class="hmi-speed-label">KM / H</div>
          <div class="hmi-gear" id="hmiGear" data-gear="N">N</div>
        </div>
      </div>
    </div>
  </div>
`;

export function installHmiDrivingHud() {
  if (installed) return;
  if (typeof document === 'undefined') return;
  installed = true;
  installHmiTokens();

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = MARKUP;
  document.body.appendChild(root);

  elSpeedNum = root.querySelector('#hmiSpeedNum');
  elGear = root.querySelector('#hmiGear');
  elAutoState = root.querySelector('#hmiAutoState');
  elRouteCanvas = root.querySelector('#hmiRouteCanvas');
  if (elRouteCanvas) {
    routeCtx = elRouteCanvas.getContext('2d');
    routeDpr = Math.min(window.devicePixelRatio || 1, 2);
    resizeRouteCanvas();
    addEventListener('resize', resizeRouteCanvas);
  }
}

function resizeRouteCanvas() {
  if (!elRouteCanvas) return;
  const r = elRouteCanvas.getBoundingClientRect();
  routeW = Math.max(20, Math.floor(r.width));
  routeH = Math.max(10, Math.floor(r.height));
  elRouteCanvas.width = Math.floor(routeW * routeDpr);
  elRouteCanvas.height = Math.floor(routeH * routeDpr);
  if (routeCtx) routeCtx.setTransform(routeDpr, 0, 0, routeDpr, 0, 0);
}

// 透视映射：近端（车位，z≈0）贴底占宽，远端（z→FORWARD）向顶部收窄。
//   返回屏幕坐标 [x, y]。side：-1=左路缘 / 0=中心 / 1=右路缘（以路面半宽偏移）。
function project(rx, rz) {
  const t = Math.max(0, Math.min(1, rz / ROUTE_FORWARD_M)); // 0 近 → 1 远
  // 近大远小：水平缩放随 t 增大而变小（透视收窄）。
  const scale = 1 - 0.74 * t;
  const cx = routeW * 0.5;
  // 路面半宽映射到屏幕：近端占画布宽约 78%。
  const baseHalf = routeW * 0.39;
  const px = cx + (rx / ROUTE_HALF_W_M) * baseHalf * scale;
  // 垂直：近端贴底 (routeH)，远端到顶部上方留一点；用幂函数加强透视。
  const py = routeH * (1 - Math.pow(t, 0.82)) * 0.96;
  return [px, py];
}

// 画路面带：以路中心点列（pts: {x:右偏移, z:前方距离}）为骨架，
//   左/右各偏 ±HALF_W 生成两条路缘线，随路弯、向前收窄；底部一个车位点。
//   冷白偏青、克制发光，不抢画面。
function drawRoutePreview(pts) {
  if (!routeCtx || !routeW || !routeH) return;
  const ctx = routeCtx;
  ctx.clearRect(0, 0, routeW, routeH);
  if (!pts || pts.length < 2) { drawCarDot(ctx); return; }
  // 收集可见中心点（按 z 前方）。
  const mid = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.z < -2 || p.z > ROUTE_FORWARD_M + 6) continue;
    mid.push(p);
  }
  if (mid.length < 2) { drawCarDot(ctx); return; }
  // 生成两条路缘的屏幕点。路缘偏移 = 中心 x ± HALF_W。
  const left = [], right = [];
  for (let i = 0; i < mid.length; i++) {
    const p = mid[i];
    left.push(project(p.x - ROUTE_HALF_W_M, p.z));
    right.push(project(p.x + ROUTE_HALF_W_M, p.z));
  }
  // 路面填充：极淡的冷白渐变（近亮远淡），仅营造路面身份，不抢眼。
  ctx.save();
  const grad = ctx.createLinearGradient(0, routeH, 0, 0);
  grad.addColorStop(0, 'rgba(150,200,255,0.16)');
  grad.addColorStop(1, 'rgba(150,200,255,0.0)');
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
  // 两条路缘线：逐段绘制，远端 alpha 渐弱；冷白偏青、锐而克制。
  drawEdge(ctx, left, mid);
  drawEdge(ctx, right, mid);
  drawCarDot(ctx);
}

function drawEdge(ctx, edge, mid) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < edge.length; i++) {
    const t = Math.max(0, Math.min(1, mid[i].z / ROUTE_FORWARD_M));
    const alpha = 0.85 * (1 - 0.62 * t);
    ctx.strokeStyle = `rgba(204,236,255,${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.7 * (1 - 0.45 * t);
    ctx.beginPath();
    ctx.moveTo(edge[i - 1][0], edge[i - 1][1]);
    ctx.lineTo(edge[i][0], edge[i][1]);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCarDot(ctx) {
  ctx.save();
  const cx = routeW * 0.5, cy = routeH - 2;
  ctx.fillStyle = 'rgba(220,238,255,0.92)';
  ctx.shadowColor = 'rgba(150,200,255,0.55)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 7);
  ctx.lineTo(cx - 4.5, cy);
  ctx.lineTo(cx + 4.5, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 每帧调用：speedKmh / distanceM / racePhase / gear / routePts / halfW。
//   routePts 由 main.js 基于 samples / nearestRoad 算好（车体相对坐标，右为正）。
//   halfW = world.js 导出 HALF_W（只读）。电量/续航静态占位。AUTOSTEER 恒 OFF。
export function updateHmiDrivingHud(speedKmh = 0, distanceM = 0, racePhase = 'free', gear = 'N', routePts = null, halfW = null) {
  if (!installed) return;
  if (typeof halfW === 'number' && halfW > 0) ROUTE_HALF_W_M = halfW;
  if (elSpeedNum) elSpeedNum.textContent = Math.round(speedKmh || 0);
  if (elGear) {
    const g = gear || 'N';
    if (elGear.textContent !== g) elGear.textContent = g;
    if (elGear.dataset.gear !== g) elGear.dataset.gear = g;
  }
  if (elAutoState && elAutoState.textContent !== 'OFF') elAutoState.textContent = 'OFF';
  if (routeCtx) drawRoutePreview(routePts);
}

