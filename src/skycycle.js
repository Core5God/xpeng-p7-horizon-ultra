import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { G, scene, renderer, camera, sun, hemi, rim, bloomPass } from './core.js';
import { curSunDir, env, sky, stars, fallbackOcean } from './world.js';

// ---------- 动态天空 / 天气循环（HDR 贴图交叉淡入）----------
// 5 个时段关键帧（按时间推进），双天空交叉淡入做平滑过渡；
// 每帧插值 太阳方向/色/强度、半球光、雾色、曝光、水色、Bloom、夜间灯光；
// 反射环境用「钳制天空 + 环境色地面」周期重建（反射带环境色、太阳不溢出）。
const KEYS = [
  { f:'day3',    dir:[0,0.33,0.95],     sunC:0xfff4e0, sunI:7.5, hemiI:1.3,  hemiC:0xcfe5ff, fog:0xaec6da, exp:0.82, envI:1.5,  water:0x0d4a66, bloom:0.06, night:0, grd:0x9a875c },
  { f:'day2',    dir:[0.79,0.12,0.60],  sunC:0xdfe6ee, sunI:3.0, hemiI:1.6,  hemiC:0xc8d2dc, fog:0xc2c8cf, exp:1.0,  envI:1.5,  water:0x294a5a, bloom:0.05, night:0, grd:0x6f6a5e },
  { f:'evening', dir:[0.05,0.09,0.99],  sunC:0xffc792, sunI:6.0, hemiI:1.3,  hemiC:0xffd9b0, fog:0xcf7a72, exp:0.88, envI:1.2,  water:0x06283a, bloom:0.15, night:0, grd:0x6e5a44 },
  { f:'night2',  dir:[0.016,0.45,0.89], sunC:0x9fb6e0, sunI:1.8, hemiI:0.6,  hemiC:0x2a3a55, fog:0x141d2e, exp:1.30, envI:0.85, water:0x04141f, bloom:0.50, night:1, grd:0x20242e },
  { f:'night1',  dir:[0.32,0.945,0.04], sunC:0x8aa0cc, sunI:1.2, hemiI:0.5,  hemiC:0x223355, fog:0x0a1020, exp:1.40, envI:0.70, water:0x02101a, bloom:0.60, night:1, grd:0x171a22 },
];
KEYS.forEach(k => {
  k._sunC = new THREE.Color(k.sunC); k._hemiC = new THREE.Color(k.hemiC);
  k._fog = new THREE.Color(k.fog); k._water = new THREE.Color(k.water); k._grd = new THREE.Color(k.grd);
  k._dir = new THREE.Vector3(...k.dir).normalize();
});

const N = KEYS.length;
const CYCLE_SEC = 84;          // 整圈时长（越小越快），约每段 17s
const SEG = CYCLE_SEC / N;
const texs = new Array(N);
let phase = 0, ready = false, loaded = 0, envTimer = 0, lastEnvTex = null;
let blendRT, blendScene, blendCam, blendMat, envScene, envGround, pmrem, envSrcRT, clampScene, clampMat;
let skyCubeRT, cubeCam, cubeScene;   // 等距混合结果→立方体（规避 equirect 背景的 cubemap 永久缓存）
let _dbg = null; // 屏幕调试条（定位天空循环问题后会移除）
function anyTex() { for (let t = 0; t < N; t++) if (texs[t]) return texs[t]; return null; }

export function buildSkyCycle() {
  // 背景：把"当前/下一张"等距天空按淡入系数混合渲染到一张 HalfFloat RT，再交给原生 scene.background。
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
  skyCubeRT = new THREE.WebGLCubeRenderTarget(768, { type: THREE.HalfFloatType });
  skyCubeRT.texture.minFilter = THREE.LinearFilter; skyCubeRT.texture.magFilter = THREE.LinearFilter; skyCubeRT.texture.generateMipmaps = false;
  cubeCam = new THREE.CubeCamera(1, 10, skyCubeRT);
  cubeScene = new THREE.Scene();
  const cubeMat = new THREE.ShaderMaterial({
    uniforms: { tEquirect: { value: blendRT.texture } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: '#include <common>\nuniform sampler2D tEquirect; varying vec3 vDir; void main(){ vec3 d = normalize(vDir); vec2 uv = equirectUv(d); gl_FragColor = texture2D(tEquirect, uv); }',
    side: THREE.BackSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending
  });
  cubeScene.add(new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), cubeMat));

  // 反射钳制：天空 HDRI 太阳高达数万，会在镜面上溢出成"方块"。把反射环境亮度上限钳到 ~12，
  // 太阳变成有界的圆亮点 → 玻璃可做镜面 + 锐利天空反射而不出方块。
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
  // 反射环境：钳制后的等距天空做背景 + 暗地面 → 镜面反射锐利、太阳不溢出、带环境色
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

  // 屏幕调试条
  _dbg = document.createElement('div');
  _dbg.style.cssText = 'position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:99999;background:rgba(0,0,0,.65);color:#5f5;font:12px monospace;padding:3px 10px;border-radius:4px;pointer-events:none;white-space:nowrap';
  _dbg.textContent = 'SKY 加载中 0/' + N;
  document.body.appendChild(_dbg);

  const loader = new RGBELoader();
  KEYS.forEach((k, i) => loader.load('assets/sky/' + k.f + '.hdr', (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.magFilter = THREE.LinearFilter;     // 关键：HDR DataTexture 默认最近邻 → 马赛克；改线性插值
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    texs[i] = tex;
    loaded++;
    console.log('[SKY] 已加载', k.f, loaded + '/' + N);
    if (!ready) start();                     // 第一张就绪即接管（兜底：不再苦等 5 张全到）
  }, undefined, (e) => { console.warn('[SKY] HDRI 加载失败', k.f, e); if (_dbg) _dbg.textContent = 'SKY 加载失败: ' + k.f; }));
}

function start() {
  if (sky) sky.visible = false;           // 隐藏程序化天空球（HDRI 做视觉背景 + 反射）
  scene.background = skyCubeRT.texture;   // HDRI cube 背景 → 车漆反射真实天空
  ready = true;
}

const _z = new THREE.Color(0);
const _lampLit = new THREE.Color(0xfff4e0);   // 灯体点亮时的暖白自发光色
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
// 平滑插值：段内系数 f 经 smoothstep，消除关键帧切换处的速度突变（硬切观感来源之一）
function smooth(t) { return t * t * (3 - 2 * t); }
export function skyCycleUpdate(dt) {
  if (!ready || !G.weatherOn) {
    if (_dbg) _dbg.textContent = `SKY 载入${loaded}/${N} ready=${ready} weather=${G.weatherOn}（未就绪）`;
    return;
  }
  try {
  phase = (phase + dt / SEG) % N;
  const i = Math.floor(phase), fRaw = phase - i, j = (i + 1) % N;
  const f = smooth(fRaw);          // 平滑段内插值系数，两端导数为 0 → 过渡无突变
  const A = KEYS[i], B = KEYS[j];

  // ---------- HDRI 天空背景（始终） + 太阳精灵叠加 ----------
  const texA = texs[i], texB = texs[j];
  let curTex;
  if (texA && texB) {
    blendMat.uniforms.tA.value = texA;
    blendMat.uniforms.tB.value = texB;
    blendMat.uniforms.uT.value = f;
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(blendRT);
    renderer.render(blendScene, blendCam);
    renderer.setRenderTarget(prevRT);
    cubeCam.update(renderer, cubeScene);
    curTex = blendRT.texture;
  } else {
    curTex = texA || texB || anyTex();
  }

  // 始终用 HDRI 做 scene.background → 车漆反射保持真实天空质感
  if (scene.background !== skyCubeRT.texture && curTex) scene.background = skyCubeRT.texture;

  // 夜间量
  const nightAmt = A.night + (B.night - A.night) * f;

  // 灯光 / 雾 / 曝光 / 水色 插值
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
  if (G.waterOK && G.water) G.water.material.color.copy(A._water).lerp(B._water, f);

  // 夜间元素：连续淡入系数 nf 控制灯光渐变，消除硬切
  const nf = smooth(clamp01((nightAmt - 0.3) / 0.4));
  for (const h of G.headlights) h.intensity = 150 * nf;
  if (env.lampHeadM) {
    env.lampHeadM.emissiveIntensity = 0.1 + (2.2 - 0.1) * nf;
    env.lampPools.material.opacity = 0.4 * nf;
    env.lampPools.visible = nf > 0.01;
    // 月亮：动态模式下随 nightAmt 显示，缩小尺寸避免巨型光球
    if (env.moon) {
      env.moon.visible = nightAmt > 0.25;
      env.moon.scale.set(55, 55, 1); // 原来是 230，太大像灯泡
      if (env.moon.visible) {
        env.moon.position.set(-curSunDir.x * 1700, Math.max(-curSunDir.y * 1700, 320), -curSunDir.z * 1700);
      }
    }
    env.fireflies.visible = nf > 0.01;
    env.beamGrp.visible = nf > 0.01;
    if (env.lanternM) env.lanternM.emissiveIntensity = 0.15 + (2.4 - 0.15) * nf;
  }
  // 云层：动态模式下显示，颜色随时段渐变
  if (env.clouds) {
    for (const c of env.clouds) c.visible = nightAmt < 0.8;
    if (env.cloudMat) {
      const cc = new THREE.Color().lerpColors(
        new THREE.Color(0xffffff), new THREE.Color(0x38445f), nightAmt
      );
      // 黄昏暖色
      if (nightAmt < 0.3) cc.lerpColors(new THREE.Color(0xffbe92), new THREE.Color(0xffffff), nightAmt / 0.3);
      env.cloudMat.color.copy(cc);
      env.cloudMat.opacity = 0.45 + (1 - nightAmt) * 0.43;
    }
  }
  // 星空：动态模式下夜间显示
  if (stars) {
    stars.visible = nightAmt > 0.35;
    if (stars.material) stars.material.opacity = smooth(clamp01((nightAmt - 0.35) / 0.3));
  }
  for (const m of G.lampMats) {
    const origE = m.userData?.origEmissive || _z;
    const origI = m.userData?.origEI ?? 1;
    m.emissive.copy(origE).lerp(_lampLit, nf);       // 灯体自发光色/强度随 nf 渐变
    m.emissiveIntensity = origI + (1.7 - origI) * nf;
  }

  // 周期重建反射环境（含环境色地面），让车漆反射带环境色且随时段平滑变化。
  // 环境随时段缓变，无需高频重建 → 降到 ~1Hz：PMREM.fromScene 是整场景重渲，是天气循环的主要持续开销。
  envTimer += dt;
  if (envTimer >= (G.hiQuality ? 1.0 : 1.5)) {
    envTimer = 0;
    envGround.material.color.copy(A._grd).lerp(B._grd, f);
    clampMat.uniforms.tBlend.value = curTex;     // 钳制源改用当前 HDR（不再依赖 blendRT）
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(envSrcRT);
    renderer.render(clampScene, blendCam);
    renderer.setRenderTarget(prev);
    const rt = pmrem.fromScene(envScene, 0.06); // 锐利反射：镜面玻璃反射清晰天空；太阳已钳制故不再方块
    if (lastEnvTex) lastEnvTex.dispose();
    lastEnvTex = rt.texture;
    scene.environment = lastEnvTex;
  }
  if (_dbg) _dbg.textContent = `SKY 段=${KEYS[i].f} f=${fRaw.toFixed(2)} night=${nightAmt.toFixed(2)} sunY=${curSunDir.y.toFixed(2)} exp=${renderer.toneMappingExposure.toFixed(2)} sunI=${sun.intensity.toFixed(1)}`;
  } catch (e) {
    if (_dbg) _dbg.textContent = 'SKY 异常: ' + (e && e.message ? e.message : e);
  }
}
