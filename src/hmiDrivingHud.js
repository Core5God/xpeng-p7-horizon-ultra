// ---------- HMI Driving HUD (perspective curved-screen 20260620) ----------
// 曲面座舱 HMI：左右两侧内容做透视斜切（rotateY），像环绕屏的两翼向中间环抱。
//   - dock 居中有最大宽度，左右信息整体往中间收（不贴屏幕边缘，4K 不拉太开）。
//   - 左右块绕内侧竖轴 rotateY 卷向观察者 → 曲面屏质感来源；中部基本正对。
//   - 左中右三块垂直位置沿一条「下凹弧线」排布（两端高、中间低）→ 下拱曲面座舱感。
//   - 自适应用稳健 clamp/vmin，保证 1080 / 1440 / 2160 三档完整可见不裁切不溢出。
//   - 中部路线：直接用 main.js 传入的真实前方道路点数组投影成折线/平滑曲线，
//     前方真有弯就真的弯；近端粗、远端细+渐弱的透视收窄；底部加车辆位置空心圆点。
//   - 已移除底部独立弧光（多余）；曲面感改由左右信息下拱排布表达。
//     只改 UI/HMI；不接 autosteer 真功能；电量/续航静态占位。
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
     高度用 vmin 防止 4K 下过高、窄屏下过矮；最大宽 width:min(1500px,84vw)。
     align-items:flex-end 为基准，再由各块 translateY 拗出下拱弧（两端高、中间低）。 */
  #${ROOT_ID} .hmi-dock{position:fixed;left:50%;bottom:0;transform:translateX(-50%);
    width:min(1500px,84vw);
    height:clamp(112px,15vmin,184px);
    display:flex;align-items:flex-end;justify-content:space-between;gap:clamp(12px,2vw,46px);
    padding:0 clamp(8px,1.4vw,26px) clamp(14px,2vh,28px);
    box-sizing:border-box;
    perspective:clamp(900px,90vw,1280px);perspective-origin:50% 60%}

  /* 信息岛通用：裸字浮在画面，靠位置/字距与极轻 text-shadow 保证可读。 */
  #${ROOT_ID} .hmi-island{position:relative;display:flex;flex-direction:column;
    padding:clamp(4px,0.6vh,10px) clamp(6px,0.8vw,14px);
    text-shadow:0 1px 12px rgba(0,0,0,.55),0 0 2px rgba(0,0,0,.45);
    transform-style:preserve-3d;will-change:transform}
  /* 玻璃底已去除，.glass 仅保留为空钩子。 */
  #${ROOT_ID} .hmi-island.glass{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:none;box-shadow:none}
  /* 左块：绕内侧（右缘）竖轴 rotateY 正角 → 左缘朝里卷，曲面左翼。垂直上抬（下拱弧两端高）。 */
  #${ROOT_ID} .hmi-left{align-items:flex-start;text-align:left;flex:0 0 auto;min-width:0;white-space:nowrap;
    transform-origin:right center;transform:translateY(-26%) rotateY(24deg)}
  /* 中块：下拱弧最低点，不上抬。 */
  #${ROOT_ID} .hmi-mid{align-items:center;text-align:center;flex:0 1 auto;min-width:0;
    max-width:min(34vw,420px);margin:0 clamp(8px,1.6vw,32px);
    transform-origin:center center;transform:translateY(0) rotateY(0deg)}
  /* 右块：绕内侧（左缘）竖轴 rotateY 负角 → 右缘朝里卷，曲面右翼（与左对称）。垂直上抬。 */
  #${ROOT_ID} .hmi-right{align-items:flex-end;text-align:right;flex:0 0 auto;min-width:0;white-space:nowrap;
    transform-origin:left center;transform:translateY(-26%) rotateY(-24deg)}
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

  /* 中：slowroads 式真实路线预览（按前方道路点折线） + AUTOSTEER。需足够高才能读出弯道。 */
  /* 中：slowroads 式真实路线预览 + AUTOSTEER。直接画前方道路点折线，需足够高才能看出弯道。 */
  #${ROOT_ID} .hmi-route-wrap{position:relative;
    width:clamp(56px,8vw,108px);
    height:clamp(64px,11vmin,128px);display:flex;align-items:flex-end;justify-content:center}
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
  _smooth = null; _seeded = false; // 进驾驶态/首装：清空平滑点数组，让首个有效帧 snap 而非从竖线 lerp。
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

// slowroads 式真实路线预览：直接用 main.js 传入的「车前方道路中心线点数组」投影成屏幕折线/平滑曲线。
//   每点 {x: 右为正(米), z: 前向距离(米)}，前向 0~120m。z → 屏幕纵向（近端在底、远端在顶，
//   非线性压缩远端制造近大远小）；x → 屏幕横向偏移（按比例）。前方真有弯就真的弯，直道才直。
//   线型沿用 slowroads：单条、近粗(~7-9px)远细(~2px) taper、圆头、冷白柔光、远端 alpha 渐弱。
//   时间平滑作用到「每个投影点」（对点数组整体低通），不再压成 bend 标量。
//   首屏不画竖棍：首个有效帧直接 snap（_seeded），无有效数据则跳过本帧。
//   底部加车辆位置点：小空心描边圆，路线从此点往前延伸（slowroads 那样）。
let _smooth = null;   // 平滑后的车体相对点数组 [{x,z}]（与原始点一一对应）
let _seeded = false;  // 是否已用首个有效帧种子化（首帧 snap，不从竖线 lerp）

// 收集前向有效点（z≥0 且在可视距离内），按 z 升序（computeRoutePreview 已天然有序）。
function collectForward(pts) {
  if (!pts || !pts.length) return null;
  const fwd = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p) continue;
    if (p.z < -1 || p.z > ROUTE_FORWARD_M + 12) continue;
    fwd.push({ x: p.x, z: Math.max(0, p.z) });
  }
  if (fwd.length < 2) return null;
  return fwd;
}

// 时间平滑：把 target 点数组逐点 lerp 进 _smooth。点数变化或大跳变（瞬移/跳机位）直接 snap。
function smoothPoints(target) {
  if (!target) return _smooth; // 无新数据：沿用历史（中断帧不闪）
  if (!_smooth || _smooth.length !== target.length || !_seeded) {
    // 首个有效帧 / 点数变化：直接种子化，不从旧曲线慢慢 lerp（避免竖棍→曲线的滑动）。
    _smooth = target.map((p) => ({ x: p.x, z: p.z }));
    _seeded = true;
    return _smooth;
  }
  // 大跳变检测：远端横向偏移突变 → snap。
  const li = target.length - 1;
  if (Math.abs(target[li].x - _smooth[li].x) > 6 || Math.abs(target[li].z - _smooth[li].z) > 18) {
    _smooth = target.map((p) => ({ x: p.x, z: p.z }));
    return _smooth;
  }
  const k = 0.20;
  for (let i = 0; i < target.length; i++) {
    _smooth[i].x += (target[i].x - _smooth[i].x) * k;
    _smooth[i].z += (target[i].z - _smooth[i].z) * k;
  }
  return _smooth;
}

function drawRoutePreview(pts) {
  // 首帧容错：若尚未拿到尺寸（routeW/H=0），先尝试重量一次（此时可能已 layout）。
  if ((!routeW || !routeH) && elRouteCanvas) resizeRouteCanvas();
  if (!routeCtx || !routeW || !routeH) return;
  const ctx = routeCtx;
  ctx.clearRect(0, 0, routeW, routeH);

  // 1) 取真实前方点 + 时间平滑（逐点低通）。无有效数据且无历史则跳过（不画竖棍）。
  const target = collectForward(pts);
  const fwd = smoothPoints(target);
  if (!fwd || fwd.length < 2) return;

  // 2) 投影：z(前向米) → 纵向（近端底、远端顶，远端非线性压缩近大远小）；x(横向米) → 横向偏移。
  const cx = routeW * 0.5;
  const yBottom = routeH - 2;     // 车端（近）在底
  const yTop = routeH * 0.05;     // 远端可达到的最高位置
  const usableH = yBottom - yTop;
  const zMax = ROUTE_FORWARD_M;   // 投影归一化用的最大前向距离
  // 横向比例：把「横向米」按可视半宽映射到画布宽的一部分（克制，避免甩出画布）。
  const xScale = (routeW * 0.46) / Math.max(3, ROUTE_HALF_W_M * 2.2);
  // 远端纵向压缩：zNorm^0.62 让近段占更多纵向像素（近大远远小）。
  const project = (p) => {
    const zNorm = Math.min(1, p.z / zMax);
    const yt = Math.pow(zNorm, 0.62);            // 0(底)→1(顶)
    const y = yBottom - usableH * yt;
    // 横向偏移随距离略收（远端透视收窄）：乘 (1 - 0.18*zNorm)。
    const x = cx + p.x * xScale * (1 - 0.18 * zNorm);
    return { x, y, zNorm };
  };
  const sp = fwd.map(project);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 宽度：近端粗 wNear、远端细 wFar，按距离 taper。随画布尺寸缩放（目标近~7-9px、远~2px）。
  const wNear = Math.max(7, routeW * 0.085);
  const wFar = Math.max(2, routeW * 0.022);
  const widthAt = (zNorm) => wNear + (wFar - wNear) * Math.pow(zNorm, 0.85);

  // 柔光底层：更宽更淡的同色 glow。
  ctx.shadowColor = 'rgba(180,215,255,0.5)';
  ctx.shadowBlur = 12;
  for (let i = 0; i < sp.length - 1; i++) {
    const a = sp[i], b = sp[i + 1];
    const zm = (a.zNorm + b.zNorm) * 0.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(206,232,255,0.18)';
    ctx.lineWidth = widthAt(zm) * 1.9;
    ctx.stroke();
  }
  // 主线：冷白、近粗远细、圆头、远端 alpha 渐弱。
  ctx.shadowColor = 'rgba(190,222,255,0.62)';
  ctx.shadowBlur = 6;
  for (let i = 0; i < sp.length - 1; i++) {
    const a = sp[i], b = sp[i + 1];
    const zm = (a.zNorm + b.zNorm) * 0.5;
    const alpha = 0.94 - 0.46 * Math.pow(zm, 1.25); // 远端渐弱
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = `rgba(232,244,255,${alpha.toFixed(3)})`;
    ctx.lineWidth = widthAt(zm);
    ctx.stroke();
  }
  ctx.restore();

  // 3) 车辆位置点：底部近端一个小空心描边圆（中间挖空），路线从此处往前延伸。
  const car = sp[0];
  ctx.save();
  const rDot = Math.max(3.2, routeW * 0.05);
  ctx.shadowColor = 'rgba(190,222,255,0.6)';
  ctx.shadowBlur = 6;
  // 描边环
  ctx.beginPath();
  ctx.arc(car.x, car.y, rDot, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.6, rDot * 0.42);
  ctx.strokeStyle = 'rgba(232,244,255,0.95)';
  ctx.stroke();
  // 中心挖空（清掉环内，露出背景）
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(car.x, car.y, Math.max(1, rDot - ctx.lineWidth * 0.62), 0, Math.PI * 2);
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

