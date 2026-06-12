import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------- 跨模块共享的可变状态 ----------
export const G = {
  appState: 'garage',   // garage | drive | pause | photo
  camMode: 0,
  muted: false,
  musicOn: true,
  hiQuality: true,
  skinIdx: 0,
  curTod: 'sunset',
  shake: 0,
  water: null,
  waterOK: false,
  carReady: false,
  headlights: [],
  lampMats: []
};

// ---------- 渲染器 ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc97e58, 260, 1600);
const camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.1, 4000);

// ---------- 光照 ----------
const sunDir = new THREE.Vector3(-0.55, 0.30, -0.81).normalize();
const hemi = new THREE.HemisphereLight(0xffd9b0, 0x33405e, 0.65);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffc792, 4.2);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun); scene.add(sun.target);
// 冷色轮廓补光（不投影）
const rim = new THREE.DirectionalLight(0x88aaff, 0.7);
scene.add(rim); scene.add(rim.target);

// ---------- 后期 ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.35, 0.92);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());


export { canvas, renderer, scene, camera, sunDir, hemi, sun, rim, composer, bloomPass };
