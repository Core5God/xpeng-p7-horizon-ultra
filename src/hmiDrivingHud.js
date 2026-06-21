// ---------- HMI Driving HUD (perspective curved-screen 20260620) ----------
// 曲面座舱 HMI：左右两侧内容做透视斜切（rotateY），像环绕屏的两翼向中间环抱。
//   - dock 居中有最大宽度，左右信息整体往中间收（不贴屏幕边缘，4K 不拉太开）。
//   - 左右块绕内侧竖轴 rotateY 卷向观察者 → 曲面屏质感来源；中部基本正对。
//   - 左中右三块垂直位置沿一条「下凹弧线」排布（两端高、中间低）→ 下拱曲面座舱感。
//   - 自适应用稳健 clamp/vmin，保证 1080 / 1440 / 2160 三档完整可见不裁切不溢出。
//   - 中部路线：直接用 main.js 传入的真实前方道路点数组投影成折线/平滑曲线，
//     前方真有弯就真的弯；近端粗、远端细+渐弱的透视收窄；车端用镜空白色端头干净收口。
//   - 已移除底部独立弧光（多余）；曲面感改由左右信息下拱排布表达。
//     只改 UI/HMI；不接 autosteer 真功能；电量/续航为动态模型（从 100% 随行驶距离缓降至 82% 附近）。
import { installHmiTokens } from './hmiTokens.js';
let installed = false;
let elSpeedNum = null, elGear = null, elAutoState = null;
let elSocNum = null, elTickFill = null, elRangeNum = null;
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
    /* 透视收紧（900→700~900）让左右两翼卷曲/拱形更明显的座舱曲面感。 */
    perspective:clamp(700px,62vw,900px);perspective-origin:50% 64%}

  /* 信息岛通用：裸字浮在画面，靠位置/字距与极轻 text-shadow 保证可读。 */
  #${ROOT_ID} .hmi-island{position:relative;display:flex;flex-direction:column;
    padding:clamp(4px,0.6vh,10px) clamp(6px,0.8vw,14px);
    text-shadow:0 1px 12px rgba(0,0,0,.55),0 0 2px rgba(0,0,0,.45);
    transform-style:preserve-3d;will-change:transform}
  /* 玻璃底已去除，.glass 仅保留为空钩子。 */
  #${ROOT_ID} .hmi-island.glass{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:none;box-shadow:none}
  /* 左块：绕内侧（右缘）竖轴 rotateY 正角 → 左缘朝里卷，曲面左翼。垂直上抬（下拱弧两端高）。 */
  #${ROOT_ID} .hmi-left{align-items:flex-start;text-align:left;flex:0 0 auto;min-width:0;white-space:nowrap;
    transform-origin:right center;transform:translateY(-66%) rotateY(38deg)}
  /* 中块：下拱弧最低点，不上抬。 */
  #${ROOT_ID} .hmi-mid{align-items:center;text-align:center;flex:0 1 auto;min-width:0;
    max-width:min(38vw,480px);margin:0 clamp(8px,1.6vw,32px);
    transform-origin:center center;transform:translateY(0) rotateY(0deg)}
  /* 右块：绕内侧（左缘）竖轴 rotateY 负角 → 右缘朝里卷，曲面右翼（与左对称）。垂直上抬。 */
  #${ROOT_ID} .hmi-right{align-items:flex-end;text-align:right;flex:0 0 auto;min-width:0;white-space:nowrap;
    transform-origin:left center;transform:translateY(-66%) rotateY(-38deg)}
  #${ROOT_ID} .hmi-label{font-size:var(--hmi-scale-labelTiny);font-weight:500;letter-spacing:.24em;
    text-transform:uppercase;color:var(--hmi-text-secondary);line-height:1.1}
  #${ROOT_ID} .hmi-label.dim{color:var(--hmi-text-tertiary);letter-spacing:.28em}
  /* 电量读数可见性增强（任务1）：BATTERY 标签由最暗 tertiary 提到 secondary 档，
     并比通用 .dim 略亮（.62），略加大字号，确保亮背景/强光下也能看清，但仍克制不喧宾夺主。 */
  #${ROOT_ID} .hmi-energy .hmi-label.dim{color:rgba(255,255,255,.62);letter-spacing:.26em;
    font-size:clamp(10px,0.5vw,13px);font-weight:600;
    text-shadow:0 1px 8px rgba(0,0,0,.5)}

  /* 左：Energy 能量模块（电车身份） */
  #${ROOT_ID} .hmi-energy{display:flex;flex-direction:column;align-items:flex-start;gap:clamp(3px,0.5vh,7px)}
  /* SOC 主数字提亮/适当增大：向 speed 数字可读性看齐（但不抢主），字重略加、提亮到全白，
     并加强冷白柔光描边，强光下不被吃掉。字号 clamp 上限拉高一档。 */
  #${ROOT_ID} .hmi-soc{display:inline-flex;align-items:baseline;gap:.16em;
    font-size:clamp(36px,3.1vw,68px);font-weight:300;line-height:.95;color:rgba(255,255,255,.98);
    font-variant-numeric:tabular-nums;letter-spacing:.005em;
    text-shadow:0 0 16px var(--hmi-glass-arcGlow),0 0 4px rgba(0,0,0,.55),0 1px 12px rgba(0,0,0,.5)}
  #${ROOT_ID} .hmi-soc .pct{font-size:.42em;color:rgba(255,255,255,.7);font-weight:400;letter-spacing:.05em;margin-left:.04em}
  /* 能量极简：去掉分段能量条，最多一条极细单横线示意电量（克制）。
     任务1：略加粗(1px→2px)、底槽与亮条都提亮一点，让“电量在掉”可感知。 */
  #${ROOT_ID} .hmi-tickline{position:relative;width:clamp(58px,5.2vw,104px);height:2px;border-radius:2px;
    margin:clamp(2px,0.4vh,5px) 0;background:rgba(255,255,255,.2);overflow:hidden}
  #${ROOT_ID} .hmi-tickline span{position:absolute;left:0;top:0;height:100%;border-radius:2px;
    background:rgba(208,234,255,.82);box-shadow:0 0 8px rgba(160,205,255,.5)}
  /* 续航数字保持 accent 冷色；CLTC / KM 标签从最暗 tertiary 提到 secondary 档并略加字号，亮背景可读。 */
  #${ROOT_ID} .hmi-range{display:inline-flex;align-items:baseline;gap:.30em;
    font-size:clamp(17px,1.35vw,30px);font-weight:400;line-height:1;
    color:var(--hmi-glass-accent);font-variant-numeric:tabular-nums;letter-spacing:.01em;
    text-shadow:0 1px 10px rgba(0,0,0,.45)}
  #${ROOT_ID} .hmi-range .tag{font-size:.5em;color:rgba(255,255,255,.55);font-weight:700;letter-spacing:.24em;text-transform:uppercase}
  #${ROOT_ID} .hmi-range .u{font-size:.5em;color:rgba(255,255,255,.55);font-weight:700;letter-spacing:.2em;text-transform:uppercase}

  /* 中：slowroads 式真实路线预览（按前方道路点折线） + AUTOSTEER。需足够高才能读出弯道。 */
  /* 中：slowroads 式真实路线预览 + AUTOSTEER。直接画前方道路点折线，需足够高才能看出弯道。 */
  #${ROOT_ID} .hmi-route-wrap{position:relative;
    /* 加宽 + 明确 overflow:visible，保证大弯曲线不被容器裁切。 */
    width:clamp(88px,12vw,168px);
    height:clamp(64px,11vmin,128px);display:flex;align-items:flex-end;justify-content:center;
    overflow:visible}
  #${ROOT_ID} .hmi-route{display:block;width:100%;height:100%;overflow:visible}
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
// 动态电量模型（问题3）：从 SOC_FULL(100%) 起步，随行驶距离/时间缓慢消耗，
// 平滑下探至 SOC_FLOOR(82%) 附近后继续极慢下降（克制，不做花哨动画）。
// 续航 = RANGE_FULL_KM * SOC%（满电 CLTC 基准），取整显示。
const SOC_FULL = 100;        // 起步电量（%）
const SOC_FLOOR = 82;        // 主要消耗后的目标平台（%）
const RANGE_FULL_KM = 744;   // 满电(100%)续航基准；82% → 610km（610/0.82≈744）
// 主消耗段：在 PHASE1_M 米内由 100% 平滑降到接近 82%；之后进入极缓慢续降段。
const SOC_PHASE1_M = 4200;   // 第一阶段消耗里程（米）
const SOC_TAU_M = 1100;      // 指数平滑里程常数（越大越缓）
const SOC_SLOW_PER_M = 0.0008; // 平台后每米继续下降的 SOC（极缓）
let _socShown = SOC_FULL;    // 当前显示 SOC（数值低通，避免跳字）
let _socInited = false;

// 由行驶距离推导 SOC（%）。前段指数逼近 floor，过 PHASE1 后线性极缓续降。
function socFromDistance(distanceM) {
  const d = Math.max(0, distanceM || 0);
  // 指数衰减：SOC = FLOOR + (FULL-FLOOR)*e^{-d/TAU}，d→∞ 趋近 FLOOR。
  let soc = SOC_FLOOR + (SOC_FULL - SOC_FLOOR) * Math.exp(-d / SOC_TAU_M);
  // 过了主消耗段，再叠加极缓慢线性续降（可低于 82%）。
  if (d > SOC_PHASE1_M) soc -= (d - SOC_PHASE1_M) * SOC_SLOW_PER_M;
  return Math.max(0, Math.min(SOC_FULL, soc));
}

// 更新左侧能量显示：SOC 数字 + tickline 宽度 + 续航 KM（=基准*SOC%）。
function updateEnergy(distanceM) {
  const target = socFromDistance(distanceM);
  if (!_socInited) { _socShown = target; _socInited = true; }
  else _socShown += (target - _socShown) * 0.06; // 数值低通，平滑不跳
  const socInt = Math.round(_socShown);
  if (elSocNum && elSocNum.textContent !== String(socInt)) elSocNum.textContent = socInt;
  if (elTickFill) elTickFill.style.width = _socShown.toFixed(1) + '%';
  const rangeKm = Math.round(RANGE_FULL_KM * (_socShown / 100));
  if (elRangeNum && elRangeNum.textContent !== String(rangeKm)) elRangeNum.textContent = rangeKm;
}

const MARKUP = `
  <div class="hmi-dock">
    <div class="hmi-island hmi-left">
      <div class="hmi-energy">
        <div class="hmi-soc"><span id="hmiSocNum">${SOC_FULL}</span><span class="pct">%</span></div>
        <div class="hmi-label dim">BATTERY</div>
        <div class="hmi-tickline" aria-hidden="true"><span id="hmiTickFill" style="width:${SOC_FULL}%"></span></div>
        <div class="hmi-range"><span id="hmiRangeNum">${RANGE_FULL_KM}</span><span class="tag">CLTC</span><span class="u">KM</span></div>
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
  _smooth = null; _seeded = false; _scaleSmooth = null; _nearAnchor = null; _socInited = false; _socShown = SOC_FULL; // 进驾驶态/首装：清空平滑点/缩放/近端锚定与电量状态，让首个有效帧 snap。
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
  elSocNum = root.querySelector('#hmiSocNum');
  elTickFill = root.querySelector('#hmiTickFill');
  elRangeNum = root.querySelector('#hmiRangeNum');
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
let _scaleSmooth = null; // 自适应缩放因子(fit)的低通平滑值；首帧 snap，避免线宽/弧度逐帧忽大忽小跳
// 近端锚定（问题2）：车端首若干采样点用更强的时间平滑/锚定，让静止/匀速时不脉动。
let _nearAnchor = null; // [{x,z}] 近端被锚定/强平滑的点（只覆盖前 NEAR_LOCK_N 个）

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
//   问题2 修复：近端首 NEAR_LOCK_N 个点用更低的跟随系数（更强平滑/接近锚定），
//   并对“车端首点”的纵向 z 做硬锚定（0），消除静止/匀速时端头伸缩脉动。
//   远端仍用原 k 正常跟随道路弯（不把整条线变僵）。
const NEAR_LOCK_N = 5;        // 近端被强平滑的采样点个数（3→5，任务2再压）
const NEAR_DEADZONE_M = 0.18; // 近端位置死区（米）：偏移小于此量不跟随，消除采样抖引起的周期性伸缩
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
  // 逆向数据平滑：近端用很低的 k（强锚定），远端用常规 k；z 近端更硬。
  const kFar = 0.12;       // 远端日常平顺跟随（远端要跟弯）
  const kNearX = 0.022;    // 近端横向：更强平滑（0.04→0.022）
  const kNearZ = 0.016;    // 近端纵向：更强（0.03→0.016），抑制端头伸缩脉动
  for (let i = 0; i < target.length; i++) {
    const near = i < NEAR_LOCK_N;
    if (near) {
      // 近端位置死区：偏移在死区内不跟（静止/匀速不抽）；超出才用极低 k 缓慢逆近。
      const dx = target[i].x - _smooth[i].x;
      const dz = target[i].z - _smooth[i].z;
      if (Math.abs(dx) > NEAR_DEADZONE_M) _smooth[i].x += dx * kNearX;
      if (Math.abs(dz) > NEAR_DEADZONE_M) _smooth[i].z += dz * kNearZ;
    } else {
      _smooth[i].x += (target[i].x - _smooth[i].x) * kFar;
      _smooth[i].z += (target[i].z - _smooth[i].z) * kFar;
    }
  }
  if (_smooth.length) _smooth[0].z = 0; // 车端首点纵向硬锢定 0，从根上消除端头纵向伸缩。
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
  //   车位点固定锦定在画布底部正中 (cx, yBottom)：不随 sp[0] 横向漂移。
  //   路线近端起点也对齐到该固定底点 → 把所有点的横向减去首点横向(x0)，
  //   这样近端均为 (cx,yBottom)，远端按真实道路弯——车点永远不动，路在它前方弯。
  const cx = routeW * 0.5;
  const yBottom = routeH - 2;     // 车端（近）在底
  const yTop = routeH * 0.05;     // 远端可达到的最高位置
  const usableH = yBottom - yTop;
  const zMax = ROUTE_FORWARD_M;   // 投影归一化用的最大前向距离
  const x0 = fwd[0].x;            // 首点横向 → 整体平移到中心，车点锦定底部正中
  // 横向比例：先用克制基准值，再根据本帧最弯极值自适应压缩进画布。
  const xScaleBase = (routeW * 0.46) / Math.max(3, ROUTE_HALF_W_M * 2.2);
  // 可用半宽（留 dot 余量）：曲线最大横向偏移不超过这个像素半宽。
  const halfAvail = routeW * 0.5 - Math.max(4, routeW * 0.06);
  // 远端透视收窄因子（与 project 一致）：(1 - 0.18*zNorm)。
  const persp = (p) => 1 - 0.18 * Math.min(1, p.z / zMax);
  // 先算这批点在 base 比例下的最大绝对横向偏移（含透视收窄）。
  let maxAbs = 0;
  for (let i = 0; i < fwd.length; i++) {
    const off = Math.abs((fwd[i].x - x0) * xScaleBase * persp(fwd[i]));
    if (off > maxAbs) maxAbs = off;
  }
  // 自适应：若最弯点超出可视半宽，等比压缩 xScale 让它刚好落进画布（大弯不被截断、不甩出）。
  const targetFit = maxAbs > halfAvail ? (halfAvail / maxAbs) : 1;
  // 对 fit 做时间低通平滑 + 死区：避免每帧重算让线宽/弧度逐帧跳（问题2 成因a）。
  // 首帧 snap；后续只在变化超过死区时缓慢逼近，静止/匀速时 fit 几乎不动。
  // 任务2：死区加宽(0.012→0.03)、低通系数调保守(0.06→0.03)，进一步减缩放逐帧跳。
  if (_scaleSmooth == null) _scaleSmooth = targetFit;
  else if (Math.abs(targetFit - _scaleSmooth) > 0.03) _scaleSmooth += (targetFit - _scaleSmooth) * 0.03;
  const fit = _scaleSmooth;
  const xScale = xScaleBase * fit;
  // 远端纵向压缩：zNorm^0.62 让近段占更多纵向像素（近大远远小）。
  const project = (p) => {
    const zNorm = Math.min(1, p.z / zMax);
    const yt = Math.pow(zNorm, 0.62);            // 0(底)→1(顶)
    const y = yBottom - usableH * yt;
    // 横向偏移相对首点平移到中心；随距离略收（远端透视收窄）。
    const x = cx + (p.x - x0) * xScale * (1 - 0.18 * zNorm);
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

  // 3) 车端镜空白色端头（问题1 修复）：不再用 destination-out 黑点压在线头上。
  //   导航线在车端（cx, yBottom）自然收成一个“镜空白色环形端头”：
  //   只画一圈白色描边环（与主线同色系），环内保持透明（透出背景），
  //   形成 hollow white endpoint；由于不填色/不挡黑，线头与端头干净衔接，消除黑点遮挡观感。
  //   lineCap=round 已为线头提供圆收口；这里只用描边环强调镜空端点，不叠实心圆。
  ctx.save();
  const carX = cx, carY = yBottom;
  // 环半径与近端线宽协调：略大于半个线宽，让线头刚好从环内镜空处生长出去。
  const rDot = Math.max(3.2, wNear * 0.62);
  const ringW = Math.max(1.5, wNear * 0.30);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 先在端头中心挖出一个小空心（destination-out），让线头不是实心 blob，
  // 而是透出背景的镜空点；再在外圈描一道白环强调端点轮廓。
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(carX, carY, Math.max(1, rDot - ringW * 0.5), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = 'rgba(190,222,255,0.55)';
  ctx.shadowBlur = 6;
  // 镜空白色环端头（不填心，中心透出背景）。
  ctx.beginPath();
  ctx.arc(carX, carY, rDot, 0, Math.PI * 2);
  ctx.lineWidth = ringW;
  ctx.strokeStyle = 'rgba(236,246,255,0.96)';
  ctx.stroke();
  ctx.restore();
}

// 每帧调用：speedKmh / distanceM / racePhase / gear / routePts / halfW。
//   routePts 由 main.js 基于 samples / nearestRoad 算好（车体相对坐标，右为正）。
//   halfW = world.js 导出 HALF_W（只读）。电量/续航由 distanceM 驱动动态更新。AUTOSTEER 恒 OFF。
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
  updateEnergy(distanceM); // 动态电量/续航（问题3）：随行驶距离从 100% 缓降，续航 KM 同步。
  if (routeCtx) drawRoutePreview(routePts);
}

