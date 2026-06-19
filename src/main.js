import * as THREE from 'three';
import { G, scene, camera, renderer, composer, finalComposer, bloomComposer, selectiveBloomRender, sun, rim, FASTDEBUG } from './core.js';
import { curSunDir, env, buildTerrain, buildRoad, buildScenery, buildEnv, applyTod, groundHeight, windU, oceanUniforms } from './world.js';
import { buildRoadJunctionPass } from './roadJunctionPass.js';
import { state, physics, updateChaseCamera, setGlassSeeThru, settleCarPose, coastVehicle, updateCarReflection } from './vehicle.js';
import { buildCharacter, characterUpdate, characterCamera, characterPreviewUpdate, charState } from './character.js';
import { buildSkyCycle, skyCycleUpdate, setTimeScale, getTimeScale } from './skycycle.js';
import { race, raceUpdate, gameplayUpdate, buildProps, fmt, cps, cpGroupAll, arrow, arrowPivot, raceBestText } from './gameplay.js';
import { audioUpdate } from './audio.js';
import { initFX, fxUpdate } from './fx.js';
import { showMsg, keys as keysRef, pauseGame, resumeGame, controls, drawMinimap, setQuality, enterGarage, startDrive, initUI, elSpeed, elMode, elNitro, elGear, gArc, gLen, elLap, elCp, elBest } from './ui.js';
import { preloadCriticalAssets } from './assetPreload.js';
import { installMinimalDriveHud, updateMinimalDriveHud } from './p0Hud.js';

// ---------- 主循环 ----------
let last = performance.now(), frame = 0;
let fpsAcc = 0, fpsN = 0, autoDropped = false;
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

  // 动态像素比（车近景更清晰）：停车/低速拉到 1.5 看清车身细节，高速降到 1.2 保帧；
  // 4/10 双阈值迟滞，避免在临界速度反复重建渲染目标
  if (G.hiQuality && G.appState === 'drive') {
    const sp = Math.abs(state.speed);
    let want = G._prTier || 1.25;
    if (sp < 4) want = 1.5; else if (sp > 10) want = 1.2;
    if (want !== G._prTier) {
      G._prTier = want;
      const pr = Math.min(window.devicePixelRatio, want);
      renderer.setPixelRatio(pr); finalComposer.setPixelRatio(pr); bloomComposer.setPixelRatio(pr);
    }
  }

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
  selectiveBloomRender();
  // 帧率自适应：持续偏低时自动降画质（一次性，Q 可切回）
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 4) {
    const avg = fpsN / fpsAcc;
    if (!autoDropped && G.hiQuality && avg < 42 && G.appState === 'drive') {
      autoDropped = true;
      setQuality(false);
      showMsg('已自动优化画质以保持流畅', 2200, 24);
    }
    fpsAcc = 0; fpsN = 0;
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
    await stage('构建岛屿地形…', 24, buildTerrain);
    await stage('铺设海岸公路…', 45, buildRoad);
    await stage('修补公路分叉…', 48, buildRoadJunctionPass);
    await stage('生成程序化森林…', 68, buildScenery);
    await stage('布置灯塔与环境…', 76, buildEnv);
    await stage('搭建海滩建筑与道具…', 88, buildProps);
    await stage('唤醒步行角色…', 92, buildCharacter);
    await stage('载入动态天空…', 95, buildSkyCycle);
    elBT.textContent = '点火启动…';
    elBF.style.width = '100%';
    if (elTip) elTip.textContent = '资源就绪，正在进入车库…';
    await new Promise(r => requestAnimationFrame(r));
    initUI();
    installMinimalDriveHud();
    initFX();
    settleCarPose();
    applyTod(G.curTod);
    setQuality(G.hiQuality);
    enterGarage();
    loop();
    // FASTDEBUG：自动跳过车库菜单直接进驾驶，并把相机放到路面上方俰视，方便无头直接截到 3D 路面
    if (FASTDEBUG) {
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
