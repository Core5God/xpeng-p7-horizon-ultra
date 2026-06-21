// Horizon V3 — Route validation (PR1.0.2)
// task-20260621-001
//
// 严格路线校验：给 VIK warning，不让肉眼猜。
//   A. 数学校验(>=10): 总长/过陡/起终回环过挤/HeroZone过短/海岸展开/
//      山顶缓冲/tunnel·no_airborne合理段/crest·jump_test·landing_zone链路/
//      VP1-8齐全/每VP对应体验节点
//   B. 视觉打结校验: 视觉缠绕/起点过密/段太短/HeroZone太近/山顶后下坡不足/海岸太短
//   C. 起点区域专项校验: 出发返回距离/起点视觉打结/起点直线缓弯/容纳基地/方向清晰
// 返回 { items:[{id,level,scope,title,detail}], pass, counts }

import { sampleClosedSpline, arcLengths, detectSelfIntersections } from './trackSpline.js';
import { buildSegments, buildProfile, routeSummary, THRESHOLDS, HERO_TAGS } from './routeAnalysis.js';

function mk(id, level, scope, title, detail) { return { id, level, scope, title, detail }; }

// 期望齐全的 VP 列表（VP1..VP8）。
export const EXPECTED_VPS = ['VP1', 'VP2', 'VP3', 'VP4', 'VP5', 'VP6', 'VP7', 'VP8'];

export function validateRoute(track) {
  const items = [];
  const cps = track.controlPoints || [];
  if (cps.length < 3) {
    items.push(mk('struct', 'error', 'math', '控制点不足', `当前 ${cps.length} 个，闭合环线至少 3 个。`));
    return finalize(items);
  }
  const sum = routeSummary(track);
  const segs = buildSegments(track);
  const prof = buildProfile(track, 8);
  const samples = sampleClosedSpline(cps, 24);

  // ---------- A. 数学校验 ----------
  // 1 总长
  if (sum.totalM < THRESHOLDS.targetLenMin) {
    items.push(mk('len', 'warn', 'math', '总长偏短', `单圈 ${(sum.totalM/1000).toFixed(2)}km，低于目标 ${(THRESHOLDS.targetLenMin/1000).toFixed(1)}km，难撑 15min 山海环线。`));
  } else {
    items.push(mk('len', 'ok', 'math', '总长达标', `单圈 ${(sum.totalM/1000).toFixed(2)}km，预计 ${sum.lapMin.toFixed(1)}min。`));
  }
  // 2 过陡
  const steep = Math.max(sum.maxUp, -sum.maxDown);
  if (steep > THRESHOLDS.maxGradePct) {
    items.push(mk('steep', 'warn', 'math', '存在过陡路段', `最陡 ${steep.toFixed(1)}% > ${THRESHOLDS.maxGradePct}%，车辆体验突兀。`));
  } else if (steep > THRESHOLDS.steepWarnPct) {
    items.push(mk('steep', 'warn', 'math', '坡度偏陡', `最陡 ${steep.toFixed(1)}%，接近上限 ${THRESHOLDS.maxGradePct}%。`));
  } else {
    items.push(mk('steep', 'ok', 'math', '坡度合理', `最陡 ${steep.toFixed(1)}% 在阈值内。`));
  }
  // 3 起终回环过挤
  const start = cps[0].pos, last = cps[cps.length - 1].pos;
  const gap = Math.hypot(last.x - start.x, last.z - start.z);
  if (gap < THRESHOLDS.startReturnGapMin) {
    items.push(mk('loop', 'warn', 'math', '起终回环过挤', `返回点距起点仅 ${gap.toFixed(0)}m < ${THRESHOLDS.startReturnGapMin}m，无基地展开空间。`));
  } else {
    items.push(mk('loop', 'ok', 'math', '起终回环合理', `返回点距起点 ${gap.toFixed(0)}m。`));
  }
  // 4 Hero Zone 过短
  const heroSegs = segs.filter((s) => s.hero);
  const shortHero = heroSegs.filter((s) => s.len < THRESHOLDS.heroZoneMinLen);
  if (shortHero.length) {
    items.push(mk('herolen', 'warn', 'math', 'Hero Zone 过短', shortHero.map((s) => `${s.hero}(${s.len.toFixed(0)}m)`).join('、') + ` < ${THRESHOLDS.heroZoneMinLen}m，体验节奏被压缩。`));
  } else if (heroSegs.length) {
    items.push(mk('herolen', 'ok', 'math', 'Hero Zone 展开充分', `最短 ${sum.shortestHero.toFixed(0)}m。`));
  }
  // 5 海岸段展开
  const coastLen = segs.filter((s) => s.key === 'coast').reduce((a, s) => a + s.len, 0);
  if (coastLen < THRESHOLDS.coastMinLen) {
    items.push(mk('coast', 'warn', 'math', '海岸段不足', `海岸合计 ${coastLen.toFixed(0)}m < ${THRESHOLDS.coastMinLen}m，缺海边巡航感。`));
  } else {
    items.push(mk('coast', 'ok', 'math', '海岸段展开足够', `合计 ${coastLen.toFixed(0)}m。`));
  }
  // 6 山顶前后缓冲
  const summitIdx = segs.filter((s) => s.key === 'summit').map((s) => s.index);
  if (summitIdx.length) {
    let okBuf = true; let worst = Infinity;
    for (const si of summitIdx) {
      const prev = segs[(si - 1 + segs.length) % segs.length];
      const next = segs[(si + 1) % segs.length];
      const buf = Math.min(prev.len, next.len);
      worst = Math.min(worst, buf);
      if (buf < THRESHOLDS.summitBufferMin) okBuf = false;
    }
    items.push(okBuf
      ? mk('summitbuf', 'ok', 'math', '山顶缓冲充足', `最短缓冲 ${worst.toFixed(0)}m。`)
      : mk('summitbuf', 'warn', 'math', '山顶前后缓冲不足', `最短 ${worst.toFixed(0)}m < ${THRESHOLDS.summitBufferMin}m，俯瞰节奏太赶。`));
  } else {
    items.push(mk('summitbuf', 'warn', 'math', '缺少山顶节点', '未标记 summit，无法判断山顶俯瞰节奏。'));
  }
  // 7 tunnel / no_airborne 是否在合理段落
  const tunnelCps = cps.filter((c) => (c.tags||[]).includes('tunnel') || (c.tags||[]).includes('cave'));
  const naCps = cps.filter((c) => (c.tags||[]).includes('no_airborne'));
  const naOnTunnel = tunnelCps.some((c) => (c.tags||[]).includes('no_airborne'))
    || naCps.some((c) => (c.tags||[]).includes('tunnel') || (c.tags||[]).includes('cave'));
  if (!tunnelCps.length) {
    items.push(mk('tunnel', 'warn', 'math', '缺少隧道/洞穴段', '未标 tunnel/cave，山海环线缺穿山节点。'));
  } else if (!naOnTunnel) {
    items.push(mk('tunnel', 'warn', 'math', 'tunnel 未配 no_airborne', '隧道段未标 no_airborne，未来腾空物理会出穿顶风险。'));
  } else {
    items.push(mk('tunnel', 'ok', 'math', 'tunnel/no_airborne 合理', `隧道/洞穴 ${tunnelCps.length} 处且含贴地约束。`));
  }
  // 8 crest / jump_test / landing_zone 物理链路
  const hasCrest = cps.some((c) => (c.tags||[]).includes('crest'));
  const hasJump = cps.some((c) => (c.tags||[]).includes('jump_test'));
  const hasDrop = cps.some((c) => (c.tags||[]).includes('downhill_drop'));
  const hasLanding = cps.some((c) => (c.tags||[]).includes('landing_zone'));
  const chainParts = [];
  if (!hasCrest) chainParts.push('crest');
  if (!(hasJump || hasDrop)) chainParts.push('jump_test/downhill_drop');
  if (!hasLanding) chainParts.push('landing_zone');
  if (chainParts.length) {
    items.push(mk('chain', 'warn', 'math', '物理链路不完整', `缺 ${chainParts.join('、')}，crest→jump→landing 不闭环。`));
  } else {
    items.push(mk('chain', 'ok', 'math', '物理链路完整', 'crest → jump_test/downhill_drop → landing_zone 齐备。'));
  }
  // 9 VP1-8 齐全
  const vps = cps.filter((c) => c.vpAnchor).map((c) => c.vpAnchor);
  const missing = EXPECTED_VPS.filter((v) => !vps.includes(v));
  if (missing.length) {
    items.push(mk('vpfull', 'warn', 'math', 'VP1-8 不齐', `已有 ${vps.join(',')||'无'}；缺 ${missing.join(',')}。`));
  } else {
    items.push(mk('vpfull', 'ok', 'math', 'VP1-8 齐全', vps.join(',')));
  }
  // 10 每 VP 是否对应一个体验节点
  const vpNoHero = cps.filter((c) => c.vpAnchor && !(c.tags||[]).some((t) => HERO_TAGS.includes(t)));
  if (vpNoHero.length) {
    items.push(mk('vphero', 'warn', 'math', 'VP 未对应体验节点', vpNoHero.map((c) => c.vpAnchor).join(',') + ' 所在点无 landmark 标签。'));
  } else if (vps.length) {
    items.push(mk('vphero', 'ok', 'math', '每 VP 均有体验节点', `${vps.length} 个 VP 均落在体验节点上。`));
  }

  // ---------- B. 视觉打结校验 ----------
  visualChecks(items, track, segs, samples, sum);
  // ---------- C. 起点区域专项 ----------
  startZoneChecks(items, track, segs, samples);
  return finalize(items);
}

function finalize(items) {
  const counts = { error: 0, warn: 0, ok: 0 };
  for (const it of items) counts[it.level] = (counts[it.level] || 0) + 1;
  return { items, pass: counts.error === 0 && counts.warn === 0, counts };
}

// B. 视觉打结：非相邻段中心线过近 / 段太短 / HeroZone太近 / 山顶后下坡不足 / 海岸太短
function visualChecks(items, track, segs, samples, sum) {
  const T = THRESHOLDS;
  // 视觉缠绕：采样点两两最近距离（跳过邻近）< 阈值但未相交
  let knot = 0; const n = samples.length;
  const skip = Math.max(6, Math.floor(n / 12));
  for (let i = 0; i < n; i += 2) {
    for (let j = i + skip; j < n - 2; j += 2) {
      const d = Math.hypot(samples[i].x - samples[j].x, samples[i].z - samples[j].z);
      if (d < T.visualKnotDist) knot++;
    }
  }
  if (knot > 0) {
    items.push(mk('knot', 'warn', 'visual', '视觉缠绕', `${knot} 处非相邻段间距 < ${T.visualKnotDist}m，线未相交但看上去缠在一起。`));
  } else {
    items.push(mk('knot', 'ok', 'visual', '无视觉缠绕', '非相邻段间距充足。'));
  }
  // 段太短
  const shortSegs = segs.filter((s) => s.len < T.segShortMin);
  if (shortSegs.length) {
    items.push(mk('segshort', 'warn', 'visual', '段太短', shortSegs.map((s) => `#${s.index}${s.name}(${s.len.toFixed(0)}m)`).join('、') + ` < ${T.segShortMin}m，体验节奏被压缩。`));
  }
  // Hero Zone 太近（中心点两两距离）
  const heroSegs = segs.filter((s) => s.hero);
  let tooNear = null;
  for (let i = 0; i < heroSegs.length; i++) {
    for (let j = i + 1; j < heroSegs.length; j++) {
      const d = Math.hypot(heroSegs[i].cx - heroSegs[j].cx, heroSegs[i].cz - heroSegs[j].cz);
      if (d < T.heroNearMin) tooNear = `${heroSegs[i].hero}↔${heroSegs[j].hero}(${d.toFixed(0)}m)`;
    }
  }
  if (tooNear) items.push(mk('heronear', 'warn', 'visual', 'Hero Zone 太近', tooNear + ` < ${T.heroNearMin}m，体验点扎堆。`));
  // 山顶后下坡展开
  const summit = segs.find((s) => s.key === 'summit');
  if (summit) {
    let acc = 0;
    for (let k = 1; k <= 3; k++) acc += segs[(summit.index + k) % segs.length].len;
    if (acc < T.downhillAfterSummit) {
      items.push(mk('postsummit', 'warn', 'visual', '山顶后下坡不足', `山顶后 3 段仅 ${acc.toFixed(0)}m < ${T.downhillAfterSummit}m，下坡没展开。`));
    }
  }
  // 海岸太短（复用 math 表现但从视觉巡航感角度提醒）
  const coastSegs = segs.filter((s) => s.key === 'coast');
  const coastLen = coastSegs.reduce((a, s) => a + s.len, 0);
  if (coastSegs.length && coastLen < T.coastMinLen) {
    items.push(mk('coastshort', 'warn', 'visual', '海岸段太短', `合计 ${coastLen.toFixed(0)}m，没有海边巡航感。`));
  }
}

// C. 起点区域专项：出发/返回距离、起点视觉打结、起点前后直线缓弯、容纳基地、方向清晰
function startZoneChecks(items, track, segs, samples) {
  const T = THRESHOLDS;
  const cps = track.controlPoints;
  const s0 = cps[0].pos;
  // 出发线 vs 返回线：起点后一点 与 起点前一点 的间距
  const next = cps[1].pos, prev = cps[cps.length - 1].pos;
  const outDir = { x: next.x - s0.x, z: next.z - s0.z };
  const inDir = { x: s0.x - prev.x, z: s0.z - prev.z };
  const lateralGap = Math.hypot(prev.x - next.x, prev.z - next.z);
  if (lateralGap < T.startReturnGapMin) {
    items.push(mk('startgap', 'warn', 'start', '出发/返回线过近', `间距 ${lateralGap.toFixed(0)}m < ${T.startReturnGapMin}m，起点进出会打结。`));
  } else {
    items.push(mk('startgap', 'ok', 'start', '出发/返回线间距合理', `${lateralGap.toFixed(0)}m。`));
  }
  // 起点视觉打结：起点附近控制点太密
  let near = 0;
  for (const c of cps) {
    if (c === cps[0]) continue;
    if (Math.hypot(c.pos.x - s0.x, c.pos.z - s0.z) < T.startClusterRadius) near++;
  }
  if (near > T.startClusterMax) {
    items.push(mk('startcrowd', 'warn', 'start', '起点控制点太密', `${T.startClusterRadius}m 内有 ${near} 个点，视觉打结。`));
  } else {
    items.push(mk('startcrowd', 'ok', 'start', '起点点密度合理', `${T.startClusterRadius}m 内 ${near} 个点。`));
  }
  // 起点前后直线/缓弯：起始段长度
  const startSeg = segs[0];
  const retSeg = segs[segs.length - 1];
  if (startSeg.len < T.startStraightMin || retSeg.len < T.startStraightMin) {
    items.push(mk('startstraight', 'warn', 'start', '起点缺直线/缓弯', `起步段 ${startSeg.len.toFixed(0)}m / 回程段 ${retSeg.len.toFixed(0)}m，低于 ${T.startStraightMin}m。`));
  } else {
    items.push(mk('startstraight', 'ok', 'start', '起点前后有直线/缓弯', `起步 ${startSeg.len.toFixed(0)}m / 回程 ${retSeg.len.toFixed(0)}m。`));
  }
  // 容纳基地/车库/停车/充电：起点周边空间（最近非相邻点距离）
  let clearest = Infinity;
  for (let i = 2; i < cps.length - 1; i++) {
    clearest = Math.min(clearest, Math.hypot(cps[i].pos.x - s0.x, cps[i].pos.z - s0.z));
  }
  if (isFinite(clearest) && clearest < T.heroNearMin) {
    items.push(mk('startbase', 'warn', 'start', '起点基地空间不足', `最近路段 ${clearest.toFixed(0)}m < ${T.heroNearMin}m，难容纳车库/停车/充电。`));
  } else {
    items.push(mk('startbase', 'ok', 'start', '起点预留基地空间', `最近路段 ${isFinite(clearest)?clearest.toFixed(0):'—'}m。`));
  }
  // 方向一眼看清：出发与返回方向夹角（过小=进出重叠）
  const a1 = Math.atan2(outDir.z, outDir.x);
  const a2 = Math.atan2(inDir.z, inDir.x);
  let diff = Math.abs(a1 - a2) * 180 / Math.PI; if (diff > 180) diff = 360 - diff;
  if (diff < 25) {
    items.push(mk('startdir', 'warn', 'start', '起点方向不清', `出发/返回夹角仅 ${diff.toFixed(0)}°，方向不易一眼看清。`));
  } else {
    items.push(mk('startdir', 'ok', 'start', '起点方向清晰', `出发/返回夹角 ${diff.toFixed(0)}°。`));
  }
}
