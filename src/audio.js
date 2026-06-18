import { G } from './core.js';
import { state } from './vehicle.js';
import { keys, refreshSettingBtns, saveSettings, showMsg } from './ui.js';

// ---------- 音效 ----------
let actx = null, oA, oB, oW, gMain;
let scrSrc = null, scrFilt = null, scrGain = null;
function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    gMain = actx.createGain(); gMain.gain.value = 0; gMain.connect(actx.destination);
    const filt = actx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 700;
    filt.connect(gMain);
    oA = actx.createOscillator(); oA.type = 'sawtooth'; oA.frequency.value = 55; oA.connect(filt);
    oB = actx.createOscillator(); oB.type = 'triangle'; oB.frequency.value = 110; oB.connect(filt);
    oW = actx.createOscillator(); oW.type = 'sine'; oW.frequency.value = 500;
    const gW = actx.createGain(); gW.gain.value = 0.18; oW.connect(gW); gW.connect(gMain);
    oA.start(); oB.start(); oW.start();
    // 轮胎摩擦声（漂移时渐入）
    const sb = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const sd = sb.getChannelData(0);
    for (let i = 0; i < sd.length; i++) sd[i] = Math.random()*2 - 1;
    scrSrc = actx.createBufferSource();
    scrSrc.buffer = sb; scrSrc.loop = true;
    scrFilt = actx.createBiquadFilter(); scrFilt.type = 'bandpass'; scrFilt.frequency.value = 950; scrFilt.Q.value = 1.4;
    scrGain = actx.createGain(); scrGain.gain.value = 0;
    scrSrc.connect(scrFilt); scrFilt.connect(scrGain); scrGain.connect(actx.destination);
    scrSrc.start();
  } catch(e) {}
}
// ---------- Lofi 电台（WebAudio 程序化生成，City Pop / Nujabes 氛围） ----------
let mGain = null, mTimer = null, mBar = 0, noiseBuf = null;
const CHORDS = [ // Fmaj7 → Em7 → Dm7 → Cmaj7
  [174.61, 220.00, 261.63, 329.63],
  [164.81, 196.00, 246.94, 293.66],
  [146.83, 174.61, 220.00, 261.63],
  [130.81, 164.81, 196.00, 246.94]
];
const PENTA = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25];
function makeNoiseBurst() {
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, Math.floor(actx.sampleRate*0.3), actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random()*2 - 1;
  }
  return noiseBuf;
}
function startMusic() {
  if (!actx || mGain) return;
  if (G.musicMode === 'playlist') return; // 歌单模式下不初始化 Lofi
  mGain = actx.createGain();
  mGain.gain.value = G.musicOn ? 0.16 : 0;
  mGain.connect(actx.destination);
  // 黑胶底噪
  const nbuf = actx.createBuffer(1, actx.sampleRate*2, actx.sampleRate);
  const nd = nbuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = (Math.random()*2-1) * (Math.random() < 0.0006 ? 0.5 : 0.012);
  const vinyl = actx.createBufferSource();
  vinyl.buffer = nbuf; vinyl.loop = true;
  const vf = actx.createBiquadFilter(); vf.type = 'highpass'; vf.frequency.value = 1200;
  const vg = actx.createGain(); vg.gain.value = 0.5;
  vinyl.connect(vf); vf.connect(vg); vg.connect(mGain);
  vinyl.start();
  scheduleBar();
}
function scheduleBar() {
  if (!actx || !mGain) return;
  const bpm = 74, beat = 60/bpm, bar = beat*4;
  const t0 = actx.currentTime + 0.05;
  const chord = CHORDS[mBar % 4];
  // 和声垫（低通三角波，缓起缓落）
  for (const f of chord) {
    const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const fl = actx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 900;
    const g = actx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.05, t0 + 0.5);
    g.gain.setTargetAtTime(0.032, t0 + bar*0.6, 0.4);
    g.gain.linearRampToValueAtTime(0, t0 + bar + 0.25);
    o.connect(fl); fl.connect(g); g.connect(mGain);
    o.start(t0); o.stop(t0 + bar + 0.3);
  }
  for (let b = 0; b < 4; b++) {
    const bt = t0 + b*beat;
    if (b === 0 || b === 2) { // 低沉底鼓
      const o = actx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(140, bt);
      o.frequency.exponentialRampToValueAtTime(45, bt + 0.12);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.5, bt);
      g.gain.exponentialRampToValueAtTime(0.001, bt + 0.25);
      o.connect(g); g.connect(mGain);
      o.start(bt); o.stop(bt + 0.3);
    }
    if (b === 1 || b === 3) { // 懒拍军鼓（拖 20ms）
      const st = bt + 0.02;
      const nb = actx.createBufferSource(); nb.buffer = makeNoiseBurst();
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.2, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.18);
      nb.connect(bp); bp.connect(g); g.connect(mGain);
      nb.start(st);
    }
    for (const off of [0, beat*0.55]) { // 摇摆 hi-hat
      const ht = bt + off;
      const nb = actx.createBufferSource(); nb.buffer = makeNoiseBurst();
      const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const g = actx.createGain();
      g.gain.setValueAtTime(off === 0 ? 0.05 : 0.03, ht);
      g.gain.exponentialRampToValueAtTime(0.001, ht + 0.05);
      nb.connect(hp); hp.connect(g); g.connect(mGain);
      nb.start(ht);
    }
  }
  // 偶发五声音阶琶音
  if (mBar % 2 === 1) {
    const n = 2 + Math.floor(Math.random()*3);
    for (let k = 0; k < n; k++) {
      const nt = t0 + beat*Math.floor(Math.random()*8)*0.5;
      const o = actx.createOscillator(); o.type = 'sine';
      o.frequency.value = PENTA[Math.floor(Math.random()*PENTA.length)]*2;
      const g = actx.createGain();
      g.gain.setValueAtTime(0, nt);
      g.gain.linearRampToValueAtTime(0.055, nt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, nt + 0.7);
      o.connect(g); g.connect(mGain);
      o.start(nt); o.stop(nt + 0.8);
    }
  }
  mBar++;
  mTimer = setTimeout(scheduleBar, bar*1000 - 60);
}
function setMusic(on, announce) {
  G.musicOn = on;
  if (on && G.musicMode === 'playlist') {
    stopLofi();
    startPlaylist();
  } else if (on) {
    stopPlaylist();
    if (mGain && actx) mGain.gain.setTargetAtTime(0.16, actx.currentTime, 0.3);
  } else {
    if (mGain && actx) mGain.gain.setTargetAtTime(0, actx.currentTime, 0.3);
    stopPlaylist();
  }
  refreshSettingBtns();
  saveSettings();
  if (announce) {
    if (on && G.musicMode === 'playlist') showMsg('🎵 歌单模式 开', 900, 26);
    else if (on) showMsg('🎵 Lofi 电台 开', 900, 26);
    else showMsg('音乐 关', 900, 26);
  }
}

// ---------- 歌单播放（MP3 文件，HTML5 Audio） ----------
const PLAYLIST = [
  { name: 'Loves Me Not', artist: 't.A.T.u.', src: './assets/music/Loves Me Not - t.A.T.u..mp3' },
  { name: 'Year 3000', artist: 'Busted', src: './assets/music/Year 3000 - Busted.mp3' },
  { name: '爱你等于爱自己', artist: '王力宏', src: './assets/music/爱你等于爱自己 - 王力宏.mp3' },
  { name: '爱上未来的你', artist: '潘玮柏', src: './assets/music/爱上未来的你 - 潘玮柏.mp3' },
  { name: '大雨将至', artist: '阿修罗乐队', src: './assets/music/大雨将至 - 阿修罗乐队.mp3' },
  { name: '亲爱的', artist: '潘玮柏', src: './assets/music/亲爱的 - 潘玮柏.mp3' },
  { name: '想你', artist: '姜云升', src: './assets/music/想你 - 姜云升.mp3' },
  { name: '학교에서 배운 것', artist: '김진표', src: './assets/music/학교에서 배운 것 - 김진표.mp3' }
];

let plAudio = null;   // HTMLAudioElement
let plIdx = 0;        // 当前曲目索引
let plShuffle = false; // 随机播放
let plActive = false;  // 歌单是否正在播放

try { plShuffle = localStorage.getItem('p7_plShuffle') === '1'; } catch(e) {}

function ensurePlAudio() {
  if (!plAudio) {
    plAudio = new Audio();
    plAudio.volume = 0.5;
    plAudio.addEventListener('ended', nextTrack);
  }
}

function startPlaylist() {
  ensurePlAudio();
  plActive = true;
  if (!plAudio.src || plAudio.paused) {
    plAudio.src = PLAYLIST[plIdx].src;
    plAudio.play().catch(() => {});
  }
  refreshPlaylistUI();
}

function stopPlaylist() {
  plActive = false;
  if (plAudio) { plAudio.pause(); }
}

function playCurrentTrack() {
  if (!plAudio || !plActive) return;
  plAudio.src = PLAYLIST[plIdx].src;
  plAudio.play().catch(() => {});
  refreshPlaylistUI();
}

function nextTrack() {
  if (plShuffle) {
    let next;
    do { next = Math.floor(Math.random() * PLAYLIST.length); }
    while (next === plIdx && PLAYLIST.length > 1);
    plIdx = next;
  } else {
    plIdx = (plIdx + 1) % PLAYLIST.length;
  }
  if (plActive) playCurrentTrack();
}

function prevTrack() {
  if (plAudio && plAudio.currentTime > 3) {
    plAudio.currentTime = 0;
    return;
  }
  plIdx = (plIdx - 1 + PLAYLIST.length) % PLAYLIST.length;
  if (plActive) playCurrentTrack();
}

function toggleShuffle() {
  plShuffle = !plShuffle;
  try { localStorage.setItem('p7_plShuffle', plShuffle ? '1' : '0'); } catch(e) {}
  refreshPlaylistUI();
  showMsg(plShuffle ? '随机播放 开' : '随机播放 关', 900, 24);
}

function getCurrentTrack() {
  return PLAYLIST[plIdx] || null;
}

function refreshPlaylistUI() {
  const el = document.getElementById('plTrackName');
  if (el) {
    const t = PLAYLIST[plIdx];
    el.textContent = t ? (t.name + ' - ' + t.artist) : '';
  }
  const shBtn = document.getElementById('plShuffle');
  if (shBtn) shBtn.textContent = plShuffle ? '🔀 随机' : '🔀 顺序';
}

function setLofiGain(val) {
  if (mGain && actx) mGain.gain.setTargetAtTime(val, actx.currentTime, 0.3);
}

function stopLofi() {
  if (mTimer) { clearTimeout(mTimer); mTimer = null; }
  if (mGain) { mGain.disconnect(); mGain = null; }
}

function audioUpdate() {
  if (!actx) return;
  if (G.appState !== 'drive') { gMain.gain.value = 0; return; }
  const s0 = Math.abs(state.speed);
  const s = isFinite(s0) ? s0 : 0; // 守卫：非有限值赋给 AudioParam 会抛异常
  oA.frequency.value = 50 + s*2.4;
  oB.frequency.value = 100 + s*4.8;
  oW.frequency.value = 380 + s*26;
  const throttle = (keys['KeyW']||keys['ArrowUp']) ? 1 : 0;
  gMain.gain.value = G.muted ? 0 : Math.min(0.001 + s*0.0016 + throttle*0.025, 0.09);
  // 漂移摩擦声强度随侧滑速度
  if (scrGain) {
    const fx2 = Math.sin(state.heading), fz2 = Math.cos(state.heading);
    const vL0 = state.vx*fz2 - state.vz*fx2;
    const vLat = isFinite(vL0) ? vL0 : 0;
    const drifting = G.appState === 'drive' && keys['Space'] && Math.abs(vLat) > 3.5 && s > 8;
    const tgt = (G.muted || !drifting) ? 0 : Math.min(0.16, Math.abs(vLat)*0.012);
    // 手动插值替代 setTargetAtTime：长时间漂移不再累积音频自动化事件
    scrGain.gain.value = scrGain.gain.value + (tgt - scrGain.gain.value) * 0.22;
    scrFilt.frequency.value = 800 + Math.min(600, Math.abs(vLat)*30);
  }
}


export { initAudio, audioUpdate, startMusic, setMusic, actx, makeNoiseBurst,
  PLAYLIST, startPlaylist, stopPlaylist, nextTrack, prevTrack, toggleShuffle,
  getCurrentTrack, refreshPlaylistUI, setLofiGain, stopLofi, plShuffle };
