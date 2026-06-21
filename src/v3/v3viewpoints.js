// Horizon V3 — viewpoints (PR1)
// task-20260621-V3-PR1
//
// VP0 编辑器俯视全环（俯瞰整条环线）
// VP1 起点基地（带 'start' 标签或 VP1 锚点的控制点）
// VP5 山顶俯瞰（带 'summit' 标签或 VP5 锚点的控制点）
// 锚点优先取编辑器内 vpAnchor，其次取语义标签，最后回退几何推断。

export const VP_ANCHORS = {
  0: { anchor: 'VP0', fallbackTag: null, label: '俯视全环', kind: 'overview' },
  1: { anchor: 'VP1', fallbackTag: 'start', label: '起点基地', kind: 'ground' },
  5: { anchor: 'VP5', fallbackTag: 'summit', label: '山顶俯瞰', kind: 'highground' },
};

// 由 world 解析每个 VP 的相机位姿（世界坐标）。
export function resolveViewpoints(world) {
  const cps = world.track.controlPoints;
  const center = world.center;
  // 全环包围盒
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
  for (const c of center) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
    maxY = Math.max(maxY, c.y);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ);

  const findCp = (anchor, tag) => {
    let cp = cps.find((c) => c.vpAnchor === anchor);
    if (!cp && tag) cp = cps.find((c) => c.tags && c.tags.includes(tag));
    return cp || null;
  };

  const out = {};

  // VP0 — 全环俯视（拉高+稍偏，保证整环入画 + 降雾后看清）
  out[0] = {
    label: VP_ANCHORS[0].label,
    camPos: { x: cx, y: maxY + span * 1.35, z: cz + span * 0.18 },
    lookAt: { x: cx, y: 0, z: cz },
    sIndex: null,
  };

  // VP1 — 起点机位：抬高+拉远（不贴脸，看到起点全貌+走向）
  const cp1 = findCp('VP1', 'start') || cps[0];
  const s1 = nearestSampleIndex(center, cp1.pos);
  const nxt1 = center[(s1 + 8) % center.length];
  const dirx = nxt1.x - cp1.pos.x, dirz = nxt1.z - cp1.pos.z;
  const dl = Math.hypot(dirx, dirz) || 1;
  out[1] = {
    label: VP_ANCHORS[1].label,
    camPos: {
      x: cp1.pos.x - (dirx / dl) * 90,
      y: cp1.pos.y + 70,
      z: cp1.pos.z - (dirz / dl) * 90,
    },
    lookAt: { x: cp1.pos.x + (dirx / dl) * 60, y: cp1.pos.y + 4, z: cp1.pos.z + (dirz / dl) * 60 },
    sIndex: s1,
  };

  // VP5 — 山顶俯瞰：机位高于山顶，看清山顶/道路/远景关系
  let cp5 = findCp('VP5', 'summit');
  if (!cp5) {
    cp5 = cps.reduce((a, b) => (b.pos.y > a.pos.y ? b : a), cps[0]);
  }
  const s5 = nearestSampleIndex(center, cp5.pos);
  out[5] = {
    label: VP_ANCHORS[5].label,
    camPos: { x: cp5.pos.x + span * 0.16, y: cp5.pos.y + 220, z: cp5.pos.z + span * 0.30 },
    lookAt: { x: (cp5.pos.x + cx) / 2, y: 0, z: (cp5.pos.z + cz) / 2 },
    sIndex: s5,
  };

  return out;
}

function nearestSampleIndex(center, pos) {
  let best = Infinity, bi = 0;
  for (let i = 0; i < center.length; i++) {
    const d = Math.hypot(center[i].x - pos.x, center[i].z - pos.z);
    if (d < best) { best = d; bi = i; }
  }
  return bi;
}
