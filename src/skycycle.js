import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { G, scene, renderer, camera, sun, hemi, rim, bloomPass } from './core.js';
import { curSunDir, env, sky, stars, fallbackOcean, oceanUniforms } from './world.js';
import { SKY_PRESETS } from './skyPresets.js';
import { WeatherController } from './weatherController.js';

// ---------- 动态天空 / 随机天气状态机 ----------
// 慢速昼夜循环（12 分钟）+ 随机天气，替代旧的 84 秒固定 HDR 轮播。
// 可见天空背景 = blendRT.texture（等距 HDR 混合），不用 cubeRT 避免光球。
// 反射环境 = blendRT → clamp → PMREM → scene.environment。
// 车身真实反射 = reflectRT.texture（由 vehicle.js CubeCamera 渲染）。
// 禁止：procedural sun / sunSprite / 程序月亮 / 程序云片 / 程序星点。

// 从 SKY_PRESETS 提取唯一 HDR 文件名并建立索引
const PRESET_KEYS = Object.keys(SKY_PRESETS);
const UNIQUE_FILES = [...new Set(PRESET_KEYS.map(k => SKY_PRESETS[k].file))];
const fileToIdx = {};
UNIQUE_FILES.forEach((f, i) => { fileToIdx[f] = i; });
const N = UNIQUE_FILES.length;

const texs = new Array(N);
let ready = false, loaded = 0, lastEnvTex = null;
let _lastBlend = -1, _lastPreset = '';
let blendRT, blendScene, blendCam, blendMat, envScene, envGround, pmrem, envSrcRT, clampScene, clampMat;
let weatherCtrl = null;
let _dbg = null;

function anyTex() { for (let t = 0; t < N; t++) if (texs[t]) return texs[t]; return null; }
function texForPreset(name) { const p = SKY_PRESETS[name]; return p ? texs[fileToIdx[p.file]] : null; }

export function buildSkyCycle() {
  // blendRT：等距 HDR 交叉混合
  blendRT = new THREE.WebGLRenderTarget(1536, 768, { type: THREE.HalfFloatType, depthBuffer: false });
  blendRT.texture.mapping = THREE.EquirectangularReflectionMapping;
  blendRT.texture.minFilter = THREE.LinearFilter;
  blendRT.texture.magFilter = THREE.LinearFilter;
  blendRT.texture.generateMipmaps = false;
  blendScene = new THREE.Scene();
  blendCam = new THREE.Camera();
  blendMat = new THREE.ShaderMaterial({
    uniforms: { tA: { value: null }, tB: { value: null }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tA; uniform sampler2D tB; uniform float uT; varying vec2 vUv; void main(){ gl_FragColor = mix(texture2D(tA, vUv), texture2D(tB, vUv), uT); }',
    depthTest: false, depthWrite: false
  });
  blendScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blendMat));

  // 反射钳制：HDR 太阳高达数万会溢出成方块，钳到 12 后太阳变有界圆亮点
  envSrcRT = new THREE.WebGLRenderTarget(1024, 512, { type: THREE.HalfFloatType, depthBuffer: false });
  envSrcRT.texture.mapping = THREE.EquirectangularReflectionMapping;
  envSrcRT.texture.minFilter = THREE.LinearFilter; envSrcRT.texture.magFilter = THREE.LinearFilter; envSrcRT.texture.generateMipmaps = false;
  clampScene = new THREE.Scene();
  clampMat = new THREE.ShaderMaterial({
    uniforms: { tBlend: { value: null }, uMax: { value: 12.0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tBlend; uniform float uMax; varying vec2 vUv; void main(){ vec3 c = texture2D(tBlend, vUv).rgb; gl_FragColor = vec4(min(c, vec3(uMax)), 1.0); }',
    depthTest: false, depthWrite: false
  });
  clampScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), clampMat));
  envScene = new THREE.Scene();
  const envSkyMesh = new THREE.Mesh(
    new THREE.SphereGeometry(300, 48, 32),
    new THREE.MeshBasicMaterial({ map: envSrcRT.texture, side: THREE.BackSide, toneMapped: false, depthTest: false, depthWrite: false, fog: false })
  );
  envSkyMesh.renderOrder = -1;
  envScene.add(envSkyMesh);
  envGround = new THREE.Mesh(new THREE.CircleGeometry(160, 48), new THREE.MeshBasicMaterial({ color: 0x5a5348, toneMapped: false }));
  envGround.rotation.x = -Math.PI / 2; envGround.position.y = -6;
  envScene.add(envGround);
  pmrem = new THREE.PMREMGenerator(renderer);

  // 天气控制器：12 分钟昼夜 + 随机天气
  weatherCtrl = new WeatherController();

  // 调试条
  _dbg = document.createElement('div');
  _dbg.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:99999;background:rgba(0,0,0,.65);color:#5f5;font:12px monospace;padding:3px 10px;border-radius:4px;pointer-events:none;white-space:nowrap';
  _dbg.textContent = 'SKY 加载中 0/' + N;
  document.body.appendChild(_dbg);

  // 加载唯一 HDR 文件
  const loader = new RGBELoader();
  UNIQUE_FILES.forEach((file, i) => loader.load('assets/sky/' + file + '.hdr', (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    texs[i] = tex;
    loaded++;
    console.log('[SKY] 已加载', file, loaded + '/' + N);
    if (!ready) start();
  }, undefined, (e) => { console.warn('[SKY] HDRI 加载失败', file, e); if (_dbg) _dbg.textContent = 'SKY 加载失败: ' + file; }));
}

function start() {
  if (sky) sky.visible = false;              // 隐藏程序化天空球
  scene.background = blendRT.texture;        // 等距混合做可见背景（不用 cubeRT 避免光球）
  // 禁用程序天体：月亮/云/星点 → 全部由 HDR 自带内容表现
  if (env.moon) env.moon.visible = false;
  if (env.clouds) for (const c of env.clouds) c.visible = false;
  if (stars) stars.visible = false;
  ready = true;
  // 启动时立即生成首张 PMREM（给 scene.environment 一个初始值，避免首帧反射缺失）
  const initTex = anyTex();
  if (initTex) {
    clampMat.uniforms.tBlend.value = initTex;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(envSrcRT);
    renderer.render(clampScene, blendCam);
    renderer.setRenderTarget(prev);
    const rt = pmrem.fromScene(envScene, 0.06);
    lastEnvTex = rt.texture;
    scene.environment = lastEnvTex;
  }
}

const _z = new THREE.Color(0);
const _lampLit = new THREE.Color(0xfff4e0);
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
function smooth(t) { return t * t * (3 - 2 * t); }

export function skyCycleUpdate(dt) {
  if (!ready || !G.weatherOn) {
    if (_dbg) _dbg.textContent = `SKY 载入${loaded}/${N} ready=${ready} weather=${G.weatherOn}`;
    return;
  }
  try {
  // 天气状态机更新
  weatherCtrl.update(dt);
  const ws = weatherCtrl.getState();
  const A = SKY_PRESETS[ws.currentPreset];
  const B = SKY_PRESETS[ws.nextPreset];
  const f = smooth(ws.blend);  // 平滑过渡系数

  // HDR 混合渲染到 blendRT
  const texA = texForPreset(ws.currentPreset);
  const texB = texForPreset(ws.nextPreset);
  let curTex;
  if (texA && texB) {
    blendMat.uniforms.tA.value = texA;
    blendMat.uniforms.tB.value = texB;
    blendMat.uniforms.uT.value = f;
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(blendRT);
    renderer.render(blendScene, blendCam);
    renderer.setRenderTarget(prevRT);
    curTex = blendRT.texture;
  } else {
    curTex = texA || texB || anyTex();
  }

  // 可见天空背景：blendRT（等距混合），不用 cubeRT
  // 强制每帧设置以确保 three.js r169 正确更新背景
  if (curTex) scene.background = blendRT.texture;

  const nightAmt = ws.nightAmount;

  // 光照插值
  sun.color.copy(A._sunC).lerp(B._sunC, f);
  sun.intensity = A.sunI + (B.sunI - A.sunI) * f;
  curSunDir.copy(A._dir).lerp(B._dir, f).normalize();
  hemi.color.copy(A._hemiC).lerp(B._hemiC, f);
  hemi.intensity = A.hemiI + (B.hemiI - A.hemiI) * f;
  scene.fog.color.copy(A._fog).lerp(B._fog, f);
  renderer.toneMappingExposure = A.exp + (B.exp - A.exp) * f;
  scene.environmentIntensity = A.envI + (B.envI - A.envI) * f;
  bloomPass.strength = G.hiQuality ? (A.bloom + (B.bloom - A.bloom) * f) : 0;
  rim.intensity = 0.42 * (1 - nightAmt) + 0.12 * nightAmt;
  rim.color.copy(sun.color);
  if (G.waterOK && G.water && oceanUniforms) {
    // 三段式着色随时段插值：深水区跟 preset 水色走，浅滩和远海做偏移
    const baseWater = new THREE.Color(A._water).lerp(new THREE.Color(B._water), f);
    oceanUniforms.deepColor.value.copy(baseWater);
    oceanUniforms.shallowColor.value.copy(baseWater).offsetHSL(0.05, 0.15, 0.20); // 浅滩偏亮偏青
    oceanUniforms.horizonColor.value.copy(baseWater).offsetHSL(-0.02, -0.05, 0.10); // 远海偏灰偏亮
    oceanUniforms.fogColor.value.copy(scene.fog.color);
  }

  // 夜间灯光：连续淡入系数 nf
  const nf = smooth(clamp01((nightAmt - 0.3) / 0.4));
  for (const h of G.headlights) h.intensity = 150 * nf;
  if (env.lampHeadM) {
    env.lampHeadM.emissiveIntensity = 0.1 + (2.2 - 0.1) * nf;
    env.lampPools.material.opacity = 0.4 * nf;
    env.lampPools.visible = nf > 0.01;
    env.moon.visible = false;           // 禁止程序月亮
    env.fireflies.visible = nf > 0.01;
    env.beamGrp.visible = nf > 0.01;
    if (env.lanternM) env.lanternM.emissiveIntensity = 0.15 + (2.4 - 0.15) * nf;
  }
  if (env.clouds) for (const c of env.clouds) c.visible = false;  // 禁止程序云片
  if (stars) stars.visible = false;                                // 禁止程序星点

  for (const m of G.lampMats) {
    const origE = m.userData?.origEmissive || _z;
    const origI = m.userData?.origEI ?? 1;
    m.emissive.copy(origE).lerp(_lampLit, nf);
    m.emissiveIntensity = origI + (1.7 - origI) * nf;
  }

  // PMREM 反射环境：仅在 blend 变化超 5% 或 preset 切换时重建
  // 避免每秒 fromScene 的性能尖峰；过渡期间 PMREM 缓动更新，视觉无感
  const blendDelta = Math.abs(f - _lastBlend);
  const presetChanged = ws.currentPreset !== _lastPreset;
  if (blendDelta > 0.05 || presetChanged) {
    _lastBlend = f;
    _lastPreset = ws.currentPreset;
    envGround.material.color.copy(A._grd).lerp(B._grd, f);
    clampMat.uniforms.tBlend.value = curTex;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(envSrcRT);
    renderer.render(clampScene, blendCam);
    renderer.setRenderTarget(prev);
    const rt = pmrem.fromScene(envScene, 0.06);
    if (lastEnvTex) lastEnvTex.dispose();
    lastEnvTex = rt.texture;
    scene.environment = lastEnvTex;
  }
  if (_dbg) _dbg.textContent = `SKY ${ws.todPhase} ${ws.currentPreset}${ws.inTransition ? '→' + ws.nextPreset : ''} blend=${f.toFixed(2)} night=${nightAmt.toFixed(2)} sunY=${curSunDir.y.toFixed(2)}`;
  } catch (e) {
    if (_dbg) _dbg.textContent = 'SKY 异常: ' + (e && e.message ? e.message : e);
  }
}
