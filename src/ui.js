import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { G, camera, renderer, canvas, composer, bloomPass } from './core.js';
import { PRESETS, samples, tangents, bSamples, NS, nearestRoad, applyTod, fallbackOcean } from './world.js';
import { PAINTS, applySkin, state, settleCarPose, camPos, camDamp, camAng } from './vehicle.js';
import { PRESETS as TODP } from './world.js';
import { race, toggleRace, startRace, endRace, saveBestScore, ROUTES, selectRoute, getRecordsView, getShareStats, zones } from './gameplay.js';
import { initAudio, startMusic, setMusic } from './audio.js';

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
  try { localStorage.setItem('p7_set', JSON.stringify({skinIdx: G.skinIdx, curTod: G.curTod, hiQuality: G.hiQuality, muted: G.muted, musicOn: G.musicOn, hintsOn, routeId: race.routeIdx})); } catch(e) {}
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('p7_set') || '{}');
    if (typeof s.skinIdx === 'number' && s.skinIdx >= 0 && s.skinIdx < PAINTS.length) G.skinIdx = s.skinIdx;
    if (s.curTod && PRESETS[s.curTod]) G.curTod = s.curTod;
    if (typeof s.hiQuality === 'boolean') G.hiQuality = s.hiQuality;
    if (typeof s.muted === 'boolean') G.muted = s.muted;
    if (typeof s.musicOn === 'boolean') G.musicOn = s.musicOn;
    if (typeof s.hintsOn === 'boolean') hintsOn = s.hintsOn;
    if (typeof s.routeId === 'number') selectRoute(s.routeId);
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
}

function setQuality(q) {
  G.hiQuality = q;
  bloomPass.strength = G.hiQuality ? PRESETS[G.curTod].bloom : 0;
  if (G.waterOK) { G.water.visible = G.hiQuality; fallbackOcean.visible = !G.hiQuality; }
  const pr = Math.min(window.devicePixelRatio, G.hiQuality ? 1.5 : 1);
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  refreshSettingBtns(); saveSettings();
}
for (const id of ['gQuality','pQuality']) document.getElementById(id).addEventListener('click', () => setQuality(!G.hiQuality));
for (const id of ['gSound','pSound']) document.getElementById(id).addEventListener('click', () => { G.muted = !G.muted; refreshSettingBtns(); saveSettings(); });
for (const id of ['gMusic','pMusic']) document.getElementById(id).addEventListener('click', () => { initAudio(); startMusic(); setMusic(!G.musicOn, false); });

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
  showKeytipsFresh();
  G.appState = 'drive';
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
  G.appState = 'pause';
  clearKeys();
  saveBestScore();
  elPause.classList.add('show');
  controls.enabled = false;
  if (race.phase === 'racing') race.pauseT = performance.now();
}
function resumeGame() {
  G.appState = 'drive';
  elPause.classList.remove('show');
  if (race.phase === 'racing') race.t0 += performance.now() - race.pauseT;
}
function enterPhoto() {
  const fromDrive = G.appState === 'drive';
  G.appState = 'photo';
  clearKeys();
  document.body.classList.add('nohud');
  document.body.classList.add('photo');
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
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'XPENG_P7_' + Date.now() + '.png';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  showMsg('已保存截图 📸', 1200, 30);
});

// ---------- 键盘 ----------
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') {
    if (G.appState === 'drive') pauseGame();
    else if (G.appState === 'pause') resumeGame();
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
  if (e.code === 'KeyB') { initAudio(); startMusic(); setMusic(!G.musicOn, true); }
  if (e.code === 'KeyQ') { setQuality(!G.hiQuality); showMsg(G.hiQuality?'画质：高':'画质：低', 900, 26); }
  if (e.code === 'KeyH') {
    hintsOn = !hintsOn;
    refreshKeytips();
    saveSettings();
    if (hintsOn) showMsg('键位提示 开', 800, 24);
  }
  if (G.appState === 'garage' || G.appState === 'photo') return;
  if (e.code === 'KeyC') G.camMode = (G.camMode+1) % 5; // 远追/近追/贴尾(极品飞车式)/座舱/环绕
  if (e.code === 'KeyR') toggleRace();
  if (e.code === 'KeyT') { // 一键复位：卡住/落水/翻出地图都能脱困
    const nrT = nearestRoad(state.pos.x, state.pos.z);
    state.pos.set(samples[nrT.idx].x, samples[nrT.idx].y + 0.1, samples[nrT.idx].z);
    state.heading = state.travel = Math.atan2(tangents[nrT.idx].x, tangents[nrT.idx].z);
    state.speed = 0; state.vx = 0; state.vz = 0; state.vyAir = 0;
    settleCarPose();
    showMsg('已复位到道路', 1000, 28);
  }
});
addEventListener('keyup', e => keys[e.code] = false);

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
  refreshRecords();
  refreshSwatches();
  refreshTodButtons();
  refreshSettingBtns();
}

export { controls, keys, showMsg, refreshSwatches, refreshTodButtons, refreshSettingBtns, saveSettings, setQuality, enterGarage, startDrive, pauseGame, resumeGame, enterPhoto, exitPhoto, drawMinimap, elSpeed, elMode, elNitro, elGear, gArc, gLen, elLap, elCp, elBest };
