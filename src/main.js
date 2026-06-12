import * as THREE from 'three';
import { G, scene, camera, renderer, composer, sun, rim } from './core.js';
import { curSunDir, env, buildTerrain, buildRoad, buildScenery, buildEnv, applyTod, groundHeight } from './world.js';
import { state, physics, updateChaseCamera, setGlassSeeThru, settleCarPose } from './vehicle.js';
import { race, raceUpdate, gameplayUpdate, buildProps, fmt, cps, cpGroupAll, arrow, arrowPivot, raceBestText } from './gameplay.js';
import { audioUpdate } from './audio.js';
import { initFX, fxUpdate } from './fx.js';
import { showMsg, controls, drawMinimap, setQuality, enterGarage, initUI, elSpeed, elMode, elNitro, elGear, gArc, gLen, elLap, elCp, elBest } from './ui.js';

// ---------- 主循环 ----------
let last = performance.now(), frame = 0;
let fpsAcc = 0, fpsN = 0, autoDropped = false;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min((now - last)/1000, 0.05);
  last = now;

  if (G.waterOK && G.water.visible) G.water.material.uniforms['time'].value += dt*0.6;

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
  } else {
    // 暂停时不更新轨道控制器，否则相机会被拉回旧的环绕目标点
    if (G.appState !== 'pause') {
      controls.update();
      const gyC = Math.max(groundHeight(camera.position.x, camera.position.z), 0.1);
      if (camera.position.y < gyC + 0.45) camera.position.y = gyC + 0.45;
    }
  }
  audioUpdate();

  sun.position.copy(state.pos).addScaledVector(curSunDir, 220);
  sun.target.position.copy(state.pos);
  rim.position.copy(state.pos).add(new THREE.Vector3(-curSunDir.x*120, 60, -curSunDir.z*120));
  rim.target.position.copy(state.pos);

  const t = now*0.001;
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
  composer.render();
  // 帧率自适应：持续偏低时自动降画质（一次性，Q 可切回）
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 4) {
    const avg = fpsN / fpsAcc;
    if (!autoDropped && G.hiQuality && avg < 42 && G.appState === 'drive') {
      autoDropped = true;
      setQuality(false);
      showMsg('帧率偏低，已自动切换低画质（Q 可切回）', 2400, 24);
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
  await stage('搭建海滩建筑与道具…', 90, buildProps);
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

