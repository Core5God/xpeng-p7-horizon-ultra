// ---------- P0 Minimal Driving HUD ----------
// 运行时注入一层更克制的驾驶态 UI 策略，避免直接大改 index.html。
// 默认驾驶态只保留速度、档位、小地图、临时提示；竞速态再显示计时组件。
import { renderer, G } from './core.js';
import { PERF, worldBudget, budgetCaps } from './perfMode.js';

let installed = false;
let lastMode = '';
let hintTimer = 0;

const DRIVE_CLASS = 'p0-min-drive';
const RACING_CLASS = 'p0-racing';
const HINT_CLASS = 'p0-hints-visible';

export function installMinimalDriveHud() {
  if (installed) return;
  installed = true;

  const style = document.createElement('style');
  style.id = 'p0-minimal-driving-hud';
  style.textContent = `
    /* 驾驶态极简：屏幕只保留 速度 / 档位 / 小地图 / 临时提示(showMsg)。
       其余常驻 HUD（品牌、得分、技能弹字、播放列表、键位条、模式、漂移实时）
       默认全部隐藏，不常驻占屏。竞速 racebox 仅 race 模式显示。 */
    body.${DRIVE_CLASS} #title,
    body.${DRIVE_CLASS} #scorechip,
    body.${DRIVE_CLASS} #skillstack,
    body.${DRIVE_CLASS} #playlistbar,
    body.${DRIVE_CLASS} #keytips,
    body.${DRIVE_CLASS} #mode,
    body.${DRIVE_CLASS} #driftlive {
      opacity: 0 !important;
      pointer-events: none !important;
      transition: opacity 520ms ease !important;
    }

    /* slowroads 重排：驾驶态不再用旧的右下 cluster（speed/gear），
       改由 #srDist / #srSpeed / #srAuto 接管。cluster 仅作数据载体。 */
    body.${DRIVE_CLASS} #cluster {
      display: none !important;
    }

    /* scorechip / racebox 只在竞速态显示；其他一律强隐（garage/free 也彻底隐） */
    #scorechip { display: none !important; }
    #racebox { display: none !important; }
    body.${DRIVE_CLASS}.${RACING_CLASS} #scorechip,
    body.${DRIVE_CLASS}.${RACING_CLASS} #racebox {
      display: block !important;
    }

    /* 进入驾驶态前几秒，键位条做一次极弱的呼吸提示后自动归零，不常驻 */
    body.${DRIVE_CLASS}.${HINT_CLASS} #keytips {
      opacity: .28 !important;
    }

    body.${DRIVE_CLASS} #minimap {
      opacity: .42 !important;
      width: 96px !important;
      height: 96px !important;
      bottom: 26px !important;
      left: 26px !important;
      background: rgba(12,16,24,.22) !important;
      border-color: rgba(255,255,255,.10) !important;
      backdrop-filter: blur(10px) saturate(1.25) !important;
      -webkit-backdrop-filter: blur(10px) saturate(1.25) !important;
      transition: opacity 300ms ease, transform 300ms ease !important;
    }

    body.${DRIVE_CLASS} #minimap:hover {
      opacity: .9 !important;
    }

    body.${DRIVE_CLASS} #msg {
      font-weight: 500 !important;
      letter-spacing: .5px !important;
      text-shadow: 0 8px 36px rgba(0,0,0,.42) !important;
    }

    /* [PERF1] UltraLite：关 minimap / 电台（播放列表）/ 复杂 HUD，只保驾驶最基础读数。 */
    body.p1-ultralite #minimap,
    body.p1-ultralite #playlistbar,
    body.p1-ultralite #plbar,
    body.p1-ultralite #radio,
    body.p1-ultralite #skillstack,
    body.p1-ultralite #scorechip,
    body.p1-ultralite #driftlive {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

export function updateMinimalDriveHud(appState, racePhase, dt = 0) {
  if (!installed) return;
  const isDrive = appState === 'drive';
  const isRacing = isDrive && racePhase && racePhase !== 'free';

  document.body.classList.toggle(DRIVE_CLASS, isDrive);
  document.body.classList.toggle(RACING_CLASS, !!isRacing);

  if (isDrive && lastMode !== 'drive') {
    // 刚进入驾驶态给一次短暂提示，随后自动安静。
    hintTimer = 3.5;
  }
  lastMode = appState;

  if (hintTimer > 0) {
    hintTimer -= dt;
    document.body.classList.add(HINT_CLASS);
  } else {
    document.body.classList.remove(HINT_CLASS);
  }
}

// ---------- [PERF0] 性能 HUD（?perfdebug=1）----------
// 显示 fps / render.calls / render.triangles / memory.geometries / memory.textures /
// pixelRatio / shadowMap size / bloom on/off / CubeReflection on/off / SafeMode on/off / preload duration。
let _perfEl = null;
let _perfInstalled = false;
let _perfLastT = 0, _perfFrames = 0, _perfFps = 0;

export function installPerfHud() {
  if (_perfInstalled) return;
  _perfInstalled = true;
  const el = document.createElement('div');
  el.id = 'perf-hud';
  el.style.cssText = [
    'position:fixed', 'top:8px', 'right:8px', 'z-index:99999',
    'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    'color:#9fe7b0', 'background:rgba(8,12,18,.82)', 'padding:8px 10px',
    'border:1px solid rgba(120,200,150,.35)', 'border-radius:8px',
    'white-space:pre', 'pointer-events:none', 'min-width:188px',
    'text-shadow:0 1px 2px rgba(0,0,0,.6)'
  ].join(';');
  el.textContent = 'perf hud…';
  document.body.appendChild(el);
  _perfEl = el;
  _perfLastT = performance.now();
}

export function updatePerfHud() {
  if (!_perfInstalled || !_perfEl) return;
  // fps：每 0.5 秒采样一次
  _perfFrames++;
  const now = performance.now();
  if (now - _perfLastT >= 500) {
    _perfFps = Math.round((_perfFrames * 1000) / (now - _perfLastT));
    _perfFrames = 0; _perfLastT = now;
  }
  let info = null;
  try { info = renderer.info; } catch (e) {}
  const r = info ? info.render : {};
  const m = info ? info.memory : {};
  // [PERF1b] draw calls / triangles 读真实主场景快照（core.js 在主 RenderPass 后写入），
  //   不再读 finalComposer 跑完后的最后一个全屏小 pass（那是假数据 calls:1）。
  const sri = G._sceneRenderInfo || {};
  const realCalls = sri.calls != null ? sri.calls : r.calls;
  const realTris = sri.triangles != null ? sri.triangles : r.triangles;
  // [PERF1] 预算分项：车/世界/地形/树/HUD/特效 + CPU updateMs vs renderMs 拆分。
  const b = worldBudget();
  const caps = budgetCaps();
  const reflMode = b.carReflectionMode + (G._reflectionLive ? '·live' : '');
  const lines = [
    'FPS         : ' + _perfFps,
    'tier        : ' + (G.perfTier || '?') + (G.safeMode ? ' (safe)' : ''),
    'updateMs    : ' + (PERF.updateMs != null ? PERF.updateMs.toFixed(2) : '?'),
    'renderMs    : ' + (PERF.renderMs != null ? PERF.renderMs.toFixed(2) : '?'),
    'frameMs     : ' + ((PERF.updateMs != null && PERF.renderMs != null) ? (PERF.updateMs + PERF.renderMs).toFixed(2) : '?'),
    'bottleneck  : ' + (PERF.renderMs > PERF.updateMs ? 'GPU(render)' : 'CPU(update)'),
    'pixelRatio  : ' + (PERF.pixelRatio || (renderer.getPixelRatio && renderer.getPixelRatio()) || '?'),
    'draw calls  : ' + (realCalls != null ? realCalls : '?'),
    'triangles   : ' + (realTris != null ? realTris.toLocaleString() : '?'),
    'geometries  : ' + (m.geometries != null ? m.geometries : '?'),
    'textures    : ' + (m.textures != null ? m.textures : '?'),
    '--- budget ---',
    'carQuality  : ' + b.carQuality,
    'carReflect  : ' + reflMode,
    'worldQuality: ' + b.worldQuality,
    'terrainQual : ' + b.terrainQuality,
    'treeBudget  : ' + (b.targetTrees > 0 ? b.targetTrees + '/' + b.targetBushes : 'off'),
    'cap tex/geo : <' + caps.textures + ' / <' + caps.geometries,
    'effectBudget: ' + b.effectBudget,
    'hudBudget   : ' + b.hudBudget,
    '--- engine ---',
    'shadowMap   : ' + (PERF.shadowSize || (renderer.shadowMap && renderer.shadowMap.enabled ? '?' : 'off')),
    'bloom       : ' + (PERF.bloomOn ? 'ON' : 'off'),
    'preload(ms) : ' + (PERF.preloadMs || 0)
  ];
  _perfEl.textContent = lines.join('\n');
}
