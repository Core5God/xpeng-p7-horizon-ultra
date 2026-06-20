// ---------- HMI Driving HUD (perspective curved-screen 20260620) ----------
// 曲面座舱 HMI：左右两侧内容做透视斜切（rotateY），像环绕屏的两翼向中间环抱。
//   - dock 居中有最大宽度，左右信息整体往中间收（不贴屏幕边缘，4K 不拉太开）。
//   - 左右块绕内侧竖轴 rotateY 卷向观察者 → 曲面屏质感来源；中部基本正对。
//   - 自适应用稳健 clamp/vmin，保证 1080 / 1440 / 2160 三档完整可见不裁切不溢出。
//   - 中部路线：单条弯钩柔光线，近端粗、远端细的透视渐变收窄，营造往前延伸纵深感。
//   - 底部贴底弧光保留为座舱基线。只改 UI/HMI；不接 autosteer 真功能；电量/续航静态占位。
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

  /* 底部 UI 容器：居中有最大宽度，左右信息往中间收。透视舰在 dock 上给左右块做 3D rotateY。
     高度用 vmin 防止 4K 下过高、窄屏下过矮；最大宽 width:min(1500px,84vw)。 */
  #${ROOT_ID} .hmi-dock{position:fixed;left:50%;bottom:0;transform:translateX(-50%);
    width:min(1500px,84vw);
    height:clamp(96px,13vmin,156px);
    display:flex;align-items:flex-end;justify-content:space-between;gap:clamp(12px,2vw,46px);
    padding:0 clamp(8px,1.4vw,26px) clamp(14px,2vh,28px);
    box-sizing:border-box;
    perspective:clamp(900px,90vw,1280px);perspective-origin:50% 60%}

  /* 贴底曲面弧光：座舱屏边质感。SVG 跨屏宽贴最底（保留全宽，让弧光包住居中 dock）。 */
  #${ROOT_ID} .hmi-arc{position:fixed;left:0;right:0;bottom:0;
    width:100%;height:clamp(96px,13vmin,156px);pointer-events:none;
    overflow:visible}
  #${ROOT_ID} .hmi-arc svg{display:block;width:100%;height:100%}

  /* 信息岛通用：裸字浮在画面，靠位置/字距与极轻 text-shadow 保证可读。 */
  #${ROOT_ID} .hmi-island{position:relative;display:flex;flex-direction:column;
    padding:clamp(4px,0.6vh,10px) clamp(6px,0.8vw,14px);
    text-shadow:0 1px 12px rgba(0,0,0,.55),0 0 2px rgba(0,0,0,.45);
    transform-style:preserve-3d;will-change:transform}
  /* 玻璃底已去除，.glass 仅保留为空钩子。 */
  #${ROOT_ID} .hmi-island.glass{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:none;box-shadow:none}
  /* 左块：绕内侧（右缘）竖轴 rotateY 正角 → 左缘朝里卷，曲面左翼。 */
  #${ROOT_ID} .hmi-left{align-items:flex-start;text-align:left;flex:0 0 auto;min-width:0;white-space:nowrap;
    transform-origin:right center;transform:rotateY(24deg)}
  #${ROOT_ID} .hmi-mid{align-items:center;text-align:center;flex:0 1 auto;min-width:0;
    max-width:min(34vw,420px);margin:0 clamp(8px,1.6vw,32px);
    transform-origin:center center;transform:rotateY(0deg)}
  /* 右块：绕内侧（左缘）竖轴 rotateY 负角 → 右缘朝里卷，曲面右翼（与左对称）。 */
  #${ROOT_ID} .hmi-right{align-items:flex-end;text-align:right;flex:0 0 auto;min-width:0;white-space:nowrap;
    transform-origin:left center;transform:rotateY(-24deg)}
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
  /* 能量极简：去掉分段能量条，最多一条极细单横线示意电量（克制）。 */
  #${ROOT_ID} .hmi-tickline{position:relative;width:clamp(54px,5vw,96px);height:1px;
    margin:clamp(2px,0.4vh,5px) 0;background:rgba(255,255,255,.12);overflow:hidden}
  #${ROOT_ID} .hmi-tickline span{position:absolute;left:0;top:0;height:100%;
    background:rgba(196,228,255,.55);box-shadow:0 0 6px rgba(150,200,255,.35)}
  #${ROOT_ID} .hmi-range{display:inline-flex;align-items:baseline;gap:.30em;
    font-size:var(--hmi-scale-rangeNum);font-weight:300;line-height:1;
    color:var(--hmi-glass-accent);font-variant-numeric:tabular-nums;letter-spacing:.01em}
  #${ROOT_ID} .hmi-range .tag{font-size:.5em;color:var(--hmi-text-tertiary);font-weight:600;letter-spacing:.24em;text-transform:uppercase}
  #${ROOT_ID} .hmi-range .u{font-size:.5em;color:var(--hmi-text-tertiary);font-weight:600;letter-spacing:.2em;text-transform:uppercase}

  /* 中：slowroads 式单条弯钩光线 + AUTOSTEER。线小巧，宽约占屏 5-8%。 */
  #${ROOT_ID} .hmi-route-wrap{position:relative;
    width:clamp(42px,6.5vw,84px);
    height:clamp(52px,9vmin,104px);display:flex;align-items:flex-end;justify-content:center}
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

// slowroads 做减法：去掉分段能量条，只保留 SOC 与续航的克制细字层级。
const SOC = 82;

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
      <!-- 曲面座舱基线：更淡更细，不抢；先一条极淡柔光垫底，再一条发丝锐线。 -->
      <path d="M0,86 Q500,112 1000,86" fill="none" stroke="rgba(130,185,255,0.16)" stroke-width="3" filter="url(#hmiArcBlur)" opacity="0.8"/>
      <path d="M0,86 Q500,112 1000,86" fill="none" stroke="url(#hmiArcGrad)" stroke-width="0.9" opacity="0.7"/>
    </svg>
  </div>
  <div class="hmi-dock">
    <div class="hmi-island hmi-left">
      <div class="hmi-energy">
        <div class="hmi-soc">${SOC}<span class="pct">%</span></div>
        <div class="hmi-label dim">BATTERY</div>
        <div class="hmi-tickline" aria-hidden="true"><span style="width:${SOC}%"></span></div>
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
  _curve = null; // 进驾驶态/首装：清空平滑曲线，让首个有效帧 snap 而非从竖线 lerp。
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
    // 首帧 canvas 布局宽高可能为 0（还未 layout / display:none → block / 父级 3D transform 影响测量），
    // 用 ResizeObserver 监听容器真正拿到尺寸后重算，避免首屏用错误尺寸画出竖棍。
    if (typeof ResizeObserver !== 'undefined') {
      try {
        const ro = new ResizeObserver(() => resizeRouteCanvas());
        ro.observe(elRouteCanvas);
        const wrap = elRouteCanvas.parentElement;
        if (wrap) ro.observe(wrap);
      } catch (e) { /* noop */ }
    }
    // 延一帧再量一次，确保首屏布局完成后拿到真实宽高（首次 install 时容器可能尚未 layout）。
    requestAnimationFrame(() => resizeRouteCanvas());
  }
}

function resizeRouteCanvas() {
  if (!elRouteCanvas) return;
  const r = elRouteCanvas.getBoundingClientRect();
  // 只有拿到真实布局宽高才初始化；布局为 0（首帧/未显示）时保持 0，
  // 让 drawRoutePreview 跳过绘制，不画出错误的微型竖棍。
  const w = Math.floor(r.width);
  const h = Math.floor(r.height);
  if (w < 4 || h < 4) { routeW = 0; routeH = 0; return; }
  routeW = w;
  routeH = h;
  elRouteCanvas.width = Math.floor(routeW * routeDpr);
  elRouteCanvas.height = Math.floor(routeH * routeDpr);
  if (routeCtx) routeCtx.setTransform(routeDpr, 0, 0, routeDpr, 0, 0);
}

// slowroads 式单条「弯钩」光线 + 透视延伸：取车前方一段中心线，投影成一条近粗远细、圆头、带柔光的单线。
//   直行 → 接近垂直短线；转弯 → 向转弯方向弯成弧/钩。近端（底/车端）粗、远端（顶/前方）细，像真往前延伸的路。
//   位置：画布底部正中、AUTOSTEER 正上方，小巧。不再画左右两条路缘。
let _curve = null; // 时间平滑后的曲线控制点（屏幕坐标），逐帧 lerp 逼近 target

// 把「车前方某段中心线」抽成 3 个特征点：近(底)/中/远(顶)，用其右偏移 x 决定弯钩方向与幅度。
//   返回 {bend, reach}：bend = 归一化横向弯曲量（右为正），reach = 线条向上延伸比例。
function sampleBend(pts) {
  // 收集前向有效中心点（z>0），按 z 升序已天然有序。
  const fwd = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.z < 0 || p.z > ROUTE_FORWARD_M + 6) continue;
    fwd.push(p);
  }
  if (fwd.length < 2) return null;
  // 远端参考点：取约 ROUTE_FORWARD_M 处（或最后一个）。用它相对前方距离的横向偏移定义弯钩。
  const far = fwd[fwd.length - 1];
  const mid = fwd[Math.floor((fwd.length - 1) * 0.5)];
  // bend = 远端横向偏移 / 前向距离 → 越大越弯；夹紧到合理范围。
  const denom = Math.max(8, far.z);
  let bend = far.x / denom;            // 右为正
  let bendMid = mid.x / Math.max(6, mid.z);
  bend = Math.max(-1.4, Math.min(1.4, bend));
  bendMid = Math.max(-1.4, Math.min(1.4, bendMid));
  return { bend, bendMid };
}

function drawRoutePreview(pts) {
  // 首帧容错：若尚未拿到尺寸（routeW/H=0），先尝试重量一次（此时可能已 layout）。
  if ((!routeW || !routeH) && elRouteCanvas) resizeRouteCanvas();
  if (!routeCtx || !routeW || !routeH) return;
  const ctx = routeCtx;
  ctx.clearRect(0, 0, routeW, routeH);

  // 1) 目标弯曲量（无有效数据时返回 null，不强行当直行）。
  const b = pts ? sampleBend(pts) : null;

  // 2) 时间平滑：首帧若还没有有效 target 就不画（避免从默认竖线 lerp 过去 → 初始竖棍）。
  if (!b) {
    // 已有历史曲线则按历史值画（堆路中断帧不闪）；完全没有则跳过本帧。
    if (!_curve) return;
  } else if (!_curve) {
    // 首个有效帧：直接用真实 target 种子化 _curve（不从竖线默认 lerp）。
    _curve = { bend: b.bend, bendMid: b.bendMid };
  } else if (Math.abs(b.bend - _curve.bend) > 0.9 || Math.abs(b.bendMid - _curve.bendMid) > 0.9) {
    // 跳机位/进驾驶态导致车辆瞬移 → target 大跳变：直接 snap，不慢慢 lerp（否则会看到竖棍→弯钩的滑动）。
    _curve.bend = b.bend;
    _curve.bendMid = b.bendMid;
  } else {
    const k = 0.18;
    _curve.bend += (b.bend - _curve.bend) * k;
    _curve.bendMid += (b.bendMid - _curve.bendMid) * k;
  }

  // 3) 由平滑后的弯曲量构造一条 quadratic bezier 单线（底→顶）。
  //    近端（底/车端）粗、远端（顶/前方）细：透视延伸纵深感。
  const cx = routeW * 0.5;
  const yBottom = routeH - 2;
  const lineH = routeH * 0.92;
  // 横向摆幅基准：以画布宽的一部分为满偏（钩越急、偏越大）。
  const sway = routeW * 0.32;
  // 长度随转向幅度略变：弯急时略短（更聚成钩）。
  const reach = 1 - Math.min(0.18, Math.abs(_curve.bend) * 0.14);
  const yTopR = yBottom - lineH * reach;
  const xTopR = cx + _curve.bend * sway * reach;
  // 控制点用中段弯曲量，做出「钩」的内凹/外凸感。
  const yCtrl = yBottom - lineH * 0.55;
  const xCtrl = cx + _curve.bendMid * sway * 0.9;

  // 贝塞尔取点：t=0 在车端（底），t=1 在远端（顶）。沿曲线分段画，
  // 每段 lineWidth 从底到顶递减 → 近粗远细的透视收窄。
  const SEG = 22;
  const pt = (t) => {
    const it = 1 - t;
    const x = it * it * cx + 2 * it * t * xCtrl + t * t * xTopR;
    const y = it * it * yBottom + 2 * it * t * yCtrl + t * t * yTopR;
    return { x, y };
  };
  // 宽度曲线：近端（t=0）粗 wNear、远端（t=1）细 wFar。随画布尺寸缩放。
  const wNear = Math.max(6, routeW * 0.20);
  const wFar = Math.max(1.4, routeW * 0.045);
  const widthAt = (t) => wNear + (wFar - wNear) * Math.pow(t, 0.82);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 柔光底层：更宽更淡的同色 glow（同样近粗远细）。
  ctx.shadowColor = 'rgba(180,215,255,0.55)';
  ctx.shadowBlur = 13;
  for (let i = 0; i < SEG; i++) {
    const t0 = i / SEG, t1 = (i + 1) / SEG;
    const a = pt(t0), bb = pt(t1);
    const tm = (t0 + t1) * 0.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(bb.x, bb.y);
    ctx.strokeStyle = 'rgba(206,232,255,0.20)';
    ctx.lineWidth = widthAt(tm) * 2.0;
    ctx.stroke();
  }
  // 主线：冷白、近粗远细、圆头、半透明亮但不刺眼。
  ctx.shadowColor = 'rgba(190,222,255,0.65)';
  ctx.shadowBlur = 7;
  for (let i = 0; i < SEG; i++) {
    const t0 = i / SEG, t1 = (i + 1) / SEG;
    const a = pt(t0), bb = pt(t1);
    const tm = (t0 + t1) * 0.5;
    // 远端逐渐变淡，进一步强化向前延伸消失感。
    const alpha = 0.92 - 0.34 * Math.pow(tm, 1.3);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(bb.x, bb.y);
    ctx.strokeStyle = `rgba(232,244,255,${alpha.toFixed(3)})`;
    ctx.lineWidth = widthAt(tm);
    ctx.stroke();
  }
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

