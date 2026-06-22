// Horizon V3 — Route analysis engine (PR1.0.2)
// task-20260621-001
//
// 纯数学路线分析引擎，给 VIK 判断「山海闭合环线」用。不依赖 three / DOM。
//   - buildProfile: 沿弧长重采样，附带海拔/坡度/段类型（高度剖面数据）
//   - routeSummary: Route Summary 全部指标
//   - buildSegments: 控制点语义段列表（名称/距离/坡度/标签/HeroZone/VP/warning）
//   - validateRoute: 10 项数学校验 + 视觉打结校验 + 起点专项校验
//   - 所有阈值集中在 THRESHOLDS，方便 VIK / GPT 反馈后调参。

import { sampleClosedSpline, arcLengths, detectSelfIntersections } from './trackSpline.js';
import { classifyControlPoint } from './trackSchema.js';

// 目标参数（15min 山海环线）。坡度按百分比(%)，距离按米。
export const THRESHOLDS = {
  targetLenMin: 8000,      // 单圈目标最短(米)；低于此 warning
  targetLenIdeal: 12000,   // 理想圈长
  avgSpeedKmh: 55,         // 估算单圈时间用的平均车速
  maxGradePct: 18,         // 过陡阈值(%)
  steepWarnPct: 14,        // 偏陡预警
  heroZoneMinLen: 350,     // 单个 Hero Zone(体验段)最短展开距离
  coastMinLen: 600,        // 海岸段最短展开
  summitBufferMin: 250,    // 山顶前后缓冲最短
  startStraightMin: 180,   // 起点前后直线/缓弯最短
  startReturnGapMin: 120,  // 出发线与返回线最近距离下限
  startClusterRadius: 220, // 起点附近控制点过密判定半径
  startClusterMax: 3,      // 半径内控制点数上限
  heroNearMin: 400,        // 两个 Hero Zone 中心最近距离下限
  segShortMin: 150,        // 段太短(体验节奏被压缩)
  downhillAfterSummit: 500,// 山顶后下坡展开最短
  visualKnotDist: 90,      // 非相邻段中心线视觉缠绕距离阈值
};

// Hero Zone（体验节点）= 这些 landmark 标签构成的产品节点。
export const HERO_TAGS = ['start', 'valley', 'hairpin', 'summit', 'cave', 'tunnel', 'coast_sunrise', 'harbor_sunset'];
const HERO_LABEL = {
  start: '起点', valley: '山谷', hairpin: '发卡弯', summit: '山顶',
  cave: '洞穴', tunnel: '隧道', coast_sunrise: '海岸', harbor_sunset: '港湾',
};

function gradePct(dy, dxz) {
  if (dxz <= 1e-6) return 0;
  return (dy / dxz) * 100;
}

// 沿弧长重采样的剖面：每点 {s, x, y, z, grade, cpA, segKey, segName, segColor}
// 用于高度剖面图 + 坡度统计。stepM 取较细以保证剖面平滑。
export function buildProfile(track, stepM = 8) {
  const cps = track.controlPoints || [];
  if (cps.length < 3) return { points: [], total: 0 };
  const samples = sampleClosedSpline(cps, 28);
  const { cum, total } = arcLengths(samples);
  const n = samples.length;
  const count = Math.max(8, Math.round(total / stepM));
  const pts = [];
  let j = 0;
  for (let k = 0; k <= count; k++) {
    const target = (k / count) * total;
    while (j < n && cum[j + 1] < target) j++;
    const a = samples[j % n];
    const b = samples[(j + 1) % n];
    const segLen = cum[j + 1] - cum[j];
    const f = segLen > 1e-6 ? (target - cum[j]) / segLen : 0;
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const z = a.z + (b.z - a.z) * f;
    const cp = cps[a.cpA] || cps[0];
    const st = classifyControlPoint(cp);
    pts.push({ s: target, x, y, z, cpA: a.cpA, segKey: st.key, segName: st.name, segColor: st.color, tags: cp.tags || [] });
  }
  // 逐点坡度（中心差分，按弧长）
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(pts.length - 1, i + 1)];
    const ds = p1.s - p0.s;
    pts[i].grade = ds > 1e-6 ? ((p1.y - p0.y) / ds) * 100 : 0;
  }
  return { points: pts, total };
}

// 控制点语义段列表（相邻控制点之间）。
export function buildSegments(track) {
  const cps = track.controlPoints || [];
  const n = cps.length;
  if (n < 3) return [];
  const samples = sampleClosedSpline(cps, 28);
  const { cum } = arcLengths(samples);
  const spp = samples.length / n; // 每控制点段采样数
  const segDist = []; // 每控制点起始弧长
  for (let i = 0; i < n; i++) segDist.push(cum[Math.round(i * spp)]);
  segDist.push(cum[cum.length - 1]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = cps[i], b = cps[(i + 1) % n];
    const st = classifyControlPoint(a);
    const sStart = segDist[i];
    const sEnd = i + 1 <= n ? segDist[i + 1] : cum[cum.length - 1];
    const len = Math.max(0, sEnd - sStart);
    // 平均坡度：两控制点高差 / 平面距离
    const dxz = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
    const avgGrade = gradePct(b.pos.y - a.pos.y, dxz);
    // 段内最大瞬时坡度
    let maxGrade = 0;
    const i0 = Math.round(i * spp), i1 = Math.round((i + 1) * spp);
    for (let k = i0; k < i1 && k + 1 < samples.length; k++) {
      const s0 = samples[k], s1 = samples[k + 1];
      const g = gradePct(s1.y - s0.y, Math.hypot(s1.x - s0.x, s1.z - s0.z));
      if (Math.abs(g) > Math.abs(maxGrade)) maxGrade = g;
    }
    const heroTag = (a.tags || []).find((t) => HERO_TAGS.includes(t));
    out.push({
      index: i,
      cpId: a.id,
      name: st.name,
      zh: st.zh,
      key: st.key,
      color: st.color,
      sStart, sEnd, len,
      avgGrade, maxGrade,
      tags: a.tags || [],
      hero: heroTag ? HERO_LABEL[heroTag] : null,
      vp: a.vpAnchor || null,
      cx: (a.pos.x + b.pos.x) / 2,
      cz: (a.pos.z + b.pos.z) / 2,
      warnings: [],
    });
  }
  return out;
}

// 单圈预计时间(分钟)：弧长 / 平均车速。
function estLapMinutes(totalM) {
  const km = totalM / 1000;
  return (km / THRESHOLDS.avgSpeedKmh) * 60;
}

// Route Summary：固定主视野的全部指标。
export function routeSummary(track) {
  const cps = track.controlPoints || [];
  const prof = buildProfile(track, 8);
  const segs = buildSegments(track);
  const samples = cps.length >= 3 ? sampleClosedSpline(cps, 24) : [];
  const hits = detectSelfIntersections(samples);
  const closure = { closed: prof.total > 1, total: prof.total };
  let maxY = -Infinity, minY = Infinity, maxUp = 0, maxDown = 0;
  for (const p of prof.points) {
    maxY = Math.max(maxY, p.y); minY = Math.min(minY, p.y);
    if (p.grade > maxUp) maxUp = p.grade;
    if (p.grade < maxDown) maxDown = p.grade;
  }
  if (!isFinite(maxY)) { maxY = 0; minY = 0; }
  const vps = cps.filter((c) => c.vpAnchor).map((c) => c.vpAnchor);
  const heroCount = segs.filter((s) => s.hero).length;
  // 起点过挤：起点半径内控制点数
  let startCrowd = false;
  if (cps.length) {
    const s0 = cps[0].pos;
    let near = 0;
    for (const c of cps) {
      if (Math.hypot(c.pos.x - s0.x, c.pos.z - s0.z) < THRESHOLDS.startClusterRadius) near++;
    }
    startCrowd = near > THRESHOLDS.startClusterMax;
  }
  const tooSteep = Math.max(maxUp, -maxDown) > THRESHOLDS.maxGradePct;
  const shortestHero = segs.filter((s) => s.hero).reduce((m, s) => Math.min(m, s.len), Infinity);
  const heroTooShort = isFinite(shortestHero) && shortestHero < THRESHOLDS.heroZoneMinLen;
  return {
    totalM: prof.total,
    totalKm: prof.total / 1000,
    lapMin: estLapMinutes(prof.total),
    cpCount: cps.length,
    segCount: segs.length,
    vpCount: vps.length,
    vps,
    maxY, minY, dHeight: maxY - minY,
    maxUp, maxDown,
    closed: closure.closed,
    selfIntersect: hits.length,
    startCrowd,
    tooSteep,
    heroCount,
    heroTooShort,
    shortestHero: isFinite(shortestHero) ? shortestHero : 0,
  };
}
