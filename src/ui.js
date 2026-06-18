import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { G, camera, renderer, canvas, composer, bloomPass, photoPass, sun } from './core.js';
import { PRESETS, samples, tangents, bSamples, NS, nearestRoad, applyTod, fallbackOcean } from './world.js';
import { PAINTS, applySkin, state, settleCarPose, camPos, camDamp, camAng } from './vehicle.js';
import { PRESETS as TODP } from './world.js';
import { race, toggleRace, startRace, endRace, saveBestScore, ROUTES, selectRoute, getRecordsView, getShareStats, zones } from './gameplay.js';
import { initAudio, startMusic, setMusic, startPlaylist, stopPlaylist, nextTrack, prevTrack, toggleShuffle, refreshPlaylistUI, setLofiGain, stopLofi, getCurrentTrack } from './audio.js';
import { spawnCharacter, setCharacterVisible, showCharacterPreview, setActiveCharacter, getActiveId, CHARACTERS } from './character.js';

// ---------- 轨道相机（车库/照片模式） ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 3.2;
controls.maxDistance = 14;
controls.maxPolarAngle = 1.42;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.2;
controls.enabled = true;

// ---------- 应用状态 ----------
const keys = {};
function clearKeys() { for (const k in keys) keys[k] = false; }
addEventListener('blur', clearKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearKeys(); });

// ---------- 设置持久化 ----------
let hintsOn = true, keytipsTimer = null;
function saveSettings() {
  try { localStorage.setItem('p7_set', JSON.stringify({skinIdx: G.skinIdx, curTod: G.curTod, hiQuality: G.hiQuality, muted: G.muted, musicOn: G.musicOn, musicMode: G.musicMode, hintsOn, routeId: race.routeIdx, charId: G.charId})); } catch(e) {}
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('p7_set') || '{}');
    if (typeof s.skinIdx === 'number' && s.skinIdx >= 0 && s.skinIdx < PAINTS.length) G.skinIdx = s.skinIdx;
    if (s.curTod && PRESETS[s.curTod]) G.curTod = s.curTod;
    // 画质统一：始终以最高画质启动（不再从存档恢复低画质），运行时由系统按帧率自适应
    if (typeof s.muted === 'boolean') G.muted = s.muted;
    if (typeof s.musicOn === 'boolean') G.musicOn = s.musicOn;
    if (s.musicMode === 'lofi' || s.musicMode === 'playlist') G.musicMode = s.musicMode;
    if (typeof s.hintsOn === 'boolean') hintsOn = s.hintsOn;
    if (typeof s.routeId === 'number') selectRoute(s.routeId);
    if (s.charId) G.charId = s.charId;
  } catch(e) {}
}

// ---------- UI 构建 ----------
const elMsg = document.getElementById('msg');
let msgTimer = null;
function showMsg(t, dur, size) {
  elMsg.textContent = t;
  elMsg.style.fontSize = (size||56) + 'px';
  elMsg.style.opacity = 1;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => elMsg.style.opacity = 0, dur);
}
function buildRows() {
  for (const rowId of ['paintRowG', 'paintRowP']) {
    const row = document.getElementById(rowId);
    row.innerHTML = '';
    PAINTS.forEach((P, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.title = P.name;
      b.style.background = i === 0 ? 'conic-gradient(#c8ccd4,#8a8f98,#e8eaee,#c8ccd4)' : '#'+(P.sw ?? P.c).toString(16).padStart(6,'0');
      b.addEventListener('click', () => { G.skinIdx = i; applySkin(true); });
      row.appendChild(b);
    });
  }
  for (const rowId of ['todRowG', 'todRowP']) {
    const row = document.getElementById(rowId);
    row.innerHTML = '';
    for (const key of Object.keys(PRESETS)) {
      const b = document.createElement('button');
      b.className = 'opt';
      b.dataset.tod = key;
      b.textContent = PRESETS[key].label;
      b.addEventListener('click', () => { applyTod(key); refreshTodButtons(); saveSettings(); });
      row.appendChild(b);
    }
  }
}
function buildRouteRow() {
  const row = document.getElementById('routeRow');
  row.innerHTML = '';
  ROUTES.forEach((r, i) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.dataset.route = i;
    b.textContent = r.name;
    b.addEventListener('click', () => { selectRoute(i); refreshRouteRow(); saveSettings(); });
    row.appendChild(b);
  });
  refreshRouteRow();
}
function refreshRouteRow() {
  document.querySelectorAll('#routeRow .opt').forEach((b, i) => b.classList.toggle('sel', i === race.routeIdx));
}
function buildCharRow() {
  for (const rowId of ['charRowG', 'charRowP']) {
    const row = document.getElementById(rowId);
    if (!row) continue;
    row.innerHTML = '';
    CHARACTERS.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'charcard';
      b.dataset.char = c.id;
      b.innerHTML = '<b>' + c.name + '</b><i>' + c.sub + '</i>';
      b.addEventListener('click', () => { setActiveCharacter(c.id); refreshCharRow(); saveSettings(); });
      row.appendChild(b);
    });
  }
  refreshCharRow();
}
function refreshCharRow() {
  const id = getActiveId();
  document.querySelectorAll('.charcard').forEach((b) => b.classList.toggle('sel', b.dataset.char === id));
}
export function refreshRecords() {
  const v = getRecordsView();
  const box = document.getElementById('recordsBox');
  box.innerHTML = '';
  for (const r of v.ROUTES) {
    const rec = v.records[r.id] || {};
    const d = document.createElement('div');
    d.className = 'rrow';
    d.innerHTML = '<span class="rname">' + r.name + '</span><span class="rval">'
      + (rec.best ? fmtT(rec.best) : '—') + ' ' + (rec.medal ? v.MEDAL_ICON[rec.medal] : '') + '</span>';
    box.appendChild(d);
  }
  const ar = document.getElementById('achRow');
  ar.innerHTML = '';
  for (const a of v.ACHS) {
    const c = document.createElement('span');
    c.className = 'achchip' + (v.ach[a.id] ? '' : ' locked');
    c.title = a.desc;
    c.textContent = a.icon + ' ' + a.name;
    ar.appendChild(c);
  }
}
function fmtT(t) {
  const m = Math.floor(t/60), s = t - m*60;
  return m + ':' + (s<10?'0':'') + s.toFixed(2);
}
function refreshSwatches() {
  document.querySelectorAll('#paintRowG .swatch, #paintRowP .swatch').forEach((b, i) => {
    b.classList.toggle('sel', (i % PAINTS.length) === G.skinIdx);
  });
}
function refreshTodButtons() {
  document.querySelectorAll('[data-tod]').forEach(b => b.classList.toggle('sel', b.dataset.tod === G.curTod));
}
function refreshSettingBtns() {
  for (const id of ['gQuality','pQuality']) document.getElementById(id).textContent = '画质：' + (G.hiQuality?'高':'低');
  for (const id of ['gSound','pSound']) document.getElementById(id).textContent = '声音：' + (G.muted?'关':'开');
  for (const id of ['gMusic','pMusic']) document.getElementById(id).textContent = '音乐：' + (G.musicOn?'开':'关');
  for (const id of ['gMusicMode','pMusicMode']) document.getElementById(id).textContent = G.musicMode === 'playlist' ? '歌单' : '电台';
}

function setQuality(q) {
  G.hiQuality = q;
  bloomPass.strength = G.hiQuality ? PRESETS[G.curTod].bloom : 0;
  if (G.waterOK) G.water.visible = true; // 环境反射海面很便宜，高低画质都常开
  const pr = Math.min(window.devicePixelRatio, G.hiQuality ? 1.25 : 1); // 高画质像素比 1.5→1.25：填充率约降 30%，车身仍锐利
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  // 阴影贴图随画质：低画质降到 1024²（开放世界阴影很贵，分辨率减半省一半阴影 pass 开销）
  const wantShadow = G.hiQuality ? 2048 : 1024;
  if (sun.shadow.mapSize.width !== wantShadow) {
    sun.shadow.mapSize.set(wantShadow, wantShadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } // 触发重建
  }
  refreshSettingBtns(); saveSettings();
}
for (const id of ['gQuality','pQuality']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; } // 画质统一：隐藏手动切换
for (const id of ['gSound','pSound']) document.getElementById(id).addEventListener('click', () => { G.muted = !G.muted; refreshSettingBtns(); saveSettings(); });
for (const id of ['gMusic','pMusic']) document.getElementById(id).addEventListener('click', () => { initAudio(); startMusic(); setMusic(!G.musicOn, false); });
// 音乐模式切换（电台 / 歌单）
function setMusicMode(mode) {
  G.musicMode = mode;
  if (mode === 'playlist') {
    stopLofi();
    initAudio(); startMusic();
    if (G.musicOn) startPlaylist();
  } else {
    stopPlaylist();
    initAudio(); startMusic();
    // 若 lofi 已初始化但 gain 为 0，手动恢复
    if (G.musicOn) setLofiGain(0.16);
  }
  refreshSettingBtns();
  refreshPlaylistUI();
  saveSettings();
  showMsg(mode === 'playlist' ? '🎵 歌单模式' : '🎵 Lofi 电台', 900, 26);
}
for (const id of ['gMusicMode','pMusicMode']) {
  document.getElementById(id).addEventListener('click', () => {
    setMusicMode(G.musicMode === 'lofi' ? 'playlist' : 'lofi');
  });
}
// 歌单控制栏按钮
document.getElementById('plPrev').addEventListener('click', () => {
  if (G.musicMode !== 'playlist' || !G.musicOn) setMusicMode('playlist');
  prevTrack();
});
document.getElementById('plNext').addEventListener('click', () => {
  if (G.musicMode !== 'playlist' || !G.musicOn) setMusicMode('playlist');
  nextTrack();
});
document.getElementById('plShuffle').addEventListener('click', () => { toggleShuffle(); });

// ---------- 状态切换 ----------
const elGarage = document.getElementById('garage');
const elPause = document.getElementById('pausemenu');
const elPhotobar = document.getElementById('photobar');
function setOrbitAroundCar(dist, height) {
  controls.target.set(state.pos.x, state.pos.y + 0.9, state.pos.z);
  const fx = Math.sin(state.heading), fz = Math.cos(state.heading);
  camera.position.set(state.pos.x + fx*dist*0.5 - fz*dist*0.85, state.pos.y + height, state.pos.z + fz*dist*0.5 + fx*dist*0.85);
}
function enterGarage() {
  G.appState = 'garage';
  document.body.style.cursor = '';
  showCharacterPreview(true);   // 车库内角色站立预览（选人）
  saveBestScore();
  if (race.phase !== 'free') endRace();
  state.speed = 0; state.vx = 0; state.vz = 0;
  settleCarPose();
  document.body.classList.add('nohud');
  elGarage.classList.add('show');
  elPause.classList.remove('show');
  elPhotobar.classList.remove('show');
  controls.enabled = true; controls.autoRotate = true;
  setOrbitAroundCar(7.5, 1.8);
}
function refreshKeytips() {
  const el = document.getElementById('keytips');
  el.style.display = hintsOn ? '' : 'none';
}
function showKeytipsFresh() {
  const el = document.getElementById('keytips');
  refreshKeytips();
  el.classList.remove('dim');
  clearTimeout(keytipsTimer);
  keytipsTimer = setTimeout(() => el.classList.add('dim'), 8000); // 8 秒后淡化，不抢画面
}
function startDrive(raceMode) {
  initAudio();
  startMusic();
  if (G.musicOn && G.musicMode === 'playlist') startPlaylist();
  showKeytipsFresh();
  G.appState = 'drive';
  document.body.style.cursor = 'none';
  setCharacterVisible(false);   // 关闭车库站立预览
  document.body.classList.remove('nohud');
  elGarage.classList.remove('show');
  elPause.classList.remove('show');
  elPhotobar.classList.remove('show');
  controls.enabled = false; controls.autoRotate = false;
  camPos.copy(camera.position);
  camDamp.x.v = camDamp.y.v = camDamp.z.v = 0;
  camAng.init = false;
  if (raceMode && race.phase === 'free') startRace();
  if (!raceMode) showMsg('自由漫游 · 祝你玩得开心', 1600, 34);
}
function pauseGame() {
  G.pausedFrom = G.appState === 'walk' ? 'walk' : 'drive';
  G._pauseT = performance.now();
  G.appState = 'pause';
  clearKeys();
  saveBestScore();
  if (document.pointerLockElement) document.exitPointerLock?.();
  document.body.style.cursor = '';
  elPause.classList.add('show');
  controls.enabled = false;
  if (race.phase === 'racing') race.pauseT = performance.now();
}
function resumeGame() {
  G.appState = G.pausedFrom === 'walk' ? 'walk' : 'drive';
  elPause.classList.remove('show');
  document.body.style.cursor = 'none';
  if (G.appState === 'walk') canvas.requestPointerLock?.();
  if (race.phase === 'racing') race.t0 += performance.now() - race.pauseT;
}
function enterPhoto() {
  const fromDrive = G.appState === 'drive';
  G.appState = 'photo';
  document.body.style.cursor = '';
  clearKeys();
  document.body.classList.add('nohud');
  document.body.classList.add('photo');
  photoPass.enabled = true; // 启用暗角+色差电影感（海报导出也会带上）
  elPause.classList.remove('show');
  elPhotobar.classList.add('show');
  controls.enabled = true; controls.autoRotate = false;
  setOrbitAroundCar(6.5, 1.5);
  // 从暂停菜单进入时保留原 pauseT，暂停+拍照时间在退出时一并补偿
  if (race.phase === 'racing' && fromDrive) race.pauseT = performance.now();
}
function exitPhoto() {
  G.appState = 'drive';
  document.body.classList.remove('nohud');
  document.body.classList.remove('photo');
  photoPass.enabled = false;
  elPhotobar.classList.remove('show');
  controls.enabled = false;
  if (race.phase === 'racing') race.t0 += performance.now() - race.pauseT;
}
document.getElementById('btnRoam').addEventListener('click', () => startDrive(false));
document.getElementById('btnRace').addEventListener('click', () => startDrive(true));
document.getElementById('btnResume').addEventListener('click', resumeGame);
document.getElementById('btnPhoto').addEventListener('click', enterPhoto);
document.getElementById('btnGarage').addEventListener('click', enterGarage);
document.getElementById('btnPhotoExit').addEventListener('click', exitPhoto);
document.getElementById('btnPoster').addEventListener('click', () => {
  composer.render();
  const pc = document.createElement('canvas');
  pc.width = 1080; pc.height = 1440;
  const x = pc.getContext('2d');
  // 背景
  const bg = x.createLinearGradient(0, 0, 0, 1440);
  bg.addColorStop(0, '#0b1322'); bg.addColorStop(1, '#04070d');
  x.fillStyle = bg; x.fillRect(0, 0, 1080, 1440);
  // 画面（cover 裁切到 1080x1080）
  x.save();
  x.beginPath(); x.rect(0, 150, 1080, 1080); x.clip();
  const s = Math.max(1080/canvas.width, 1080/canvas.height);
  const dw = canvas.width*s, dh = canvas.height*s;
  x.drawImage(canvas, (1080-dw)/2, 150 + (1080-dh)/2, dw, dh);
  x.restore();
  // 顶部品牌
  x.fillStyle = '#19d3ff'; x.fillRect(0, 0, 1080, 6);
  x.fillStyle = '#7fe9ff';
  x.font = '600 26px Rajdhani, sans-serif';
  x.textAlign = 'left';
  x.fillText('X P E N G', 48, 70);
  x.fillStyle = '#fff';
  x.font = 'italic 700 56px Rajdhani, "Noto Sans SC", sans-serif';
  x.fillText('THE NEXT P7', 44, 122);
  x.textAlign = 'right';
  x.font = '500 24px "Noto Sans SC", sans-serif';
  x.fillStyle = 'rgba(255,255,255,.75)';
  x.fillText('地平线海岸 · HORIZON COAST', 1036, 110);
  // 底部信息条
  const st = getShareStats();
  const paint = PAINTS[G.skinIdx] ? PAINTS[G.skinIdx].name : '';
  const tod = TODP[G.curTod] ? TODP[G.curTod].label : '';
  x.textAlign = 'left';
  x.fillStyle = '#19d3ff'; x.fillRect(44, 1268, 5, 110);
  x.fillStyle = '#fff';
  x.font = 'italic 700 44px Rajdhani, "Noto Sans SC", sans-serif';
  x.fillText('SCORE ' + st.score.toLocaleString(), 72, 1312);
  x.font = '500 26px "Noto Sans SC", sans-serif';
  x.fillStyle = 'rgba(255,255,255,.8)';
  x.fillText(st.routeName + ' 最佳 ' + st.best + ' ' + st.medal + '　·　' + paint + '　·　' + tod, 72, 1356);
  x.textAlign = 'right';
  x.fillStyle = 'rgba(255,255,255,.45)';
  x.font = '500 22px Rajdhani, sans-serif';
  const d = new Date();
  x.fillText(d.getFullYear() + '.' + (d.getMonth()+1) + '.' + d.getDate() + ' · horizon.beastle.cn', 1036, 1356);
  pc.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    document.getElementById('posterImg').src = url;
    document.getElementById('posterDl').href = url;
    document.getElementById('posterView').classList.add('show');
  });
});
document.getElementById('posterClose').addEventListener('click', () => {
  document.getElementById('posterView').classList.remove('show');
});
document.getElementById('btnShot').addEventListener('click', () => {
  composer.render();
  // 同帧同步拷贝到离屏 canvas：渲染缓冲在本次事件内仍有效，无需 preserveDrawingBuffer
  const sc = document.createElement('canvas');
  sc.width = canvas.width; sc.height = canvas.height;
  sc.getContext('2d').drawImage(canvas, 0, 0);
  sc.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'XPENG_P7_' + Date.now() + '.png';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  showMsg('已保存截图 📸', 1200, 30);
});

// ---------- 电台浮窗（长按 B） ----------
let bHoldTimer = null, wheelActive = false, bStartTime = 0;
let wdx = 0, wdy = 0;                       // 累积鼠标增量（虚拟摇杆）
const DEAD = 28;                             // 死区像素
const WHEEL_OPTS = ['off', 'next', 'mode', 'prev'];

addEventListener('mousemove', e => {
  if (!wheelActive) return;
  wdx += (e.movementX || 0);
  wdy += (e.movementY || 0);
  const dist = Math.sqrt(wdx * wdx + wdy * wdy);
  if (dist < DEAD) {
    document.querySelectorAll('.rw-item').forEach(el => el.classList.remove('sel'));
    return;
  }
  // 屏幕坐标系：右=0°  下=90°  左=180°  上=270°
  const angle = (Math.atan2(wdy, wdx) * 180 / Math.PI + 360) % 360;
  const opt = angle >= 315 || angle < 45  ? 'next'   // 右
            : angle >= 45  && angle < 135 ? 'mode'   // 下
            : angle >= 135 && angle < 225 ? 'prev'   // 左
            :                                'off';  // 上
  highlightWheelOpt(opt);
});

function showRadioWheel() {
  wheelActive = true;
  wdx = 0; wdy = 0; // 重置虚拟摇杆
  document.getElementById('radioWheel').classList.add('show');
  updateWheelLabel();
  // 清空高亮
  document.querySelectorAll('.rw-item').forEach(el => el.classList.remove('sel'));
}

function updateWheelLabel() {
  const hub = document.querySelector('.rw-hub .rw-label');
  if (!hub) return;
  if (G.musicMode === 'playlist') {
    const t = getCurrentTrack();
    hub.textContent = t ? t.name : '歌单';
  } else {
    hub.textContent = G.musicOn ? 'LOFI' : 'RADIO';
  }
}

function highlightWheelOpt(opt) {
  document.querySelectorAll('.rw-item').forEach(el =>
    el.classList.toggle('sel', el.dataset.rw === opt));
}

function selectWheelOption(opt) {
  wheelActive = false;
  document.getElementById('radioWheel').classList.remove('show');
  initAudio(); startMusic();
  switch (opt) {
    case 'off':
      setMusic(false, false);
      showMsg('电台 关', 900, 26);
      break;
    case 'prev':
      if (G.musicMode !== 'playlist' || !G.musicOn) setMusicMode('playlist');
      prevTrack();
      break;
    case 'next':
      if (G.musicMode !== 'playlist' || !G.musicOn) setMusicMode('playlist');
      nextTrack();
      break;
    case 'mode':
      setMusicMode(G.musicMode === 'lofi' ? 'playlist' : 'lofi');
      break;
  }
}

// ---------- 键盘 ----------
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') {
    if (wheelActive) {
      wheelActive = false;
      document.getElementById('radioWheel').classList.remove('show');
      return;
    }
    if (G.appState === 'drive' || G.appState === 'walk') pauseGame();
    else if (G.appState === 'pause') { if (performance.now() - (G._pauseT || 0) > 350) resumeGame(); }
    else if (G.appState === 'photo') exitPhoto();
  }
  if (e.code === 'KeyP') {
    if (G.appState === 'drive' || G.appState === 'pause') enterPhoto();
    else if (G.appState === 'photo') exitPhoto();
  }
  // 全局设置键（车库内同样可用）
  if (e.code === 'KeyV') { G.skinIdx = (G.skinIdx+1) % PAINTS.length; applySkin(true); }
  if (e.code === 'KeyN') {
    const ks = Object.keys(PRESETS);
    applyTod(ks[(ks.indexOf(G.curTod)+1) % ks.length]); refreshTodButtons(); saveSettings();
    showMsg(PRESETS[G.curTod].label, 900, 30);
  }
  if (e.code === 'KeyM') { G.muted = !G.muted; refreshSettingBtns(); saveSettings(); showMsg(G.muted?'引擎声 关':'引擎声 开', 800, 24); }
  if (e.code === 'KeyB') {
    if (!e.repeat) {
      bStartTime = performance.now();
      bHoldTimer = setTimeout(() => {
        if (keys['KeyB']) showRadioWheel();
      }, 350);
    }
  }
  // 画质统一：取消手动切换，默认最高、系统自适应降级（Q 键不再切画质）
  if (e.code === 'KeyH') {
    hintsOn = !hintsOn;
    refreshKeytips();
    saveSettings();
    if (hintsOn) showMsg('键位提示 开', 800, 24);
  }
  if (G.appState === 'garage' || G.appState === 'photo') return;
  if (e.code === 'KeyF') { // 上/下车：在驾驶与步行之间切换
    if (G.appState === 'drive') {
      const h = state.heading;
      const lx = Math.cos(h), lz = -Math.sin(h); // 车体左向，角色从左侧"下车"
      if (spawnCharacter(state.pos.x + lx*2.4, state.pos.z + lz*2.4, h)) {
        // 下车：保留车速，由 coastVehicle 自然滚停（不瞬停、不飞出）
        G.appState = 'walk';
        document.body.classList.remove('nohud');
        document.body.style.cursor = 'none';
        canvas.requestPointerLock?.(); // 按键即用户手势，直接锁定鼠标控镜头，无需再点屏幕
        showMsg('🚶 步行模式｜WASD 移动(跟随镜头) · 鼠标转视角 · SHIFT 跑 · SPACE 跳 · F 上车 · ESC 菜单', 5200, 21);
      } else showMsg('角色还在加载…', 1200, 24);
    } else if (G.appState === 'walk') {
      G.appState = 'drive'; // 先切状态，避免 exitPointerLock 的 pointerlockchange 误触发暂停
      setCharacterVisible(false);
      document.body.style.cursor = 'none';
      camPos.copy(camera.position);
      camDamp.x.v = camDamp.y.v = camDamp.z.v = 0;
      camAng.init = false;
      showMsg('🚗 已上车', 1200, 26);
    }
  }
  if (e.code === 'KeyC') G.camMode = (G.camMode+1) % 5; // 远追/近追/贴尾(极品飞车式)/座舱/环绕
  if (e.code === 'KeyR') toggleRace();
  if (e.code === 'KeyT') { // 一键复位：卡住/落水/翻出地图都能脱困
    const nrT = nearestRoad(state.pos.x, state.pos.z);
    state.pos.set(samples[nrT.idx].x, samples[nrT.idx].y + 0.1, samples[nrT.idx].z);
    state.heading = state.travel = Math.atan2(tangents[nrT.idx].x, tangents[nrT.idx].z);
    state.speed = 0; state.vx = 0; state.vz = 0; state.vyAir = 0;
    state.airborne = false; state.steer = 0; state.stuckT = 0;
    if (!isFinite(state.flow)) state.flow = 0;
    if (!isFinite(state.nitro)) state.nitro = 1;
    settleCarPose();
    showMsg('已复位到道路', 1000, 28);
  }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'KeyB') {
    clearTimeout(bHoldTimer);
    if (wheelActive) {
      // 浮窗已打开：根据累积鼠标增量选择选项
      const dist = Math.sqrt(wdx * wdx + wdy * wdy);
      if (dist > DEAD) {
        const angle = (Math.atan2(wdy, wdx) * 180 / Math.PI + 360) % 360;
        const opt = angle >= 315 || angle < 45  ? 'next'
                  : angle >= 45  && angle < 135 ? 'mode'
                  : angle >= 135 && angle < 225 ? 'prev'
                  :                                'off';
        selectWheelOption(opt);
      } else {
        // 未推出死区，取消选择
        wheelActive = false;
        document.getElementById('radioWheel').classList.remove('show');
      }
    } else if (performance.now() - bStartTime < 350) {
      // 短按：快速切换模式（保留原行为）
      initAudio(); startMusic();
      if (!G.musicOn) {
        G.musicOn = true;
        setMusic(true, false);
        if (G.musicMode === 'playlist') startPlaylist();
        showMsg(G.musicMode === 'playlist' ? '🎵 歌单模式 开' : '🎵 Lofi 电台 开', 900, 26);
      } else if (G.musicMode === 'lofi') {
        setMusicMode('playlist');
      } else {
        setMusic(false, false);
        showMsg('音乐 关', 900, 26);
      }
    }
  }
});
// 步行时按 ESC 会先被浏览器用于退出指针锁定 → 监听解锁事件来打开菜单（单次 ESC 即可进菜单）
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && G.appState === 'walk') pauseGame();
});

// ---------- HUD / 小地图 ----------
const elSpeed = document.getElementById('speed');
const elMode = document.getElementById('mode');
const elNitro = document.getElementById('nitrofill');
const elGear = document.getElementById('gear');
const gArc = document.getElementById('gArc');
let gLen = 360.3; // 半径95、大弧的解析长度（隐藏时 getTotalLength 可能失效）
try { const L = gArc.getTotalLength(); if (L > 1) gLen = L; } catch(e) {}
gArc.style.strokeDasharray = gLen;
gArc.style.strokeDashoffset = gLen;
const elLap = document.getElementById('laptime');
const elCp = document.getElementById('cpinfo');
const elBest = document.getElementById('besttime');
const mm = document.getElementById('minimap').getContext('2d');
let mmScale, mmOff;
{
  let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
  for (const p of samples) { minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z); }
  const span = Math.max(maxX-minX, maxZ-minZ);
  mmScale = 146/span;
  mmOff = {x:(minX+maxX)/2, z:(minZ+maxZ)/2};
}
function mmPt(x, z) { return [85 + (x-mmOff.x)*mmScale, 85 + (z-mmOff.z)*mmScale]; }
function drawMinimap() {
  mm.clearRect(0,0,170,170);
  mm.beginPath();
  for (let i = 0; i <= NS; i += 6) {
    const p = samples[i % NS], [px, py] = mmPt(p.x, p.z);
    i === 0 ? mm.moveTo(px, py) : mm.lineTo(px, py);
  }
  mm.closePath();
  mm.strokeStyle = 'rgba(255,255,255,.75)'; mm.lineWidth = 3; mm.stroke();
  // 支线
  mm.beginPath();
  for (let i = 0; i < bSamples.length; i += 6) {
    const p = bSamples[i], [px2, py2] = mmPt(p.x, p.z);
    i === 0 ? mm.moveTo(px2, py2) : mm.lineTo(px2, py2);
  }
  mm.strokeStyle = 'rgba(255,255,255,.4)'; mm.lineWidth = 2; mm.stroke();
  if (race.phase === 'free') {
    for (const z of zones) {
      const [zx2, zy2] = mmPt(z.x, z.z);
      mm.fillStyle = '#' + z.color.toString(16).padStart(6, '0');
      mm.beginPath(); mm.arc(zx2, zy2, 4, 0, Math.PI*2); mm.fill();
      mm.strokeStyle = 'rgba(255,255,255,.85)'; mm.lineWidth = 1.2; mm.stroke();
    }
  }
  if ((race.phase === 'racing' || race.phase === 'countdown') && race.targets[race.ti]) {
    const tp = race.targets[race.ti].userData.pos, [cx, cy] = mmPt(tp.x, tp.z);
    mm.fillStyle = '#76ff03';
    mm.beginPath(); mm.arc(cx, cy, 4.5, 0, Math.PI*2); mm.fill();
  }
  const [vx, vy] = mmPt(state.pos.x, state.pos.z);
  mm.save();
  mm.translate(vx, vy); mm.rotate(Math.PI - state.heading);
  mm.fillStyle = '#00e5ff';
  mm.beginPath(); mm.moveTo(0,-6); mm.lineTo(4,5); mm.lineTo(-4,5); mm.closePath(); mm.fill();
  mm.restore();
}


// ---------- 模块初始化（由 main 在启动序列中调用，避免模块求值期副作用） ----------
export function initUI() {
  loadSettings();
  buildRows();
  buildRouteRow();
  buildCharRow();
  refreshRecords();
  refreshSwatches();
  refreshTodButtons();
  refreshSettingBtns();
}

export { controls, keys, showMsg, refreshSwatches, refreshTodButtons, refreshSettingBtns, saveSettings, setQuality, enterGarage, startDrive, pauseGame, resumeGame, enterPhoto, exitPhoto, drawMinimap, elSpeed, elMode, elNitro, elGear, gArc, gLen, elLap, elCp, elBest };
