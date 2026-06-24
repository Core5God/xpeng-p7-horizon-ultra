import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { G, camera, renderer, canvas, finalComposer, bloomComposer, selectiveBloomRender, bloomPass, photoPass, sun } from './core.js';import { PRESETS, samples, tangents, bSamples, NS, nearestRoad, applyTod, fallbackOcean } from './world.js';
import { PAINTS, applySkin, state, settleCarPose, camPos, camDamp, camAng } from './vehicle.js';
import { PRESETS as TODP } from './world.js';
import { race, toggleRace, startRace, endRace, saveBestScore, ROUTES, selectRoute, getRecordsView, getShareStats, zones } from './gameplay.js';
import { initAudio, startMusic, setMusic, startPlaylist, stopPlaylist, nextTrack, prevTrack, toggleShuffle, refreshPlaylistUI, setLofiGain, stopLofi, getCurrentTrack, plShuffle } from './audio.js';
import { spawnCharacter, setCharacterVisible, showCharacterPreview, setActiveCharacter, getActiveId, CHARACTERS, charState } from './character.js';
import { PERF, isSafeMode, maxPixelRatioFor, setTier, rememberSafe } from './perfMode.js';

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
    if (!row) continue; // 时间选择已从 UI 移除
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

// [PERF0] setQuality 接受档位字符串 'safe'|'auto'|'high'|'photo'（仍兼容旧的 true/false）。
// 统一调像素比 / bloom / 阴影贴图 / hiQuality。
function setQuality(q) {
  // 兼容：true→high，false→safe
  let tier = q;
  if (q === true) tier = 'high';
  else if (q === false) tier = 'safe';
  if (!['ultralite', 'safe', 'auto', 'high', 'photo'].includes(tier)) tier = 'auto';

  setTier(tier);
  G.perfTier = tier;
  G.safeMode = (tier === 'safe' || tier === 'ultralite');
  G.ultraLite = (tier === 'ultralite');
  G.hiQuality = (tier === 'high' || tier === 'photo');
  // bloom：UltraLite/Safe 关；Auto 默认关（夜间/照片动态再开）；High/Photo 常开。
  G.bloomActive = (tier === 'high' || tier === 'photo');
  G._bloomStride = (tier === 'high' || tier === 'photo') ? 1 : 3;
  bloomPass.strength = G.bloomActive ? PRESETS[G.curTod].bloom : 0;
  if (G.waterOK) G.water.visible = true; // 环境反射海面很便宜，高低画质都常开
  // [PERF1] UltraLite：关阴影（shadowMap.enabled=false）。其余档保留阴影。
  renderer.shadowMap.enabled = (tier !== 'ultralite');
  // 标记 body 类名，供 p0Hud CSS 隐藏 minimap/电台/复杂 HUD。
  try {
    document.body.classList.toggle('p1-ultralite', tier === 'ultralite');
  } catch (e) {}

  const pr = Math.min(window.devicePixelRatio, maxPixelRatioFor(tier));
  renderer.setPixelRatio(pr);
  finalComposer.setPixelRatio(pr);
  bloomComposer.setPixelRatio(pr);
  PERF.pixelRatio = pr;

  // 阴影贴图随档：Safe/Auto 1024，High/Photo 2048（UltraLite 已关阴影）。
  const wantShadow = (tier === 'high' || tier === 'photo') ? 2048 : 1024;
  if (sun.shadow.mapSize.width !== wantShadow) {
    sun.shadow.mapSize.set(wantShadow, wantShadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } // 触发重建
  }
  PERF.shadowSize = renderer.shadowMap.enabled ? wantShadow : 0;
  rememberSafe(tier === 'safe' || tier === 'ultralite'); // localStorage 记住低画质
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
  document.body.classList.remove('drive');
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
  state.distance = 0; // 本次驾驶里程归零（slowroads KILOMETERS）
  G.appState = 'drive';
  document.body.style.cursor = 'none';
  setCharacterVisible(false);   // 关闭车库站立预览
  document.body.classList.remove('nohud');
  document.body.classList.add('drive');
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
  G._prePhotoState = G.appState; // 记住进入前的状态（drive/walk/pause）
  G.appState = 'photo';
  document.body.style.cursor = '';
  clearKeys();
  document.body.classList.add('nohud');
  document.body.classList.add('photo');
  photoPass.enabled = true; // 启用暗角+色差电影感（海报导出也会带上）
  // [PERF0] 照片模式临时开 bloom + 拉高像素比（不永久切档，退出时恢复）。
  G._photoPrevBloom = G.bloomActive;
  G._photoPrevStride = G._bloomStride;
  G._photoPrevPr = renderer.getPixelRatio();
  G.bloomActive = true;
  G._bloomStride = 1;
  bloomPass.strength = PRESETS[G.curTod].bloom;
  { const pr = Math.min(window.devicePixelRatio, maxPixelRatioFor('photo'));
    renderer.setPixelRatio(pr); finalComposer.setPixelRatio(pr); bloomComposer.setPixelRatio(pr); }
  elPause.classList.remove('show');
  elPhotobar.classList.add('show');
  controls.enabled = true; controls.autoRotate = false;
  // 放宽拍照镜头限制，允许更远的距离和更高/低的视角
  controls.minDistance = 1.5;
  controls.maxDistance = 30;
  controls.maxPolarAngle = Math.PI * 0.88; // 接近俯拍
  controls.minPolarAngle = 0.1;            // 接近仰拍
  if (G._prePhotoState === 'walk' && charState) {
    // 步行模式：镜头围绕角色，允许自由移动
    const cp = charState.pos;
    controls.target.set(cp.x, cp.y + 1.0, cp.z);
    camera.position.set(cp.x + 5, cp.y + 3, cp.z + 6);
  } else {
    setOrbitAroundCar(6.5, 1.5);
  }
  // 从暂停菜单进入时保留原 pauseT，暂停+拍照时间在退出时一并补偿
  if (race.phase === 'racing' && G._prePhotoState === 'drive') race.pauseT = performance.now();
}
function exitPhoto() {
  G.appState = G._prePhotoState || 'drive'; // 恢复到进入前的状态
  document.body.classList.remove('nohud');
  document.body.classList.remove('photo');
  photoPass.enabled = false;
  // [PERF0] 恢复进照片前的 bloom / 像素比状态。
  G.bloomActive = !!G._photoPrevBloom;
  G._bloomStride = G._photoPrevStride || 3;
  bloomPass.strength = G.bloomActive ? PRESETS[G.curTod].bloom : 0;
  { const pr = G._photoPrevPr || Math.min(window.devicePixelRatio, maxPixelRatioFor(G.perfTier));
    renderer.setPixelRatio(pr); finalComposer.setPixelRatio(pr); bloomComposer.setPixelRatio(pr); }
  elPhotobar.classList.remove('show');
  controls.enabled = false;
  // 恢复车库/驾驶默认镜头限制
  controls.minDistance = 3.2;
  controls.maxDistance = 14;
  controls.maxPolarAngle = 1.42;
  controls.minPolarAngle = 0;
  if (race.phase === 'racing') race.t0 += performance.now() - race.pauseT;
}
document.getElementById('btnRoam').addEventListener('click', () => startDrive(false));
document.getElementById('btnRace').addEventListener('click', () => startDrive(true));
document.getElementById('btnResume').addEventListener('click', resumeGame);
document.getElementById('btnPhoto').addEventListener('click', enterPhoto);
document.getElementById('btnGarage').addEventListener('click', enterGarage);
document.getElementById('btnPhotoExit').addEventListener('click', exitPhoto);
document.getElementById('btnPoster').addEventListener('click', () => {
  selectiveBloomRender();
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
  selectiveBloomRender();
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


// ---------- 电台径向轮盘（长按 B 唤出 → 拨方向选 → 松手选中） ----------
// 瞬时手势：B 非驾驶键，长按期间叠加临时轮盘，用鼠标增量(或方向键瞬时)拨动方向，
// 松手即选。不长期占用 WASD/方向键的驾驶语义，不和驾驶冲突。
// 方向映射：右=下一首、左=上一首、下=播/停、上=关闭(取消)。死区内松手=取消。
const RW_DEAD = 62;        // 死区半径(px)：加大=需明确拨动才进入瞄准，防误触
const RW_ARM = 78;         // 进入瞄准的最小位移(px)：超过才锁方向，低于 RW_DEAD 才取消（进/出迟滞）
const RW_HYST = 10;        // 迟滞角(度)：临界角加入迟滞，避免抖动跳变
const RW_DIRS = ['right', 'down', 'left', 'up']; // 0°向右，逆时针 90/180/270
let rwOpen = false, rwAiming = false, rwDir = null, rwVX = 0, rwVY = 0;
const elWheel = () => document.getElementById('radioWheel');

function rwTrackLabel() {
  const isPl = G.musicMode === 'playlist';
  const t = getCurrentTrack();
  if (!G.musicOn) return isPl ? (t ? t.name : '已暂停') : 'Lofi 电台';
  return isPl ? (t ? t.name : '歌单') : 'Lofi · 海岸频率';
}

// 刷新轮盘中枢信息（模式 / 曲名 / 播放态）
function refreshWheel() {
  const isPl = G.musicMode === 'playlist';
  const mode = document.getElementById('rwMode');
  const name = document.getElementById('rwName');
  const st   = document.getElementById('rwState');
  if (mode) mode.textContent = isPl ? '歌单' : 'Lofi 电台';
  if (name) name.textContent = rwTrackLabel();
  if (st)   st.textContent   = !G.musicOn ? 'PAUSED' : isPl ? 'NOW PLAYING' : 'LIVE RADIO';
}

// 刷新常驻信息卡（仅展示，不抢驾驶键）
function refreshRadioInfo() {
  const isPl = G.musicMode === 'playlist';
  const t = getCurrentTrack();
  const art  = document.getElementById('riArt');
  const name = document.getElementById('riName');
  const sub  = document.getElementById('riSub');
  const subT = document.getElementById('riSubTxt');
  if (art)  art.textContent  = isPl ? '🎵' : '📻';
  if (name) name.textContent = rwTrackLabel();
  if (sub && subT) {
    sub.classList.toggle('off', !G.musicOn);
    subT.textContent = !G.musicOn ? 'PAUSED' : isPl ? 'NOW PLAYING' : 'LIVE RADIO';
  }
}

// 拨动增量 → 当前将选中方向（带死区 + 迟滞）
function rwUpdateAim() {
  const w = elWheel(); if (!w) return;
  const r = Math.hypot(rwVX, rwVY);
  // 进/出迟滞的死区：未瞄准时需拨超 RW_ARM 才锁方向（“明确拨一下”才选）；
  // 已瞄准时回到 RW_DEAD 以内才取消（避免临界频闪）。
  const armThresh = rwAiming ? RW_DEAD : RW_ARM;
  if (r < armThresh) {
    if (rwAiming) { rwAiming = false; rwDir = null; }
    w.classList.remove('aim');
    for (const d of RW_DIRS) document.getElementById('rw' + d[0].toUpperCase() + d.slice(1))?.classList.remove('active');
    const ptr = document.getElementById('rwPtr');
    if (ptr) ptr.style.transform = 'translate(-50%,-100%) rotate(0deg) scaleY(0)';
    return;
  }
  // 角度：屏幕坐标 y 向下，取负使“上”为正
  let ang = Math.atan2(-rwVY, rwVX) * 180 / Math.PI; // [-180,180], 0=右, 90=上
  if (ang < 0) ang += 360;                            // [0,360)
  // 四象限映射：右[315,45) 上[45,135) 左[135,225) 下[225,315)
  let dir;
  if (ang >= 45 && ang < 135) dir = 'up';
  else if (ang >= 135 && ang < 225) dir = 'left';
  else if (ang >= 225 && ang < 315) dir = 'down';
  else dir = 'right';
  // 迟滞：已选中某方向时，须越过临界角 + RW_HYST 才换向，避免边界抖动
  if (rwDir && dir !== rwDir) {
    const center = { right: 0, up: 90, left: 180, down: 270 }[rwDir];
    let diff = Math.abs(((ang - center + 540) % 360) - 180); // 距当前方向中心的角差
    if (diff < 45 + RW_HYST) dir = rwDir; // 仍在迟滞带内，保持原方向
  }
  rwAiming = true; rwDir = dir;
  w.classList.add('aim');
  for (const d of RW_DIRS) {
    const seg = document.getElementById('rw' + d[0].toUpperCase() + d.slice(1));
    if (seg) seg.classList.toggle('active', d === dir);
  }
  // 指针：指向拨动方向（CSS 0° 向上，顺时针为正 → 由屏幕角换算）
  const ptr = document.getElementById('rwPtr');
  if (ptr) {
    const rot = (90 - ang + 360) % 360; // 屏幕角→CSS rotate(0=上,顺时针+)
    ptr.style.transform = 'translate(-50%,-100%) rotate(' + rot + 'deg) scaleY(1)';
  }
}

function showWheel() {
  if (rwOpen) return;
  rwOpen = true; rwAiming = false; rwDir = null; rwVX = 0; rwVY = 0;
  initAudio(); startMusic();
  refreshWheel();
  const w = elWheel();
  if (w) { w.classList.remove('aim'); w.classList.add('show'); }
  rwUpdateAim();
}

// 松手：在瞄准方向上执行动作；死区内松手=取消
function hideWheel(commit) {
  if (!rwOpen) return;
  rwOpen = false;
  const w = elWheel();
  if (w) { w.classList.remove('show'); w.classList.remove('aim'); }
  if (commit && rwAiming && rwDir) radioAction(rwDir);
  rwAiming = false; rwDir = null;
}

// 方向 → 电台动作（瞬时手势 + 调用 audio.js）
function radioAction(dir) {
  initAudio(); startMusic();
  switch (dir) {
    case 'right': // 下一首
      if (G.musicMode !== 'playlist' || !G.musicOn) setMusicMode('playlist');
      nextTrack();
      showMsg('⏭ 下一首', 800, 26);
      break;
    case 'left':  // 上一首
      if (G.musicMode !== 'playlist' || !G.musicOn) setMusicMode('playlist');
      prevTrack();
      showMsg('⏮ 上一首', 800, 26);
      break;
    case 'down':  // 播 / 停
      if (!G.musicOn) {
        setMusic(true, false);
        if (G.musicMode === 'playlist') startPlaylist();
        showMsg(G.musicMode === 'playlist' ? '🎵 歌单 开' : '🎵 Lofi 电台 开', 900, 26);
      } else {
        setMusic(false, false);
        showMsg('⏸ 已暂停', 900, 26);
      }
      break;
    case 'up':    // 关闭（取消，无操作）
      break;
  }
  refreshWheel();
  refreshRadioInfo();
}

// 鼠标增量当摇杆：仅在轮盘开启时累积（沿用旧版思路，判定做漂亮）
addEventListener('mousemove', (e) => {
  if (!rwOpen) return;
  rwVX += e.movementX || 0;
  rwVY += e.movementY || 0;
  // 限制半径，避免越拨越远导致无法回死区取消
  const r = Math.hypot(rwVX, rwVY), MAX = 150;
  if (r > MAX) { rwVX = rwVX / r * MAX; rwVY = rwVY / r * MAX; }
  rwUpdateAim();
});

// 方向键瞬时拨动（轮盘开启时；不影响驾驶，因为仅在 rwOpen 时拦截）
function rwNudge(dx, dy) {
  if (!rwOpen) return;
  rwVX = dx * 96; rwVY = dy * 96; // 直接定位到对应方向（超过 RW_ARM，明确锁定）
  rwUpdateAim();
}
// ---------- 键盘 ----------
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') {
    if (rwOpen) { hideWheel(false); return; } // 轮盘开启时 ESC=取消，不进菜单
    if (G.appState === 'drive' || G.appState === 'walk') pauseGame();
    else if (G.appState === 'pause') { if (performance.now() - (G._pauseT || 0) > 350) resumeGame(); }
    else if (G.appState === 'photo') exitPhoto();
  }
  if (e.code === 'KeyP') {
    if (G.appState === 'drive' || G.appState === 'walk' || G.appState === 'pause') enterPhoto();
    else if (G.appState === 'photo') exitPhoto();
  }
  // 全局设置键（车库内同样可用）
  if (e.code === 'KeyV') { G.skinIdx = (G.skinIdx+1) % PAINTS.length; applySkin(true); }
  // N 键时间切换已移除：天气系统自动管理昼夜循环
  if (e.code === 'KeyM') { G.muted = !G.muted; refreshSettingBtns(); saveSettings(); showMsg(G.muted?'引擎声 关':'引擎声 开', 800, 24); }
  // 长按 B 唤出径向轮盘（B 非驾驶键，仅在驾驶/步行态生效）
  if (e.code === 'KeyB') {
    if (!e.repeat && (G.appState === 'drive' || G.appState === 'walk')) showWheel();
    e.preventDefault();
  }
  // 轮盘开启时：方向键瞬时拨动（仅 rwOpen 时拦截，松手后方向键回归驾驶）
  if (rwOpen) {
    if (e.code === 'ArrowLeft')  { rwNudge(-1, 0); e.preventDefault(); }
    else if (e.code === 'ArrowRight') { rwNudge(1, 0);  e.preventDefault(); }
    else if (e.code === 'ArrowUp')    { rwNudge(0, -1); e.preventDefault(); }
    else if (e.code === 'ArrowDown')  { rwNudge(0, 1);  e.preventDefault(); }
    else if (e.code === 'Enter')      { hideWheel(true); e.preventDefault(); }
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
        document.body.classList.remove('drive'); // 步行时隐藏整套驾驶 HUD（电量/车速/导航线/AUTOSTEER/电台卡）
        document.body.style.cursor = 'none';
        canvas.requestPointerLock?.(); // 按键即用户手势，直接锁定鼠标控镜头，无需再点屏幕
        showMsg('🚶 步行模式｜WASD 移动(跟随镜头) · 鼠标转视角 · SHIFT 跑 · SPACE 跳 · F 上车 · ESC 菜单', 5200, 21);
      } else showMsg('角色还在加载…', 1200, 24);
    } else if (G.appState === 'walk') {
      G.appState = 'drive'; // 先切状态，避免 exitPointerLock 的 pointerlockchange 误触发暂停
      setCharacterVisible(false);
      document.body.classList.add('drive'); // 上车恢复驾驶 HUD
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
  // 松开 B：轮盘选中当前方向（死区内=取消）
  if (e.code === 'KeyB' && rwOpen) hideWheel(true);
});
// 轮盘是瞬时手势：不需解锁鼠标，用鼠标增量当摇杆，不影响 pointerlock。
// 步行时按 ESC 会先被浏览器用于退出指针锁定 → 监听解锁事件来打开菜单（单次 ESC 即可进菜单）
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement) {
    if (G.appState === 'walk') pauseGame();
  }
});

// ---------- HUD / 小地图 ----------
const elSpeed = document.getElementById('speed');
const elMode = document.getElementById('mode');
const elNitro = document.getElementById('nitrofill');
const elGear = document.getElementById('gear');
const gArc = document.getElementById('gArc');
let gLen = 360.3;
if (gArc) {
  try { const L = gArc.getTotalLength(); if (L > 1) gLen = L; } catch(e) {}
  gArc.style.strokeDasharray = gLen;
  gArc.style.strokeDashoffset = gLen;
}
const elLap = document.getElementById('laptime');
const elCp = document.getElementById('cpinfo');
const elBest = document.getElementById('besttime');
const mm = document.getElementById('minimap').getContext('2d');
const MM_C = 85;            // 小地图中心（画布 170×170）
const MM_R = 80;            // 圆形 clip 半径
let mmScale;
{
  // 跟车小地图：固定缩放，显示车周围一段路网。
  // 用整条环线跨度推一个合适比例。
  let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
  for (const p of samples) { minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z); }
  const span = Math.max(maxX-minX, maxZ-minZ);
  mmScale = (146/span) * 2.4; // 比整览图放大 2.4×，呈现“跟车局部”观感
}
// slowroads 跟车投影：世界坐标先减车位、按 -heading 旋转使车头朝上，再缩放并平移到中心。
function mmPt(x, z) {
  const dx = (x - state.pos.x) * mmScale;
  const dz = (z - state.pos.z) * mmScale;
  const a = -state.heading;
  const ca = Math.cos(a), sa = Math.sin(a);
  const rx =  dx * ca - dz * sa;
  const rz =  dx * sa + dz * ca;
  return [MM_C + rx, MM_C - rz];
}
function drawMinimap() {
  // 常驻信息卡：仅在标签变化时写 DOM（避免逐帧冗余）
  const _ril = (G.musicOn ? '1' : '0') + '|' + G.musicMode + '|' + rwTrackLabel();
  if (_ril !== drawMinimap._ril) { drawMinimap._ril = _ril; refreshRadioInfo(); }
  mm.clearRect(0,0,170,170);
  mm.save();
  // 圆形裁剪，边缘更干净（slowroads 风）
  mm.beginPath(); mm.arc(MM_C, MM_C, MM_R, 0, Math.PI*2); mm.clip();
  // 主路环线
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
  mm.restore();
  // 车始终在中心，三角朝上（车头方向）
  mm.save();
  mm.translate(MM_C, MM_C);
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
