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

const V3_BUILD = '20260621-pr1.0.1-usability';
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
  // PR1.0.1 — 大幅降雾：VP0 俱视全环必须看清。雾起点推远、终点拉到超过环线尺度。
  scene.fog = new THREE.Fog(0xc2d2e2, 4000, 16000);

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
  if (world.arrows) scene.add(world.arrows);

  // 低模车身轮廓（灰模 low-poly，明确可辨车头朝向，车头 +Z）
  const car = buildGreyboxCar();
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
  const center = world.center;
  const nearest = (pos) => {
    let best = Infinity, bi = 0;
    for (let i = 0; i < center.length; i++) {
      const d = Math.hypot(center[i].x - pos.x, center[i].z - pos.z);
      if (d < best) { best = d; bi = i; }
    }
    return center[bi];
  };
  world.track.controlPoints.forEach((cp) => {
    // 只为 VP 锡点立标柱，避免遮挡路面/机位/车；偏移到路右侧
    if (!cp.vpAnchor) return;
    const c = nearest(cp.pos);
    const off = (c.roadWidth || 12) / 2 + 6;
    const mx = cp.pos.x - c.nx * off, mz = cp.pos.z - c.nz * off;
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 10, 6),
      new THREE.MeshStandardMaterial({ color: 0xffd24d, roughness: 0.6 }),
    );
    m.position.set(mx, cp.pos.y + 5, mz);
    m.name = 'anchor-' + cp.vpAnchor;
    scene.add(m);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(2, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd24d, emissive: 0x6a5410, roughness: 0.5 }),
    );
    ball.position.set(mx, cp.pos.y + 11, mz);
    scene.add(ball);
  });
  // 起点门（两侧门柱 + 横梁）：明确起点位置，不遮挡路中心
  const startCp = world.track.controlPoints.find((c) => c.vpAnchor === 'VP1' || (c.tags && c.tags.includes('start'))) || world.track.controlPoints[0];
  const sc = nearest(startCp.pos);
  const hw = (sc.roadWidth || 14) / 2 + 1;
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x7affc0, roughness: 0.5, emissive: 0x123a26 });
  const postGeo = new THREE.BoxGeometry(1.2, 9, 1.2);
  [-1, 1].forEach((sgn) => {
    const px = sc.x + sc.nx * hw * sgn, pz = sc.z + sc.nz * hw * sgn;
    const post = new THREE.Mesh(postGeo, gateMat);
    post.position.set(px, sc.y + 4.5, pz); scene.add(post);
  });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 2, 1.2, 1.2), gateMat);
  beam.position.set(sc.x, sc.y + 9, sc.z);
  beam.rotation.y = Math.atan2(sc.nx, sc.nz);
  scene.add(beam);
}

// 低模车身轮廓（灰模）：车头朝 +Z，靠楿形车头 + 亮色鼻尖 + 顶部方向鲍明确朝向。
function buildGreyboxCar() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb9c0cb, roughness: 0.6, metalness: 0.05, flatShading: true });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.7, flatShading: true });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0xff7a3c, roughness: 0.5, flatShading: true });

  // 主车身（梯形截面，low-poly）长轴沿 Z
  const L = 9, W = 4, Hb = 1.5;
  const body = new THREE.BoxGeometry(W, Hb, L);
  const bm = new THREE.Mesh(body, bodyMat); bm.position.y = 1.0; g.add(bm);

  // 鼻锥（wedge）：指向 +Z，拉尖车头
  const nose = new THREE.ConeGeometry(W * 0.5, 3.2, 4);
  nose.rotateX(Math.PI / 2); // 锥尖朝 +Z
  const nm = new THREE.Mesh(nose, noseMat);
  nm.position.set(0, 1.0, L / 2 + 0.9); nm.rotation.z = Math.PI / 4;
  g.add(nm);

  // 驾驶舱（偏后，下梯形感）
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.82, 1.2, L * 0.42), darkMat);
  cabin.position.set(0, 2.0, -0.6); g.add(cabin);

  // 顶部方向鲍（指向 +Z 的三角鲍，远看也能辨车头）
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.4, 3), noseMat);
  fin.rotateX(Math.PI / 2);
  fin.position.set(0, 2.9, 1.2); g.add(fin);

  // 四轮（扭扉圆柱）
  const wheelGeo = new THREE.CylinderGeometry(1.0, 1.0, 0.7, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wpos = [[-W / 2, 0.9, L * 0.32], [W / 2, 0.9, L * 0.32], [-W / 2, 0.9, -L * 0.32], [W / 2, 0.9, -L * 0.32]];
  wpos.forEach((wp) => { const wm = new THREE.Mesh(wheelGeo, darkMat); wm.position.set(wp[0], wp[1], wp[2]); g.add(wm); });

  g.name = 'v3-car';
  return g;
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
