// Horizon V3 — main runtime (grey-box closed loop) PR1
// task-20260621-V3-PR1
//
// 独立于 V2 world.js：只渲染灰模路面 + 地形 + 简单车（盒子），
// 车沿等弧长中心线开完整一圈（PR1 验证用自动巡航 + 方向键微调）。
// ?vp=0 俯视全环 / ?vp=1 起点基地 / ?vp=5 山顶俯瞰。
// 画质档 Auto/Low/Medium/High。

import * as THREE from 'three';
import { buildTrackWorld } from './trackToWorld.js';
import { QualityManager } from './quality.js';
import { VP_ANCHORS, resolveViewpoints } from './v3viewpoints.js';
import { installControls, applyViewpoint, startLoop } from './v3runtime.js';

const V3_BUILD = '20260621-deploycheck-1';
console.log('[V3 build] ' + V3_BUILD);

function addBuildTag() {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;right:6px;bottom:6px;font:8px/1 monospace;color:rgba(255,255,255,.25);z-index:99999;pointer-events:none';
  t.textContent = 'v3 build ' + V3_BUILD;
  document.body.appendChild(t);
}

export async function launchV3() {
  const canvas = document.createElement('canvas');
  canvas.id = 'v3-canvas';
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;background:#11151b';
  document.body.style.margin = '0';
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb6cc);
  scene.fog = new THREE.Fog(0x9fb6cc, 800, 6000);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 20000);
  camera.position.set(0, 400, 600);
  camera.lookAt(0, 0, 0);

  // 灯光（灰模够用即可）
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(500, 900, 300);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfd4ec, 0x44484e, 1.0));
  scene.add(new THREE.AmbientLight(0x404652, 0.6));

  const quality = new QualityManager(renderer);
  quality.set(new URLSearchParams(location.search).get('q') || 'Auto');

  // 载入 track
  let rawTrack;
  try {
    const res = await fetch('./track.main.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    rawTrack = await res.json();
  } catch (err) {
    showError('载入 track.main.json 失败：' + err.message);
    throw err;
  }

  let world;
  try {
    world = buildTrackWorld(rawTrack);
  } catch (err) {
    showError('Track-to-World 失败：' + err.message);
    throw err;
  }
  scene.add(world.terrain);
  scene.add(world.ribbon);

  // 简单灰模车（盒子）
  const car = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(4, 1.6, 9),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.7 }),
  );
  body.position.y = 1.2; car.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 1.2, 4),
    new THREE.MeshStandardMaterial({ color: 0x8892a0, roughness: 0.5 }),
  );
  cabin.position.set(0, 2.4, -0.5); car.add(cabin);
  scene.add(car);

  // 起点 / VP 锚点小标记（灰模可视）
  addAnchorMarkers(scene, world);

  // 暴露给 headless 自检
  window.__v3 = { scene, camera, renderer, world, car, quality, THREE };

  // 视点
  const vps = resolveViewpoints(world);
  const urlVp = new URLSearchParams(location.search).get('vp');

  // 驾驶状态（沿中心线 s 推进，可被 ?vp 接管为静态机位）
  const drive = {
    s: 0, speed: 0, manual: 0, // manual: 横向偏移微调
    staticCam: null, // 若设置则不跟车
    lapStartS: 0, lapDone: false, lapProgress: 0,
  };
  installControls(drive);

  if (urlVp != null) applyViewpoint(vps, urlVp, camera, drive, car, world);

  startLoop({ renderer, scene, camera, world, car, quality, drive, vps });
  addBuildTag();
  removeBoot();
  return window.__v3;
}

function addAnchorMarkers(scene, world) {
  world.track.controlPoints.forEach((cp) => {
    if (!cp.vpAnchor && !cp.tags.length) return;
    const color = cp.vpAnchor ? 0xffd24d : 0x7affc0;
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(2, 2, 30, 8),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
    );
    m.position.set(cp.pos.x, cp.pos.y + 15, cp.pos.z);
    m.name = 'anchor-' + (cp.vpAnchor || cp.tags[0]);
    scene.add(m);
  });
}

function showError(msg) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:20px;left:20px;color:#ffb3b3;background:rgba(0,0,0,.7);padding:12px;z-index:99999;font-family:monospace';
  d.textContent = '[V3] ' + msg;
  document.body.appendChild(d);
  console.error('[V3]', msg);
}

function removeBoot() {
  const b = document.getElementById('boot');
  if (b) b.remove();
}
