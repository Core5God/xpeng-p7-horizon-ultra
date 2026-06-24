import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { PERF, isSafeMode, maxPixelRatioFor } from './perfMode.js';

// 常数时间角度回绕：取模实现，对 NaN/Infinity 免疫（while 减法回绕在异常值下会死循环）
export function wrapPi(a) {
  a = a % (Math.PI*2);
  if (a > Math.PI) a -= Math.PI*2;
  else if (a < -Math.PI) a += Math.PI*2;
  return a === a ? a : 0;
}

// ---------- 隐藏调试快速模式 ----------
// 仅供内部无头截图自检：`?fastdebug=1` 跳过/削减最吃算力的生成步骤、降到最低画质、
// 自动进入可截图状态。正式访客（无参数）行为完全不受影响——所有分支都包在 FASTDEBUG 判断内。
export const FASTDEBUG = (() => {
  try { return new URLSearchParams(location.search).get('fastdebug') === '1'; }
  catch { return false; }
})();

// `?roadside=1`：仅供路边地编自检。在 fastdebug 轻量场景上额外构建路边生态带（跳过 28k 草），
// 让无 GPU 的 VPS 能快速截到 PR4.1 的路边图层。默认 false，正式访客不受影响。
export const ROADSIDE_ONLY = (() => {
  try { return new URLSearchParams(location.search).get('roadside') === '1'; }
  catch { return false; }
})();

// ---------- 跨模块共享的可变状态 ----------
export const G = {
  appState: 'garage',   // garage | drive | pause | photo
  camMode: 1, // 默认近追视角，更好展示车身材质
  muted: false,
  musicOn: true,
  musicMode: 'playlist', // 'lofi' | 'playlist' - 默认歌单模式
  // [PERF0] 不再默认强制最高画质：Mac/Retina/低内存/?safe → Safe 档；普通桌面 → Auto。
  // hiQuality 仅表示"是否开高画质特性（bloom 常开/CubeCam 较快等）"，Safe/Auto 都为 false。
  hiQuality: (PERF.tier === 'high'),
  perfTier: PERF.tier,   // 'safe' | 'auto' | 'high' | 'photo'
  safeMode: isSafeMode(),
  // [PERF0] bloom 运行期开关 + 节奏：Safe 永远关；Auto 默认关（夜间/照片再开）；High 常开。
  // _bloomStride：bloom 重做间隔帧数（Auto=3，High=1）。
  bloomActive: (PERF.tier === 'high'),
  _bloomStride: (PERF.tier === 'high') ? 1 : 3,
  weatherOn: true,      // 动态天空/天气循环
  skinIdx: 0,
  curTod: 'sunset',
  shake: 0,
  water: null,
  waterOK: false,
  carReady: false,
  pad: {active:false, steer:0, throttle:0, brake:0, drift:false, boost:false},
  headlights: [],
  lampMats: [],
  // PR4.1 路边植被材质注册表：用于映复昼夜（夜间压暗/降饱和，避免荧光绿草。
  // 每项 { mat, baseColor:THREE.Color }，applyTod / skyCycleUpdate 随 nightFactor 调 mat.color。
  roadsideVegMats: []
};

// ---------- 渲染器 ----------
const canvas = document.getElementById('c');
// antialias 关闭：使用 EffectComposer 时画面经离屏 RT 合成，画布 MSAA 无效且白白占显存；抗锯齿交给末端 SMAA
// preserveDrawingBuffer 移除：它强制浏览器每帧 copy 而非 swap 交换链，是持续填充率开销。
// 截图改为渲染后同帧同步拷贝像素（见 ui.js 海报/截图），不再依赖保留缓冲。
const renderer = new THREE.WebGLRenderer({canvas, antialias:false});
// [PERF0] 启动像素比按档位封顶：Safe=1.0，Auto/High=1.25。原本固定 1.5 在 Retina Mac 上填充率爆炸。
renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatioFor(PERF.tier)));
PERF.pixelRatio = renderer.getPixelRatio();
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// [PERF0] Safe 档：阴影贴图降到 1024（开放世界阴影贴图很贵）。
if (isSafeMode()) { /* mapSize 在下方 sun.shadow 处统一设 */ }
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// FASTDEBUG：最低画质 + 关阴影，快速进入可截图状态（仅无头自检；正式访客不走此分支）
if (FASTDEBUG) {
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = false;
  console.log('[FASTDEBUG] core: pixelRatio=1, shadows off');
}

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc97e58, 260, 1600);
// near 抬到 0.3：开放世界 far=4000 时深度精度有限，GTAO 依赖深度重建，
// 近裁面拉远能显著降低环境光遮蔽的噪点（座舱视角仍不会穿模）
const camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.3, 4000);

// ---------- 光照 ----------
const sunDir = new THREE.Vector3(-0.55, 0.30, -0.81).normalize();
const hemi = new THREE.HemisphereLight(0xffd9b0, 0x33405e, 0.65);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffc792, 4.2);
sun.castShadow = true;
// [PERF0] Safe 档阴影贴图 1024（半分辨率，阴影 pass 开销减半）；其余档 2048。
sun.shadow.mapSize.set(isSafeMode() ? 1024 : 2048, isSafeMode() ? 1024 : 2048);
PERF.shadowSize = sun.shadow.mapSize.width;
sun.shadow.camera.left = -80; sun.shadow.camera.right = 80; // 收窄到近景走廊：提高阴影纹素密度
sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 350; // 近景真实阴影，远景靠植被暗化
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.06;
scene.add(sun); scene.add(sun.target);
// 冷色轮廓补光（不投影）
const rim = new THREE.DirectionalLight(0x88aaff, 0.7);
scene.add(rim); scene.add(rim.target);

// ---------- 后期 ----------
// 管线顺序：RenderPass → GTAO（环境光遮蔽）→ Bloom → OutputPass（色调映射/sRGB）
//          → 照片电影感（暗角+色差，仅拍照启用）→ SMAA（抗锯齿，末端 LDR 处理）
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// 环境光遮蔽：给道具/树/建筑与地面补接触阴影，消除"飘"感。开销较大，仅高画质启用
const gtaoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
gtaoPass.output = GTAOPass.OUTPUT.Default;
gtaoPass.updateGtaoMaterial({
  radius: 0.7,            // 世界单位（米）：车身~4m、道具~1-2m，0.7 抓接触缝隙不糊大面
  distanceExponent: 1.0,
  thickness: 1.0,
  scale: 1.0,
  samples: 8,
  distanceFallOff: 1.0,
  screenSpaceRadius: false
});
gtaoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 4 });
// 默认关闭：GTAO 会把整个场景深度/法线重渲一遍（≈绘制翻倍），中低端 GPU 扛不住。
// 改成可选项，由 G.aoOn 控制（设置里可开）；普通高画质只保留便宜的 SMAA + 照片电影感
gtaoPass.enabled = !!G.aoOn; // 关闭：GTAO 后期 pass 与透明烟雾/粒子冲突(黑块)且会在地面产生随视角移动的白膜，留待用更干净的 AO 方案
if (FASTDEBUG) gtaoPass.enabled = false; // FASTDEBUG：明确关 GTAO
composer.addPass(gtaoPass);

// Bloom 在半分辨率下计算：本就是模糊辉光，半分辨率肉眼几乎无差，开销减半
// 收紧参数：threshold 提高到 1.2，只有 emissive 灯具/车灯等高亮物进入 Bloom，
// 天空、车漆、地形等常规亮度不触发 Bloom，避免"页游感"泛光
const bloomPass = new UnrealBloomPass(new THREE.Vector2(Math.round(innerWidth/2), Math.round(innerHeight/2)), 0.16, 0.40, 1.2);
if (FASTDEBUG) bloomPass.strength = 0; // FASTDEBUG：关后期辉光

// ---------- Selective Bloom ----------
// Layer 31 标记为"进入 Bloom"的对象；其余对象在 bloom 渲染时被临时替换为纯黑，
// 确保天空、车漆、地形等永远不会触发 Bloom。参考 three.js 官方 selective bloom 示例。
const BLOOM_LAYER = 31;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);
const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
const darkSpriteMat = new THREE.SpriteMaterial({ color: 0x000000 });
const darkPointsMat = new THREE.PointsMaterial({ color: 0x000000, size: 0 });
const _darkObjs = [];   // 预分配对象引用数组（零每帧分配）
const _darkMats = [];   // 预分配原始材质数组
let _darkCount = 0;

// bloomComposer：独立渲染器，先渲染场景（非 bloom 对象涂黑），再做 Bloom
const bloomRT = new THREE.WebGLRenderTarget(
  Math.round(innerWidth / 2), Math.round(innerHeight / 2),
  { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
);
const bloomComposer = new EffectComposer(renderer, bloomRT);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(new RenderPass(scene, camera));
bloomComposer.addPass(bloomPass);

// finalComposer：正常渲染场景 → 叠加 bloom 层 → tone mapping → 抗锯齿
// 使用自定义 additive composite：将 bloomComposer 输出的 bloom 纹理加回主画面
const finalComposer = new EffectComposer(renderer);
finalComposer.renderToScreen = true;
finalComposer.addPass(new RenderPass(scene, camera));
// Additive composite: scene + bloomTexture，在 OutputPass 之前叠加确保一起进 tone mapping
// ShaderPass 自动把 tDiffuse uniform 设为 readBuffer（即上一 pass 的场景渲染结果）
const compositePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    bloomTexture: { value: bloomRT.texture }
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D bloomTexture;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(tDiffuse, vUv) + texture2D(bloomTexture, vUv);
    }`
});
finalComposer.addPass(compositePass);
finalComposer.addPass(new OutputPass());

// [PERF0] selective bloom 是最大单项开销：每帧 traverse 全场景 + 二次渲染。
// Safe 档：完全关闭，只走单次 finalComposer。
// Auto 档：默认关（由 G.bloomActive 控，夜间/车灯/照片再开），开启时每 3 帧才重做一次 bloom。
// 该函数由 main.js 设置 G._bloomStride / G.bloomActive 控制节奏。
let _bloomFrame = 0;
let _bloomWasActive = false;
function selectiveBloomRender() {
  // Safe 档或未激活 bloom：只渲染场景，不做第二次 bloom pass（避免全场景材质替换）。
  if (isSafeMode() || !G.bloomActive) {
    // 从“bloom 开”跳到“bloom 关”时，bloomRT 仍残留上一次辉光 → 清一次避免叠加鬼影。
    if (_bloomWasActive) {
      bloomPass.strength = 0;
      _darkCount = 0;
      scene.traverse((obj) => {
        if (!bloomLayer.test(obj.layers)) {
          if (obj.isMesh || obj.isSprite || obj.isPoints) {
            _darkObjs[_darkCount] = obj; _darkMats[_darkCount] = obj.material;
            obj.material = obj.isMesh ? darkMaterial : obj.isSprite ? darkSpriteMat : darkPointsMat;
            _darkCount++;
          }
        }
      });
      bloomComposer.render();
      for (let i = 0; i < _darkCount; i++) _darkObjs[i].material = _darkMats[i];
      _bloomWasActive = false;
    }
    finalComposer.render();
    return;
  }
  _bloomWasActive = true;
  // Auto/High bloom 降频：不是每帧都重做 bloom，按 G._bloomStride（默认 3）步进。
  const stride = Math.max(1, G._bloomStride || 1);
  if ((_bloomFrame++ % stride) !== 0) {
    // 跳帧：复用上一次 bloomRT，只重画主场景 + 叠加旧 bloom 纹理
    finalComposer.render();
    return;
  }
  _darkCount = 0;
  scene.traverse((obj) => {
    if (!bloomLayer.test(obj.layers)) {
      if (obj.isMesh || obj.isSprite || obj.isPoints) {
        _darkObjs[_darkCount] = obj;
        _darkMats[_darkCount] = obj.material;
        obj.material = obj.isMesh ? darkMaterial : obj.isSprite ? darkSpriteMat : darkPointsMat;
        _darkCount++;
      }
    }
  });
  bloomComposer.render();
  for (let i = 0; i < _darkCount; i++) _darkObjs[i].material = _darkMats[i];
  finalComposer.render();
}

// 照片模式电影感：径向色差 + 暗角（仅 G.appState==='photo' 时启用，平时跳过）
const PhotoGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0.85 },    // 暗角强度（0=无）
    aberration: { value: 0.0045 } // 色差像素偏移系数
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float aberration;
    varying vec2 vUv;
    void main(){
      vec2 dir = vUv - 0.5;
      float d = length(dir);
      vec2 off = dir * aberration * d * 2.0;   // 边缘偏移更大，中心干净
      float r = texture2D(tDiffuse, vUv + off).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - off).b;
      vec3 col = vec3(r, g, b);
      float v = smoothstep(0.85, 0.25, d);     // 1 中心 → 0 边缘
      col *= mix(1.0, v, vignette);
      gl_FragColor = vec4(col, 1.0);
    }`
};
const photoPass = new ShaderPass(PhotoGradeShader);
photoPass.enabled = false;
finalComposer.addPass(photoPass);

const smaaPass = new SMAAPass(innerWidth, innerHeight);
finalComposer.addPass(smaaPass);


export { canvas, renderer, scene, camera, sunDir, hemi, sun, rim, composer, finalComposer, bloomComposer, bloomPass, bloomLayer, BLOOM_LAYER, selectiveBloomRender, gtaoPass, photoPass, smaaPass };
