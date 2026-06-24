import * as THREE from 'three';
import { G, scene, camera, renderer, composer, finalComposer, bloomComposer, selectiveBloomRender, sun, rim, FASTDEBUG } from './core.js';
import { PERF, PERF_DEBUG, isSafeMode, isUltraLite, worldBudget, maxPixelRatioFor, setTier } from './perfMode.js';
import { curSunDir, env, buildTerrain, buildRoad, buildScenery, buildEnv, applyTod, groundHeight, windU, oceanUniforms, samples, nearestRoad, NS, HALF_W } from './world.js';
// [task-20260620-001 回滚] buildRoadJunctionPass 调用已禁用，导入一并注释避免 unused
// import { buildRoadJunctionPass } from './roadJunctionPass.js';
import { state, physics, updateChaseCamera, setGlassSeeThru, settleCarPose, coastVehicle, updateCarReflection } from './vehicle.js';
import { buildCharacter, characterUpdate, characterCamera, characterPreviewUpdate, charState } from './character.js';
import { buildSkyCycle, skyCycleUpdate, setTimeScale, getTimeScale } from './skycycle.js';
import { race, raceUpdate, gameplayUpdate, buildProps, fmt, cps, cpGroupAll, arrow, arrowPivot, raceBestText } from './gameplay.js';
import { audioUpdate } from './audio.js';
import { initFX, fxUpdate } from './fx.js';
import { showMsg, keys as keysRef, pauseGame, resumeGame, controls, drawMinimap, setQuality, enterGarage, startDrive, initUI, elSpeed, elMode, elNitro, elGear, gArc, gLen, elLap, elCp, elBest } from './ui.js';
import { preloadCriticalAssets, preloadLazyAssets } from './assetPreload.js';
import { installMinimalDriveHud, updateMinimalDriveHud, installPerfHud, updatePerfHud } from './p0Hud.js';
import { installHmiDrivingHud, updateHmiDrivingHud } from './hmiDrivingHud.js';
import { VIEWPOINTS, getViewpoint } from './viewpoints.js';

const PERF_HUD_ON = PERF_DEBUG;

// ---------- HMI Route Preview 辅助（读取只读 samples / NS / nearestRoad，不改 world.js）----------
// 算法：以 state.pos 为输入，找到最近主路 sample index，递增/递减取前方 ~32 个点，
//   转成车辆相对坐标（减 state.pos / 按 -state.heading 旋转）。
// 输出 [{x, z}, ...]，环线取模 NS。不动 world.js、不接 autosteer、不做路径规划。
const _routeOut = [];
// 最近点 index 迟滞：缓存上一帧起点 index，避免 nearest 在两个采样点间反复横跳导致路线整体抖。
// 只有当新候选点比「沿用上一帧 index」明显更近（距离差超过 HYST_M）时才切换，否则沿用，保证起点逐帧连续。
let _prevBi = -1;
function computeRoutePreview(pos, heading) {
  if (!samples || !samples.length) return null;
  let bi = -1;
  try {
    const nr = nearestRoad ? nearestRoad(pos.x, pos.z) : null;
    if (nr && typeof nr.idx === 'number') bi = nr.idx;
  } catch (e) { bi = -1; }
  if (bi < 0) {
    let best = Infinity;
    for (let i = 0; i < NS; i++) {
      const s = samples[i];
      const dx = s.x - pos.x, dz = s.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bi = i; }
    }
  }
  if (bi < 0) { _prevBi = -1; return null; }
  // —— 起点 index 迟滞 ——
  // 若上一帧 index 仍有效且与新候选相距很近（环线意义上 ≤ 2 个采样格），
  // 则比较两者到车的真实距离：只有新候选明显更近（差 > HYST_M 米）才切换，否则沿用上一帧 index。
  // 这样起点不会在相邻采样点之间来回横跳，路线整体逐帧连续。
  if (_prevBi >= 0 && _prevBi < NS) {
    let gap = Math.abs(bi - _prevBi);
    gap = Math.min(gap, NS - gap); // 环线最短间隔
    if (gap <= 2) {
      const HYST_M = 1.2; // 迟滞阈值（米）：新点需比旧点近这么多才切换
      const sp0 = samples[_prevBi], sp1 = samples[bi];
      const dPrev = Math.hypot(sp0.x - pos.x, sp0.z - pos.z);
      const dNew = Math.hypot(sp1.x - pos.x, sp1.z - pos.z);
      if (dPrev - dNew <= HYST_M) bi = _prevBi; // 没明显更近 → 沿用旧 index
    }
  }
  _prevBi = bi;
  const cosH = Math.cos(heading), sinH = Math.sin(heading);
  // 车辆坐标系（约定见 vehicle.js:328）：forward = (sin h, cos h)、LEFT = (cos h, -sin h) ⇒ RIGHT = (-cos h, sin h)。
  // lx = RIGHT 偏移（右为正，配合 HUD mapPt 右映射）、lz = forward 距离。
  // 判断 next sample 的 lz 是正 → 递增，否则递减。
  const nextI = (bi + 1) % NS;
  const ndx = samples[nextI].x - pos.x, ndz = samples[nextI].z - pos.z;
  const nlz = ndx * sinH + ndz * cosH;
  const dirSign = nlz >= 0 ? 1 : -1;
  // 按固定弧长间隔取点（不再按 sample index 直接跳），让点分布稳定、不随 index 跳变抖动。
  // 沿主路方向累积真实弧长，每跨过 STEP_M 记一个中心点；取到 FORWARD_M 为止。
  _routeOut.length = 0;
  const STEP_M = 6;        // 固定取点间隔（米）
  const FORWARD_M = 120;   // 前向总距离（米）
  const COUNT = Math.floor(FORWARD_M / STEP_M) + 1;
  let acc = 0;             // 已累积弧长
  let nextMark = 0;        // 下一个记点弧长阈值
  // 先把车体处（acc=0）这个点放进去，保证近端贴车。
  {
    const s0 = samples[bi];
    const dx = s0.x - pos.x, dz = s0.z - pos.z;
    _routeOut.push({ x: dz * sinH - dx * cosH, z: dx * sinH + dz * cosH });
    nextMark = STEP_M;
  }
  // 沿路径前进，逐段累积弧长，按固定间隔插值取点。
  let guard = NS; // 防止环线死循环
  let idx = bi;
  while (_routeOut.length < COUNT && guard-- > 0) {
    const ni = ((idx + dirSign) % NS + NS) % NS;
    const a = samples[idx], b = samples[ni];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (segLen > 1e-4) {
      // 当前段覆盖 [acc, acc+segLen]，记下落在该段内的所有固定弧长标记点。
      while (nextMark <= acc + segLen && _routeOut.length < COUNT) {
        const f = (nextMark - acc) / segLen;
        const sx = a.x + (b.x - a.x) * f;
        const sz = a.z + (b.z - a.z) * f;
        const dx = sx - pos.x, dz = sz - pos.z;
        _routeOut.push({ x: dz * sinH - dx * cosH, z: dx * sinH + dz * cosH });
        nextMark += STEP_M;
      }
      acc += segLen;
    }
    idx = ni;
  }
  return _routeOut;
}

// ---------- 主循环 ----------
let last = performance.now(), frame = 0;
let fpsAcc = 0, fpsN = 0, autoDropped = false;
// [PERF1b] 自适应升降档梯（运行期调渲染开销杠杆，不动基础车漆/车身模型/公路贴图）。
//   升/降只调：反射频率、bloom、阴影分辨率、pixelRatio（setQuality 内部）。
//   梯子：ultralite < safe < medium < high。启动后先采样 ~4s 再允许调整。
const _ADAPT_LADDER = ['ultralite', 'safe', 'medium', 'high'];
let _adaptSampleStart = 0;       // 启动采样起点（0=未开始）
let _adaptLastChange = 0;        // 上次档位变更时间（冷却用）
let _adaptHighFpsSince = 0;      // 持续高帧起点（升档需持续 10s）
const _ADAPT_COOLDOWN = 6000;    // 档位变更冷却 6s，不频繁跳档
const _ADAPT_WARMUP = 4000;      // 启动 4s 采样期不调档
let loopErrCount = 0, slowFrames = 0;
function loop() {
  requestAnimationFrame(loop);
  const t0 = performance.now();
  try {
    loopBody();
    loopErrCount = 0; // 正常帧即清零：只有持续异常才提示
  } catch (err) {
    // 自愈：异常只丢当前帧，不冻死游戏；连续异常时提示玩家
    loopErrCount++;
    if (loopErrCount === 1 || loopErrCount % 300 === 0) console.error('[loop]', err);
    if (loopErrCount === 30) showMsg('检测到异常已自动恢复，如持续请按 T 复位', 2500, 22);
  }
  // 看门狗：连续超长帧 → 紧急刹停失控状态
  if (performance.now() - t0 > 350) {
    slowFrames++;
    if (slowFrames >= 3) {
      slowFrames = 0;
      state.vx = 0; state.vz = 0; state.speed = 0; state.vyAir = 0;
      for (const k in keysRef) keysRef[k] = false;
      showMsg('检测到卡顿，已自动恢复', 2000, 24);
    }
  } else slowFrames = 0;
}
// —— 手柄（标准映射：左摇杆转向 / RT 油门 / LT 刹车 / A 漂移 / B·RB 性能 / Y 视角 / Start 暂停）
let padPrev = [];
function pollGamepad() {
  const gp = navigator.getGamepads && navigator.getGamepads()[0];
  const pad = G.pad;
  pad.active = false;
  if (!gp) return;
  const dz = (v) => Math.abs(v) > 0.12 ? v : 0;
  pad.steer = dz(gp.axes[0] || 0);
  pad.throttle = gp.buttons[7] ? gp.buttons[7].value : 0;
  pad.brake = gp.buttons[6] ? gp.buttons[6].value : 0;
  pad.drift = !!(gp.buttons[0] && gp.buttons[0].pressed);
  pad.boost = !!((gp.buttons[1] && gp.buttons[1].pressed) || (gp.buttons[5] && gp.buttons[5].pressed));
  if (pad.steer || pad.throttle > 0.05 || pad.brake > 0.05 || pad.drift || pad.boost) pad.active = true;
  const edge = (i) => gp.buttons[i] && gp.buttons[i].pressed && !padPrev[i];
  if (edge(3) && G.appState === 'drive') G.camMode = (G.camMode + 1) % 5;
  if (edge(9)) {
    if (G.appState === 'drive') pauseGame();
    else if (G.appState === 'pause') resumeGame();
  }
  padPrev = gp.buttons.map(b => b.pressed);
}

function loopBody() {
  const _frameT0 = performance.now();
  pollGamepad();
  const now = performance.now();
  const dt = Math.min((now - last)/1000, 0.05);
  last = now;

  if (G.waterOK && oceanUniforms.normalMap.value) { const off = oceanUniforms.normalOffset.value; off.x += dt*0.012; off.y += dt*0.008; } // 法线滚动 → 动态波纹

  let onRoad = true, boost = false;
  // 仅座舱视角玻璃透明，其余视角保持原厂深色玻璃
  setGlassSeeThru(G.appState === 'drive' && G.camMode === 3);
  if (G.appState === 'drive') {
    const r = physics(dt);
    onRoad = r.onRoad; boost = r.boost;
    raceUpdate();
    gameplayUpdate(dt, onRoad);
    // 视觉验收机位（?vp=N / 自检）：隐藏竞速门架 + 路线任务点光柱/文字标牌，
    // 否则静态机位会把 gameplay 标记（如绿色“跨谷挑战”光柱）拍进路边地编验收图。
    // 仅 viewpointMode 下生效，正常驾驶不受影响；不改 gameplay 逻辑本身。
    if (G.viewpointMode) hideRouteMarkersForViewpoint();
    // 本次驾驶累积里程（米）：slowroads 左下 KILOMETERS 读数
    if (!isFinite(state.distance)) state.distance = 0;
    state.distance += Math.abs(state.speed) * dt;
    fxUpdate(dt, onRoad, boost);
    if (G.fastdebugLockCam) {
      // FASTDEBUG：保持静态俰视，不让追车相机接管
    } else {
      updateChaseCamera(dt, boost);
    }
  } else if (G.appState === 'walk') {
    // 步行模式：角色控制器接管；无人车自然滚停
    characterUpdate(dt);
    characterCamera(dt);
    coastVehicle(dt);
  } else {
    // 暂停时不更新轨道控制器，否则相机会被拉回旧的环绕目标点
    if (G.appState !== 'pause') {
      controls.update();
      const gyC = Math.max(groundHeight(camera.position.x, camera.position.z), 0.1);
      if (camera.position.y < gyC + 0.45) camera.position.y = gyC + 0.45;
    }
    if (G.appState === 'garage') characterPreviewUpdate(dt); // 车库选人：推进站立 idle
  }
  audioUpdate();
  skyCycleUpdate(dt); // 动态天空/天气循环（接管太阳/雾/曝光/反射）
  updateMinimalDriveHud(G.appState, race.phase, dt);
  // slowroads 式驾驶 HUD：左下里程 / 右下时速+档位 / 底部 autosteer 占位
  const gear = state.speed < -0.5 ? 'R' : (Math.abs(state.speed) < 0.5 ? 'N' : 'D');
  // 路线预览：基于 world.js 只读 samples 算出车前方一段主路中心线点（车相对系）。
  // 不改 world.js、不做路径规划、不接 autosteer。只为 HMI 视觉路线预览服务。
  let routePts = null;
  if (G.appState === 'drive' && samples && samples.length) {
    routePts = computeRoutePreview(state.pos, state.heading);
  }
  updateHmiDrivingHud(Math.abs(state.speed) * 3.6, state.distance || 0, race.phase, gear, routePts, HALF_W);

  // [PERF0] 删除原“低速拉 DPR 到 1.5”逻辑：在 Mac 上低速拉高 DPR 反而卡，且频繁重建 RT。
  // 现在像素比只由档位决定（setQuality / Auto 升降级），不再按车速动态拉高。

  // 阴影/补光跟随焦点：步行时跟角色，否则跟车
  const focus = G.appState === 'walk' ? charState.pos : state.pos;
  sun.position.copy(focus).addScaledVector(curSunDir, 220);
  sun.target.position.copy(focus);
  rim.position.copy(focus).add(new THREE.Vector3(-curSunDir.x*120, 60, -curSunDir.z*120));
  rim.target.position.copy(focus);

  const t = now*0.001;
  windU.value = t;
  if (cpGroupAll.visible) cps.forEach((g,i)=>{ g.children[2].position.y = g.userData.pos.y + 5.6 + Math.sin(t*2+i)*0.25; });
  arrow.position.y = Math.sin(t*4)*0.15;

  // 云漂移 / 灯塔光束 / 萤火虫闪烁
  if (env.clouds) {
    for (const c of env.clouds) { c.position.x += c.userData.vx*dt; if (c.position.x > 1700) c.position.x = -1700; }
    if (env.beamGrp.visible) env.beamGrp.rotation.y = t*0.7;
    if (env.fireflies.visible) env.fireflies.material.opacity = 0.55 + 0.35*Math.sin(t*2.1);
  }

  if (G.appState === 'drive' && frame++ % 3 === 0) {
    const kmh = Math.abs(state.speed)*3.6;
    elSpeed.textContent = Math.round(kmh);
    if (gArc) gArc.style.strokeDashoffset = gLen * (1 - Math.min(kmh/280, 1));
    elGear.textContent = state.speed < -0.5 ? 'R' : (Math.abs(state.speed) < 0.5 ? 'N' : 'D');
    if (elNitro) elNitro.style.width = (state.nitro*100).toFixed(0) + '%';
    const ff = document.getElementById('flowfill');
    if (ff) ff.style.width = (state.flow*100).toFixed(0) + '%';
    elMode.innerHTML = race.phase === 'free'
      ? '🏝️ 自由漫游 · 小地图彩点 = 路线起点 · <b>R</b> 竞速' + (onRoad ? '' : ' · <span style="color:#ffcc66">越野中</span>')
      : '🏁 竞速赛 · <b>R</b> 退出 · <b>ESC</b> 菜单';
    if (race.phase === 'racing') {
      elLap.textContent = fmt(race.time);
      elCp.textContent = race.route.name + ' · ' + race.ti + ' / ' + race.targets.length;
      elBest.textContent = raceBestText();
    }
    drawMinimap();
  }
  if (G.appState !== 'pause' && G.appState !== 'photo') updateCarReflection(); // 反射探针（仅车库/照片模式）
  // [PERF1] CPU/GPU 拆分：update 段（以上逻辑/物理/反射探针）耗时 vs render 段（selectiveBloomRender）耗时。
  //   定位 CPU 端（世界 update / 物理 / 探针）还是 GPU 端（draw calls / fill rate）瓶颈。
  const _renderT0 = performance.now();
  PERF.updateMs = _renderT0 - _frameT0;
  selectiveBloomRender();
  PERF.renderMs = performance.now() - _renderT0;
  // [PERF0] 性能 HUD（?perfdebug=1）
  if (PERF_HUD_ON) { PERF.bloomOn = !!G.bloomActive; PERF.reflectionOn = G._reflectionLive; PERF.pixelRatio = renderer.getPixelRatio(); updatePerfHud(); }
  // [PERF1b] 自适应升降档梯：启动 ~4s 采样，fps<20 降一档，>50 持续 10s 升一档，有冷却。
  //   只在 drive/garage 调；不动基础车漆（setQuality 只调渲染杠杆）。
  fpsAcc += dt; fpsN++;
  const _nowA = performance.now();
  if (_adaptSampleStart === 0) _adaptSampleStart = _nowA;
  if (fpsAcc > 1.5) {
    const avg = fpsN / fpsAcc;
    const inAdaptState = (G.appState === 'drive' || G.appState === 'garage');
    const warmedUp = (_nowA - _adaptSampleStart) > _ADAPT_WARMUP;
    const cooled = (_nowA - _adaptLastChange) > _ADAPT_COOLDOWN;
    // URL 强制档（url-force / url-quality）不受自适应干预，保证验收链接稳定。
    const urlForced = (PERF.reason === 'url-force' || PERF.reason === 'url-quality');
    if (warmedUp && inAdaptState && cooled && !urlForced) {
      const cur = _ADAPT_LADDER.indexOf(G.perfTier);
      if (avg < 20 && cur > 0) {
        // 降一档
        setQuality(_ADAPT_LADDER[cur - 1]);
        _adaptLastChange = _nowA; _adaptHighFpsSince = 0;
        showMsg('帧率偏低，已自动降一档画质以保流畅（车漆/车身不变）', 2200, 22);
      } else if (avg > 50 && cur >= 0 && cur < _ADAPT_LADDER.length - 1) {
        // 持续高帧 10s 才升一档
        if (_adaptHighFpsSince === 0) _adaptHighFpsSince = _nowA;
        else if (_nowA - _adaptHighFpsSince > 10000) {
          setQuality(_ADAPT_LADDER[cur + 1]);
          _adaptLastChange = _nowA; _adaptHighFpsSince = 0;
        }
      } else {
        _adaptHighFpsSince = 0; // 中间区间：维持
      }
    }
    fpsAcc = 0; fpsN = 0;
  }
}

// ---------- 视觉验收点跳转（task-20260620-003）----------
// 让 VIK 在浏览器内一键跳到第 N 个固定机位截图，不改任何视觉/几何，仅摆相机+车+TOD。
// 视觉验收机位下隐藏 gameplay 路线标记（竞速门架 + 任务点光柱/文字牌）。
// 这些是驾驶中有意义的 gameplay UI，但会污染 PR4.1 路边地编静态验收图。
// 不改 gameplay.js 逻辑：只在 viewpointMode 下从 scene 里找到该组并置隐（懒查缓存）。
let _vpRouteMarkerGrp = null, _vpMarkerSearched = false;
function hideRouteMarkersForViewpoint() {
  try {
    if (cpGroupAll) cpGroupAll.visible = false;
    if (!_vpMarkerSearched) {
      _vpMarkerSearched = true;
      // 任务点组：含文字 Sprite 的顶层 scene 子组（非 cpGroupAll）。
      for (const child of scene.children) {
        if (child === cpGroupAll || !child.isGroup) continue;
        let hasSprite = false;
        child.traverse((o) => { if (o.isSprite) hasSprite = true; });
        if (hasSprite && child.children.length && child.children[0].isGroup) { _vpRouteMarkerGrp = child; break; }
      }
    }
    if (_vpRouteMarkerGrp) _vpRouteMarkerGrp.visible = false;
  } catch (e) {}
}

// 触发：URL ?vp=N（1~8），或运行时按数字键 1~8。
function jumpToViewpoint(id) {
  const vp = getViewpoint(id);
  if (!vp) { console.warn('[viewpoint] 无此验收点 id=', id); return; }
  try {
    G.viewpointMode = true; // 静态验收机位：后续帧隐藏 gameplay 路线标记
    if (G.appState !== 'drive') { try { startDrive(false); } catch (e) {} }
    // 关闭动态天气，让静态 TOD preset 可复现
    G.weatherOn = false;
    applyTod(vp.tod);
    // 摆车（贴地）
    state.pos.set(vp.carPos.x, vp.carPos.y, vp.carPos.z);
    state.vx = 0; state.vz = 0; state.speed = 0; state.vyAir = 0;
    // 车头朝向 lookAt 水平方向
    const hx = vp.lookAt.x - vp.carPos.x, hz = vp.lookAt.z - vp.carPos.z;
    state.heading = Math.atan2(hx, hz);
    settleCarPose();
    // 摆相机并锁定（不让追车相机接管），方便静态对比截图
    camera.position.set(vp.camPos.x, vp.camPos.y, vp.camPos.z);
    camera.lookAt(vp.lookAt.x, vp.lookAt.y, vp.lookAt.z);
    camera.updateProjectionMatrix();
    G.fastdebugLockCam = true;
    showMsg('验收点 #' + vp.id + ' · ' + vp.label + ' · ' + vp.tod + ' — ' + vp.focus, 4000, 20);
    console.log('[viewpoint] jumped to', vp.id, vp.name, vp);
  } catch (e) { console.warn('[viewpoint] jump failed:', e); }
}
// 读取 URL ?vp=N（1~8）；无则返回 null。boot 流程据此决定是否跳过车库直接进 drive。
function getUrlViewpointId() {
  try {
    const vpq = new URLSearchParams(location.search).get('vp');
    if (vpq && getViewpoint(vpq)) return vpq;
  } catch (e) {}
  return null;
}

// 等待世界 / drive 就绪（samples 已生成），再执行回调；有上限不无限轮询。
function whenWorldReady(cb, { maxTries = 120, interval = 50 } = {}) {
  let tries = 0;
  const tick = () => {
    const ready = samples && samples.length > 0;
    if (ready || tries >= maxTries) {
      if (!ready) console.warn('[viewpoint] world not ready after wait, applying anyway');
      cb();
      return;
    }
    tries++;
    setTimeout(tick, interval);
  };
  tick();
}

// 线上 ?vp=N 入口：跳过车库菜单，等世界就绪后先 startDrive 再 jumpToViewpoint。
// 顺序很关键：先 startDrive(false) 进 drive，再 apply VP，避免被 startDrive 的默认出生点覆盖。
function enterViewpointFromUrl(vpq) {
  whenWorldReady(() => {
    try { startDrive(false); } catch (e) { console.warn('[viewpoint] startDrive failed:', e); }
    jumpToViewpoint(vpq);
  });
}

function installViewpointJump() {
  // 数字键 1~8 跳转（运行时随时可用）
  addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key >= '1' && e.key <= '8') jumpToViewpoint(e.key);
  });
  // 暴露给截图脚本 / 控制台
  window.__jumpToViewpoint = jumpToViewpoint;
  window.__VIEWPOINTS = VIEWPOINTS;
  // [PERF1] 无头性能探针（仅 perfdebug）：供 scripts/perf-probe.mjs 读场景资产数量/draw calls/CPU拆分。
  if (PERF_HUD_ON) {
    window.__perfStartDrive = () => { try { startDrive(false); } catch (e) {} };
    window.__perfProbe = () => {
      let trees = 0, bushes = 0, instTotal = 0, meshes = 0, instanced = 0;
      scene.traverse((o) => {
        if (o.isInstancedMesh) { instanced++; instTotal += o.count || 0; }
        else if (o.isMesh) meshes++;
      });
      // 真实 draw calls：renderer.info 每次 render 重置，直接强制一次主场景渲染后读。
      renderer.render(scene, camera);
      const info = renderer.info;
      return {
        tier: G.perfTier, safeMode: G.safeMode, ultraLite: !!G.ultraLite,
        budget: worldBudget(),
        counts: { sceneChildren: scene.children.length, meshes, instancedMeshes: instanced, instancedTotal: instTotal },
        info: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures },
        perf: { updateMs: +PERF.updateMs.toFixed(2), renderMs: +PERF.renderMs.toFixed(2), pixelRatio: PERF.pixelRatio, shadowSize: PERF.shadowSize, bloomOn: PERF.bloomOn, reflectionLive: G._reflectionLive }
      };
    };
  }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  finalComposer.setSize(innerWidth, innerHeight);
  bloomComposer.setSize(Math.round(innerWidth/2), Math.round(innerHeight/2));
});

// 时间加速快捷键：+ 加速 ×2（最高 ×120），- 减速回 ×1
addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') {
    const cur = getTimeScale();
    setTimeScale(cur >= 120 ? 120 : cur * 2);
  } else if (e.key === '-' || e.key === '_') {
    setTimeScale(1);
  }
});

// ---------- 分阶段异步启动：让出主线程刷新进度，消除首访资源竞态 ----------
(async () => {
  const elBT = document.getElementById('boottext');
  const elBF = document.getElementById('bootfill');
  const elTip = document.getElementById('boottip');
  const stage = async (label, pct, fn) => {
    elBT.textContent = label;
    elBF.style.width = pct + '%';
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    return await fn();
  };

  try {
    await stage('预热首访核心资源…', 12, () => preloadCriticalAssets((done, total, url) => {
      elBT.textContent = `预热首访核心资源… ${done}/${total}`;
      elBF.style.width = (4 + done / total * 8).toFixed(1) + '%';
      if (elTip) elTip.textContent = '正在准备：' + url;
    }));
    // [PERF0] 地形按档位构建：Safe 走低成本分支（segment 200 / 不走 road mask）。
    await stage('构建岛屿地形…', 24, () => buildTerrain({ quality: isSafeMode() ? 'safe' : 'high' }));
    await stage('铺设海岸公路…', 45, buildRoad);
    // [task-20260620-001 回滚] 禁用路口缝合 pass，回滚到完整可玩道路
    // await stage('修补公路分叉…', 48, buildRoadJunctionPass);
    // [PERF0] Safe 档：首屏不构建森林/草（trees.json+bin+6 树贴图），改为进游戏后延迟加载，
    // 让页面先打开、车先出现、路先能开。
    if (!isSafeMode()) {
      await stage('生成程序化森林…', 68, buildScenery);
    }
    await stage('布置灯塔与环境…', 76, buildEnv);
    await stage('搭建海滩建筑与道具…', 88, buildProps);
    // [PERF0] Safe 档：不预加载步行角色（character.glb/iron.glb），需要时（切步行）再加。
    if (!isSafeMode()) {
      await stage('唤醒步行角色…', 92, buildCharacter);
    }
    await stage('载入动态天空…', 95, buildSkyCycle);
    elBT.textContent = '点火启动…';
    elBF.style.width = '100%';
    if (elTip) elTip.textContent = '资源就绪，正在进入车库…';
    await new Promise(r => requestAnimationFrame(r));
    initUI();
    installMinimalDriveHud();
    if (PERF_HUD_ON) installPerfHud();
    installHmiDrivingHud();
    installViewpointJump();
    initFX();
    settleCarPose();
    applyTod(G.curTod);
    setQuality(G.perfTier || (G.hiQuality ? 'high' : 'auto'));
    // 线上 ?vp=N（N=1~8，无需 fastdebug）：跳过车库菜单，世界就绪后自动进 drive 并应用该验收点。
    const urlVp = getUrlViewpointId();
    if (urlVp) {
      enterViewpointFromUrl(urlVp);
    } else {
      enterGarage();
    }
    loop();
    // FASTDEBUG：自动跳过车库菜单直接进驾驶，并把相机放到路面上方俰视，方便无头直接截到 3D 路面
    // 注意：若 URL 已带 ?vp=N，则由 enterViewpointFromUrl 负责机位，不再用俯视相机覆盖。
    if (FASTDEBUG && !urlVp) {
      try {
        startDrive(false);
        // 把相机抬到车辆（起始位于路面）正上方俰视，看得到地形/路
        const cp = state.pos;
        camera.position.set(cp.x + 6, cp.y + 28, cp.z + 6);
        camera.lookAt(cp.x, cp.y, cp.z);
        camera.updateProjectionMatrix();
        // 抑制帧率自适应降质提示 / 保持静态俯视：直接锁住相机不跟车
        G.fastdebugLockCam = true;
        console.log('[FASTDEBUG] auto-entered drive, overhead camera at junction/road');
      } catch (e) { console.warn('[FASTDEBUG] auto-enter failed:', e); }
    }
    requestAnimationFrame(() => {
      const b = document.getElementById('boot');
      if (b) b.remove();
    });

    // [PERF0/PERF1] Safe 档延迟加载：页面已可操作后再在后台加载森林 + 步行角色。
    //   UltraLite：不延迟构森林（worldQuality=off）、不加步行角色/Iron——只车/路/地形/天空。
    if (isSafeMode()) {
      const lazy = async () => {
        if (isUltraLite()) {
          console.log('[PERF1] UltraLite：跳过延迟 buildScenery + buildCharacter（只车/路/地形/天空）');
          return;
        }
        try { await preloadLazyAssets(); } catch (e) { console.warn('[PERF0] lazy preload failed:', e); }
        try { await buildScenery(); console.log('[PERF1] lazy buildScenery done (safe budget)'); }
        catch (e) { console.warn('[PERF1] lazy buildScenery failed:', e); }
        try { await buildCharacter(); console.log('[PERF0] lazy buildCharacter done'); }
        catch (e) { console.warn('[PERF0] lazy buildCharacter failed:', e); }
      };
      // 等几帧让首屏稳定（避免与进驾驶的初始帧抢带宽/主线程）。
      setTimeout(() => { lazy(); }, 1200);
    }
  } catch (err) {
    console.error('[boot fatal]', err);
    elBT.textContent = '关键资源加载失败，请刷新重试';
    elBF.style.width = '100%';
    if (elTip) {
      elTip.textContent = err && err.message ? err.message : String(err);
      elTip.style.color = '#ffb3b3';
      elTip.style.opacity = '0.9';
    }
  }
})();
