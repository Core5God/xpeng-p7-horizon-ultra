// ---------- HMI Driving HUD (Stage 3.2.2) — placeholder, body appended via edits ----------
import { installHmiTokens } from './hmiTokens.js';
let installed = false;
let elDistNum = null, elSpeedNum = null, elGear = null, elAutoState = null;
let elRouteCanvas = null, routeCtx = null, routeDpr = 1, routeW = 0, routeH = 0;
const ROOT_ID = 'hmi-driving-hud';
const STYLE_ID = 'hmi-driving-hud-style';
const ROUTE_FORWARD_M = 100;
const ROUTE_HALF_W_M = 30;

const STYLE = `  #${ROOT_ID}{position:fixed;inset:0;z-index:11;pointer-events:none;
    font-family:var(--hmi-font);color:var(--hmi-text-primary);display:none}
  body.drive #${ROOT_ID}{display:block}
  /* cockpit 信息带：贴底、宽居中、两侧渐隐、高度略降、背景再透 */
  #${ROOT_ID} .hmi-band{position:fixed;left:50%;bottom:0;
    width:min(1500px,94vw);
    height:clamp(72px,6.4vw,118px);
    transform:translateX(-50%) perspective(1500px) rotateX(3.2deg);
    transform-origin:50% 100%;
    display:flex;align-items:stretch;
    padding:clamp(10px,1.4vmin,22px) clamp(36px,5vw,84px) clamp(10px,1.2vmin,18px);
    background:linear-gradient(180deg,rgba(20,26,34,.06) 0%,var(--hmi-glass-bandBg) 38%,var(--hmi-glass-bandBg) 100%);
    border-radius:var(--hmi-glass-bandRadius) var(--hmi-glass-bandRadius) 0 0;
    -webkit-backdrop-filter:blur(var(--hmi-glass-bandBlur)) saturate(118%);
    backdrop-filter:blur(var(--hmi-glass-bandBlur)) saturate(118%);
    -webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 12%,#000 88%,transparent 100%);
    mask-image:linear-gradient(90deg,transparent 0%,#000 12%,#000 88%,transparent 100%);
    box-shadow:0 -10px 50px var(--hmi-glass-bandGlow),0 -2px 22px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.04)}
  #${ROOT_ID} .hmi-band::before{content:'';position:absolute;left:14%;right:14%;top:0;height:1px;
    background:linear-gradient(90deg,transparent,var(--hmi-glass-bandHairline),transparent);
    pointer-events:none;border-radius:2px;
    box-shadow:0 0 6px var(--hmi-glass-bandHairline),0 0 14px rgba(170,210,255,.18)}
  #${ROOT_ID} .hmi-band::after{content:'';position:absolute;left:18%;right:18%;bottom:0;height:1px;
    background:linear-gradient(90deg,transparent,var(--hmi-glass-bandEdge),transparent);
    pointer-events:none;box-shadow:0 0 8px var(--hmi-glass-bandEdge)}
  #${ROOT_ID} .hmi-grp{display:flex;flex-direction:column;justify-content:flex-end;text-shadow:0 1px 12px rgba(0,0,0,.40)}
  #${ROOT_ID} .hmi-left{flex:0 0 30%;align-items:flex-start;text-align:left;gap:clamp(2px,0.4vmin,6px)}
  #${ROOT_ID} .hmi-mid{flex:1 1 40%;align-items:center;text-align:center;justify-content:flex-end;gap:clamp(3px,0.5vmin,7px);min-width:0}
  #${ROOT_ID} .hmi-right{flex:0 0 30%;align-items:flex-end;text-align:right;gap:clamp(2px,0.4vmin,5px)}
  #${ROOT_ID} .hmi-label{font-size:var(--hmi-scale-labelTiny);font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:var(--hmi-text-secondary);line-height:1.1}
  #${ROOT_ID} .hmi-label.dim{color:var(--hmi-text-tertiary);letter-spacing:.28em}
  /* 左：Energy / Range 模块 */
  #${ROOT_ID} .hmi-energy{display:flex;flex-direction:column;align-items:flex-start;gap:clamp(2px,0.3vmin,5px);width:100%}
  #${ROOT_ID} .hmi-energy-row{display:flex;align-items:baseline;gap:clamp(10px,1.2vw,22px);flex-wrap:wrap}
  #${ROOT_ID} .hmi-soc{display:inline-flex;align-items:baseline;gap:.18em;
    font-size:var(--hmi-scale-socNum);font-weight:200;line-height:1;color:var(--hmi-text-primary);
    font-variant-numeric:tabular-nums;letter-spacing:.005em;
    text-shadow:0 0 14px var(--hmi-glass-bandGlow),0 1px 12px rgba(0,0,0,.42)}
  #${ROOT_ID} .hmi-soc .pct{font-size:.45em;color:var(--hmi-text-secondary);font-weight:300;letter-spacing:.06em;margin-left:.05em}
  #${ROOT_ID} .hmi-range{display:inline-flex;align-items:baseline;gap:.32em;
    font-size:var(--hmi-scale-rangeNum);font-weight:300;line-height:1;
    color:var(--hmi-glass-accent);font-variant-numeric:tabular-nums;letter-spacing:.01em;
    text-shadow:0 0 10px var(--hmi-glass-bandGlow)}
  #${ROOT_ID} .hmi-range .tag{font-size:.42em;color:var(--hmi-text-tertiary);font-weight:500;letter-spacing:.28em;text-transform:uppercase}
  #${ROOT_ID} .hmi-range .u{font-size:.42em;color:var(--hmi-text-tertiary);font-weight:500;letter-spacing:.22em;text-transform:uppercase}
  #${ROOT_ID} .hmi-bar{position:relative;width:min(220px,80%);height:3px;
    background:rgba(255,255,255,.08);border-radius:2px;margin-top:clamp(2px,0.3vmin,4px)}
  #${ROOT_ID} .hmi-bar-fill{position:absolute;inset:0;
    background:linear-gradient(90deg,var(--hmi-glass-accent),rgba(170,220,255,.55));
    border-radius:2px;box-shadow:0 0 8px rgba(120,180,255,.32)}
  #${ROOT_ID} .hmi-bar-ticks{position:absolute;inset:0;display:flex;justify-content:space-between;pointer-events:none}
  #${ROOT_ID} .hmi-bar-ticks span{width:1px;height:100%;background:rgba(8,12,18,.55)}
  #${ROOT_ID} .hmi-bar-ticks span:first-child,#${ROOT_ID} .hmi-bar-ticks span:last-child{background:transparent}
  #${ROOT_ID} .hmi-trip{display:inline-flex;align-items:baseline;gap:.45em;
    font-size:var(--hmi-scale-labelTiny);font-weight:500;letter-spacing:.22em;text-transform:uppercase;
    color:var(--hmi-text-secondary);font-variant-numeric:tabular-nums;margin-top:clamp(3px,0.4vmin,6px)}
  #${ROOT_ID} .hmi-trip .v{color:var(--hmi-text-primary);font-weight:600;letter-spacing:.04em;font-size:1.18em}
  #${ROOT_ID} .hmi-trip .u{color:var(--hmi-text-tertiary);font-size:.86em}
  /* 中：Route preview canvas + AUTOSTEER */
  #${ROOT_ID} .hmi-route-wrap{position:relative;width:100%;flex:1 1 auto;min-height:clamp(54px,6vmin,96px);display:flex;align-items:flex-end;justify-content:center}
  #${ROOT_ID} .hmi-route{display:block;width:100%;height:100%;
    -webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 14%,#000 86%,transparent 100%);
    mask-image:linear-gradient(90deg,transparent 0%,#000 14%,#000 86%,transparent 100%)}
  #${ROOT_ID} .hmi-assist{display:flex;align-items:center;gap:.7em;line-height:1}
  #${ROOT_ID} .hmi-auto-dot{width:5px;height:5px;border-radius:50%;background:var(--hmi-text-tertiary);box-shadow:0 0 5px rgba(255,255,255,.18)}
  #${ROOT_ID} .hmi-auto-state{font-size:var(--hmi-scale-labelTiny);font-weight:600;letter-spacing:.32em;text-transform:uppercase;color:var(--hmi-text-tertiary);transition:color var(--hmi-motion-normal)}
  /* 右：Speed + Gear pill */
  #${ROOT_ID} .hmi-speed{display:flex;align-items:baseline;gap:clamp(6px,0.7vw,14px)}
  #${ROOT_ID} .hmi-speed-num{font-size:var(--hmi-scale-speedNum);font-weight:200;line-height:1;
    color:var(--hmi-text-primary);font-variant-numeric:tabular-nums;letter-spacing:-.01em;
    text-shadow:0 0 18px var(--hmi-glass-bandGlow),0 1px 14px rgba(0,0,0,.42)}
  #${ROOT_ID} .hmi-speed-side{display:flex;flex-direction:column;align-items:flex-end;gap:clamp(4px,0.6vmin,8px);padding-bottom:clamp(4px,0.6vmin,9px)}
  #${ROOT_ID} .hmi-speed-label{display:inline-flex;align-items:center;gap:.6em;font-size:var(--hmi-scale-labelTiny);font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:var(--hmi-text-secondary);line-height:1.1}
  #${ROOT_ID} .hmi-lock{color:var(--hmi-text-tertiary);flex:0 0 auto;opacity:.55}
  #${ROOT_ID} .hmi-gear{display:inline-flex;align-items:center;justify-content:center;
    min-width:clamp(28px,2.4vw,42px);padding:.18em .7em;
    font-size:var(--hmi-scale-labelTiny);font-weight:700;letter-spacing:.34em;text-transform:uppercase;
    color:var(--hmi-text-primary);background:rgba(120,170,255,.10);
    border:1px solid rgba(170,210,255,.22);border-radius:999px;
    box-shadow:0 0 8px rgba(120,170,255,.10),inset 0 0 6px rgba(170,210,255,.06)}
  #${ROOT_ID} .hmi-gear[data-gear="D"]{color:rgba(190,230,255,.95);border-color:rgba(170,210,255,.34)}
  #${ROOT_ID} .hmi-gear[data-gear="R"]{color:rgba(255,196,170,.95);border-color:rgba(255,180,140,.34);background:rgba(255,170,120,.08);box-shadow:0 0 8px rgba(255,170,120,.10),inset 0 0 6px rgba(255,170,120,.06)}
  #${ROOT_ID} .hmi-gear[data-gear="N"]{color:var(--hmi-text-secondary);border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.05)}
`;
const MARKUP = `
  <div class="hmi-band">
    <div class="hmi-grp hmi-left">
      <div class="hmi-energy">
        <div class="hmi-label dim">ENERGY</div>
        <div class="hmi-energy-row">
          <div class="hmi-soc">82<span class="pct">%</span></div>
          <div class="hmi-range"><span class="tag">CLTC</span>610<span class="u">KM</span></div>
        </div>
        <div class="hmi-bar" aria-hidden="true">
          <div class="hmi-bar-fill" style="width:82%"></div>
          <div class="hmi-bar-ticks"><span></span><span></span><span></span><span></span><span></span><span></span></div>
        </div>
        <div class="hmi-trip">TRIP <span class="v" id="hmiDistNum">0.0</span><span class="u">KM</span></div>
      </div>
    </div>
    <div class="hmi-grp hmi-mid">
      <div class="hmi-route-wrap">
        <canvas class="hmi-route" id="hmiRouteCanvas" aria-hidden="true"></canvas>
      </div>
      <div class="hmi-assist">
        <div class="hmi-auto-dot"></div>
        <div class="hmi-label">AUTOSTEER</div>
        <div class="hmi-auto-state" id="hmiAutoState">OFF</div>
      </div>
    </div>
    <div class="hmi-grp hmi-right">
      <div class="hmi-speed">
        <div class="hmi-speed-num" id="hmiSpeedNum">0</div>
        <div class="hmi-speed-side">
          <div class="hmi-speed-label">KILOMETERS PER HOUR<svg class="hmi-lock" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4.4 7V5.2a3.6 3.6 0 0 1 7.2 0V7" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="3.3" y="7" width="9.4" height="6.4" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></div>
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

  elDistNum = root.querySelector('#hmiDistNum');
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

function mapPt(rx, rz) {
  const u = (rx + ROUTE_HALF_W_M) / (2 * ROUTE_HALF_W_M);
  const v = 1 - Math.max(0, Math.min(1, rz / ROUTE_FORWARD_M));
  return [u * routeW, v * routeH];
}

function drawRoutePreview(pts) {
  if (!routeCtx || !routeW || !routeH) return;
  const ctx = routeCtx;
  ctx.clearRect(0, 0, routeW, routeH);
  if (!pts || pts.length < 2) return;
  // 底部车位指示三角
  ctx.save();
  ctx.fillStyle = 'rgba(220,235,255,0.55)';
  ctx.shadowColor = 'rgba(170,210,255,0.35)';
  ctx.shadowBlur = 4;
  const cx = routeW * 0.5, cy = routeH - 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx - 4, cy);
  ctx.lineTo(cx + 4, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // 主线：细而锐利的冷白偏青导航线，不起外发光；末端（远端） alpha 渐弱。
  // 先收集可见点（带屏幕坐标与归一化进度）。
  const scr = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.z < -2 || p.z > ROUTE_FORWARD_M + 8) continue;
    const [px, py] = mapPt(p.x, p.z);
    const t = Math.max(0, Math.min(1, p.z / ROUTE_FORWARD_M)); // 0 近 → 1 远
    scr.push({ px, py, t });
  }
  if (scr.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.6;
  // 逐段绘制，远端 alpha 渐弱（克制）；不用 shadow，保持锐利。
  for (let i = 1; i < scr.length; i++) {
    const a = scr[i - 1], b = scr[i];
    const tMid = (a.t + b.t) * 0.5;
    const alpha = 0.92 * (1 - 0.55 * tMid); // 近端~0.92 → 远端~0.41
    ctx.strokeStyle = `rgba(206,238,255,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
    ctx.stroke();
  }
  ctx.restore();
}

// 每帧调用：speedKmh / distanceM / racePhase / gear / routePts。
// routePts 由 main.js 基于 samples / nearestRoad 算好。电量/续航静态占位。AUTOSTEER 恒 OFF。
export function updateHmiDrivingHud(speedKmh = 0, distanceM = 0, racePhase = 'free', gear = 'N', routePts = null) {
  if (!installed) return;
  if (elDistNum) elDistNum.textContent = ((distanceM || 0) / 1000).toFixed(1);
  if (elSpeedNum) elSpeedNum.textContent = Math.round(speedKmh || 0);
  if (elGear) {
    const g = gear || 'N';
    if (elGear.textContent !== g) elGear.textContent = g;
    if (elGear.dataset.gear !== g) elGear.dataset.gear = g;
  }
  if (elAutoState && elAutoState.textContent !== 'OFF') elAutoState.textContent = 'OFF';
  if (routeCtx) drawRoutePreview(routePts);
}
