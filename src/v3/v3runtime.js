// Horizon V3 — runtime loop / controls / drive a lap (PR1)
// task-20260621-V3-PR1
//
// 车沿等弧长中心线推进（自动巡航，可方向键调速/横移），开完整一圈。
// 提供 startLoop / installControls / applyViewpoint，供 v3main.js 使用。

const keys = {};

export function installControls(drive) {
  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') drive.paused = !drive.paused;
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
}

// 采样中心线在弧长 s（米）处的位姿（线性插值，环线取模）
function sampleCenterAtS(world, s) {
  const center = world.center;
  const N = center.length;
  const total = world.total;
  let ss = ((s % total) + total) % total;
  // center[i].s 单调递增；二分/线性找区间
  let i = 0;
  while (i < N && center[(i + 1) % N].s > center[i].s && center[(i + 1) % N].s <= ss) i++;
  // 简化：按比例直接定位
  const frac = ss / total;
  const fi = frac * N;
  const i0 = Math.floor(fi) % N;
  const i1 = (i0 + 1) % N;
  const f = fi - Math.floor(fi);
  const a = center[i0], b = center[i1];
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    z: a.z + (b.z - a.z) * f,
    heading: Math.atan2(b.x - a.x, b.z - a.z),
    i0,
  };
}

export function applyViewpoint(vps, vpId, camera, drive, car, world) {
  const vp = vps[Number(vpId)];
  if (!vp) { console.warn('[V3] 未知 VP', vpId); return; }
  camera.position.set(vp.camPos.x, vp.camPos.y, vp.camPos.z);
  camera.lookAt(vp.lookAt.x, vp.lookAt.y, vp.lookAt.z);
  camera.updateProjectionMatrix();
  drive.staticCam = vp;
  // 若该 VP 有对应车位，把车放到对应中心线位置
  if (vp.sIndex != null && world) {
    const c = world.center[vp.sIndex];
    drive.s = c.s;
    placeCar(car, world, drive.s);
  }
  console.log('[V3] 跳转视点', vpId, vp.label);
}

function placeCar(car, world, s) {
  const p = sampleCenterAtS(world, s);
  car.position.set(p.x, p.y + 0.2, p.z);
  car.rotation.y = p.heading;
}

export function startLoop(ctx) {
  const { renderer, scene, camera, world, car, quality, drive, vps } = ctx;
  let last = performance.now();
  const hud = makeHud();

  function frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    quality.tick(dt);

    if (!drive.paused) {
      // 自动巡航 + 方向键调速
      let throttle = 1;
      if (keys['arrowup'] || keys['w']) throttle = 1.6;
      if (keys['arrowdown'] || keys['s']) throttle = 0.3;
      const cruise = 28; // m/s 目标巡航 ≈ 100km/h
      drive.speed += ((cruise * throttle) - drive.speed) * Math.min(1, dt * 1.5);
      const before = drive.s;
      drive.s += drive.speed * dt;
      // 一圈进度
      drive.lapProgress = (drive.s % world.total) / world.total;
      if (before % world.total > drive.s % world.total) {
        drive.laps = (drive.laps || 0) + 1;
      }
      placeCar(car, world, drive.s);
    }
    // 当前所在段（供验收面板显示）
    {
      const ci = sampleCenterAtS(world, drive.s).i0;
      drive.segName = (world.center[ci] && world.center[ci].segName) || 'Road';
    }

    // 相机：静态 VP 则不跟车；否则追尾
    if (!drive.staticCam) {
      const p = sampleCenterAtS(world, drive.s);
      const back = 18, up = 8;
      camera.position.set(
        p.x - Math.sin(p.heading) * back,
        p.y + up,
        p.z - Math.cos(p.heading) * back,
      );
      camera.lookAt(p.x + Math.sin(p.heading) * 20, p.y + 2, p.z + Math.cos(p.heading) * 20);
    }

    hud.update(world, drive, quality);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });
}

function makeHud() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:14px;top:14px;color:#eaf2fb;font-family:"Noto Sans SC",monospace;font-size:13px;background:rgba(14,20,30,.82);padding:12px 16px;border-radius:10px;z-index:50;line-height:1.7;border:1px solid #2a4664;min-width:210px';
  document.body.appendChild(el);
  // 闭环状态（首帧计算一次）
  let closureStr = '';
  return {
    update(world, drive, quality) {
      if (!closureStr) {
        const first = world.center[0], last = world.center[world.center.length - 1];
        const gap = Math.hypot(first.x - last.x, first.z - last.z);
        closureStr = gap < 30 ? '✔ 已闭合' : '⚠ 间隙 ' + gap.toFixed(0) + 'm';
      }
      const km = (world.total / 1000).toFixed(2);
      const prog = (drive.lapProgress * 100).toFixed(0);
      const seg = drive.segName || 'Road';
      el.innerHTML =
        '<b style="color:#7affc0">V3 灰模环线 · 验收信息</b><br>' +
        '当前路段: <b style="color:#ffd24d">' + seg + '</b><br>' +
        '圈进度: <b>' + prog + '%</b>　圈数: ' + (drive.laps || 0) + '<br>' +
        '总长度: <b>' + km + ' km</b>/圈<br>' +
        '闭环: ' + closureStr + '　路段数: ' + world.chunks.length + '<br>' +
        '速度: ' + (drive.speed * 3.6).toFixed(0) + ' km/h　画质: ' + quality.resolved + '<br>' +
        '<span style="color:#9fb0c8;font-size:11px">' +
        (drive.staticCam ? ('机位: ' + drive.staticCam.label) : '[空格暂停 · 方向键调速]') + '</span>';
    },
  };
}
