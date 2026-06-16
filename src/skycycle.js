import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { G, scene, renderer, camera, sun, hemi, rim, bloomPass } from './core.js';
import { curSunDir, env, sky, stars, fallbackOcean } from './world.js';

// ---------- 动态天空 / 天气循环 ----------
// 6 个时段关键帧（按时间推进），双天空球交叉淡入做平滑过渡；
// 每帧插值 太阳方向/色/强度、半球光、雾色、曝光、水色、Bloom、夜间灯光；
// 反射环境用「混合天空 + 环境色地面」周期重建（反射带环境色，而非纯天光）。
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
const CYCLE_SEC = 84;          // 整圈时长（越小越快），约每段 14s
const SEG = CYCLE_SEC / N;
const texs = new Array(N);
let phase = 0, ready = false, loaded = 0, envTimer = 0, lastEnvTex = null;
let blendRT, blendScene, blendCam, blendMat, envScene, envGround, pmrem, envSrcRT, clampScene, clampMat;

export function buildSkyCycle() {
  // 背景：把"当前/下一张"等距天空按淡入系数混合渲染到一张 HalfFloat RT，再交给原生 scene.background。
  // 原生等距背景着色器无两极挤压/接缝、画质最佳，同时支持平滑交叉淡入。
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

  // 反射钳制：天空 HDRI 太阳高达 3 万，会在镜面上溢出成"方块"。把反射环境的亮度上限钳到 ~12，
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
  envScene.background = envSrcRT.texture;
  envGround = new THREE.Mesh(new THREE.CircleGeometry(160, 48), new THREE.MeshBasicMaterial({ color: 0x5a5348, toneMapped: false }));
  envGround.rotation.x = -Math.PI / 2; envGround.position.y = -6;
  envScene.add(envGround);
  pmrem = new THREE.PMREMGenerator(renderer);

  const loader = new RGBELoader();
  KEYS.forEach((k, i) => loader.load('assets/sky/' + k.f + '.hdr', (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.magFilter = THREE.LinearFilter;     // 关键：HDR DataTexture 默认最近邻 → 马赛克；改线性插值
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    texs[i] = tex;
    if (++loaded === N) start();
  }, undefined, (e) => console.warn('天空 HDRI 加载失败', k.f, e)));
}

function start() {
  if (sky) sky.visible = false;        // 接管：隐藏程序化天空盒
  scene.background = blendRT.texture;   // 原生等距背景（混合 RT 提供，无两极挤压）
  ready = true;
}

const _z = new THREE.Color(0);
export function skyCycleUpdate(dt) {
  if (!ready || !G.weatherOn) return;
  phase = (phase + dt / SEG) % N;
  const i = Math.floor(phase), f = phase - i, j = (i + 1) % N;
  const A = KEYS[i], B = KEYS[j];

  // 天空交叉淡入：把当前/下一张等距天空按 f 混合渲染到背景 RT
  if (texs[i] && texs[j]) {
    blendMat.uniforms.tA.value = texs[i];
    blendMat.uniforms.tB.value = texs[j];
    blendMat.uniforms.uT.value = f;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(blendRT);
    renderer.render(blendScene, blendCam);
    renderer.setRenderTarget(prev);
  }

  // 灯光 / 雾 / 曝光 / 水色 插值
  sun.color.copy(A._sunC).lerp(B._sunC, f);
  sun.intensity = A.sunI + (B.sunI - A.sunI) * f;
  curSunDir.copy(A._dir).lerp(B._dir, f).normalize();
  hemi.color.copy(A._hemiC).lerp(B._hemiC, f);
  hemi.intensity = A.hemiI + (B.hemiI - A.hemiI) * f;
  scene.fog.color.copy(A._fog).lerp(B._fog, f);
  renderer.toneMappingExposure = A.exp + (B.exp - A.exp) * f;
  scene.environmentIntensity = A.envI + (B.envI - A.envI) * f; // 提亮 IBL 环境光，避免整体偏暗
  bloomPass.strength = G.hiQuality ? (A.bloom + (B.bloom - A.bloom) * f) : 0;
  const nightAmt = A.night + (B.night - A.night) * f;
  rim.intensity = 0.42 * (1 - nightAmt) + 0.12 * nightAmt;
  rim.color.copy(sun.color); // 补光颜色跟随太阳，杜绝旧预设暖色残留（光影叠加）
  if (G.waterOK && G.water) G.water.material.color.copy(A._water).lerp(B._water, f);

  // 夜间元素
  const isNight = nightAmt > 0.5;
  for (const h of G.headlights) h.intensity = isNight ? 150 : 0;
  if (env.lampHeadM) {
    env.lampHeadM.emissiveIntensity = isNight ? 2.2 : 0.1;
    env.lampPools.visible = isNight;
    env.moon.visible = false;        // 关掉旧月亮贴片（天顶大白光晕来源），夜空改用 HDRI 自带内容
    env.fireflies.visible = nightAmt > 0.45;
    env.beamGrp.visible = nightAmt > 0.62; // 灯塔光柱仅深夜出现，避免黄昏/黎明残留粗糙光柱
    if (env.lanternM) env.lanternM.emissiveIntensity = isNight ? 2.4 : 0.15;
  }
  // 旧程序化云片(sprite)与 HDRI 自带云层重叠成"白色圆斑"，直接隐藏，改用 HDRI 云
  if (env.clouds) for (const c of env.clouds) c.visible = false;
  // 星空只在深夜出现：nightAmt 0.55 起淡入、0.8 全亮；天一变亮(nightAmt 降到 0.55 以下)即消失，黎明/白天不残留
  if (stars) stars.visible = false; // 直接移除程序化星点（白天残留+反射问题难根治），夜空用 HDRI 自带内容
  for (const m of G.lampMats) {
    if (isNight) { m.emissive.setHex(0xfff4e0); m.emissiveIntensity = 1.7; }
    else { m.emissive.copy(m.userData?.origEmissive || _z); m.emissiveIntensity = m.userData?.origEI ?? 1; }
  }

  // 周期重建反射环境（含环境色地面），让车漆反射带环境色且随时段平滑变化
  envTimer += dt;
  if (envTimer >= (G.hiQuality ? 0.2 : 0.5)) {
    envTimer = 0;
    envGround.material.color.copy(A._grd).lerp(B._grd, f);
    // 先把混合天空钳制亮度写入 envSrcRT（太阳有界、不溢出），再 PMREM
    clampMat.uniforms.tBlend.value = blendRT.texture;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(envSrcRT);
    renderer.render(clampScene, blendCam);
    renderer.setRenderTarget(prev);
    const rt = pmrem.fromScene(envScene, 0.06); // 锐利反射：镜面玻璃反射清晰天空；太阳已钳制故不再方块
    if (lastEnvTex) lastEnvTex.dispose();
    lastEnvTex = rt.texture;
    scene.environment = lastEnvTex;
  }
}
