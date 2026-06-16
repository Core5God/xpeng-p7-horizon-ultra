import * as THREE from 'three';
import { G, scene, camera, renderer, composer, sun, rim } from './core.js';
import { curSunDir, env, buildTerrain, buildRoad, buildScenery, buildEnv, applyTod, groundHeight, windU } from './world.js';
import { state, physics, updateChaseCamera, setGlassSeeThru, settleCarPose, coastVehicle, updateCarReflection } from './vehicle.js';
import { buildCharacter, characterUpdate, characterCamera, charState } from './character.js';
import { buildSkyCycle, skyCycleUpdate } from './skycycle.js';
import { race, raceUpdate, gameplayUpdate, buildProps, fmt, cps, cpGroupAll, arrow, arrowPivot, raceBestText } from './gameplay.js';
import { audioUpdate } from './audio.js';
import { initFX, fxUpdate } from './fx.js';
import { showMsg, keys as keysRef, pauseGame, resumeGame, controls, drawMinimap, setQuality, enterGarage, initUI, elSpeed, elMode, elNitro, elGear, gArc, gLen, elLap, elCp, elBest } from './ui.js';

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

  if (G.waterOK && G.water.material.normalMap) { const n = G.water.material.normalMap; n.offset.x += dt*0.012; n.offset.y += dt*0.008; } // 法线滚动 → 动态波纹

  let onRoad = true, boost = false;
  // 仅座舱视角玻璃透明，其余视角保持原厂深色玻璃
  setGlassSeeThru(G.appState === 'drive' && G.camMode === 3);
  if (G.appState === 'drive') {
    const r = physics(dt);
    onRoad = r.onRoad; boost = r.boost;
    raceUpdate();
    gameplayUpdate(dt, onRoad);
    fxUpdate(dt, onRoad, boost);
    updateChaseCamera(dt, boost);
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
  }
  audioUpdate();
  skyCycleUpdate(dt); // 动态天空/天气循环（接管太阳/雾/曝光/反射）

  // 动态像素比（车近景更清晰）：停车/低速拉到 1.5 看清车身细节，高速降到 1.2 保帧；
  // 4/10 双阈值迟滞，避免在临界速度反复重建渲染目标
  if (G.hiQuality && G.appState === 'drive') {
    const sp = Math.abs(state.speed);
    let want = G._prTier || 1.25;
    if (sp < 4) want = 1.5; else if (sp > 10) want = 1.2;
    if (want !== G._prTier) {
      G._prTier = want;
      const pr = Math.min(window.devicePixelRatio, want);
      renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
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
    gArc.style.strokeDashoffset = gLen * (1 - Math.min(kmh/280, 1));
    elGear.textContent = state.speed < -0.5 ? 'R' : (Math.abs(state.speed) < 0.5 ? 'N' : 'D');
    elNitro.style.width = (state.nitro*100).toFixed(0) + '%';
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
  if (G.appState !== 'pause' && G.appState !== 'photo') updateCarReflection(); // 反射探针（自限每5帧）
  composer.render();
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
  composer.setSize(innerWidth, innerHeight);
});

// ---------- 分阶段异步启动：让出主线程刷新进度，消除黑屏 ----------
(async () => {
  const elBT = document.getElementById('boottext');
  const elBF = document.getElementById('bootfill');
  const stage = async (label, pct, fn) => {
    elBT.textContent = label;
    elBF.style.width = pct + '%';
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    await fn();
  };
  await stage('构建岛屿地形…', 22, buildTerrain);
  await stage('铺设海岸公路…', 45, buildRoad);
  await stage('生成程序化森林…', 68, () => { buildScenery(); }); // 树木后台加载，就绪后自动出现
  await stage('布置灯塔与环境…', 76, buildEnv);
  await stage('搭建海滩建筑与道具…', 88, buildProps);
  await stage('唤醒步行角色…', 92, () => { buildCharacter(); }); // 角色后台加载，就绪后 F 键可切换
  await stage('载入动态天空…', 95, () => { buildSkyCycle(); });   // 6 时段天空后台加载，就绪后自动循环
  elBT.textContent = '点火启动…';
  elBF.style.width = '100%';
  await new Promise(r => requestAnimationFrame(r));
  initUI();
  initFX();
  settleCarPose();
  applyTod(G.curTod);
  setQuality(G.hiQuality);
  enterGarage();
  loop();
  requestAnimationFrame(() => {
    const b = document.getElementById('boot');
    if (b) b.remove();
  });
})();

