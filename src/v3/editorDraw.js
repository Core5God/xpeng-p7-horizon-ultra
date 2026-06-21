// Horizon V3 — editor part 3: draw (PR1)
// task-20260621-V3-PR1

import { TrackEditor } from './editor.js';
import { sampleClosedSpline, detectSelfIntersections, checkClosure, arcLengths } from './trackSpline.js';
import { classifyControlPoint, SEGMENT_DEFAULT, SEGMENT_TYPES } from './trackSchema.js';
import { HERO_TAGS } from './routeAnalysis.js';

// landmark 标签 → 体验节点显示名（优先级高于控制点编号）
const HERO_LABEL = {
  start: 'START', valley: 'VALLEY', hairpin: 'HAIRPIN', summit: 'SUMMIT',
  cave: 'CAVE', tunnel: 'TUNNEL', coast_sunrise: 'COAST', harbor_sunset: 'HARBOR',
};

const P = TrackEditor.prototype;

P.draw = function () {
  const ctx = this.ctx;
  const W = this.canvas.width, H = this.canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0e1116';
  ctx.fillRect(0, 0, W, H);

  this._drawGrid(ctx, W, H);

  const cps = this.track.controlPoints;
  let analysis = { samples: [], hits: [], closure: { closed: false, total: 0, degenerate: 0 } };
  if (cps.length >= 3) {
    const samples = sampleClosedSpline(cps, 20);
    const hits = detectSelfIntersections(samples);
    const closure = checkClosure(samples);
    analysis = { samples, hits, closure };
    // 路面宽度带：按段类型着色（克制可辨）
    this._drawRibbon(ctx, samples);
    // 中心线（自交叉则部分标红）
    ctx.lineWidth = 2;
    ctx.strokeStyle = hits.length ? '#ffcf4d' : '#6fd0ff';
    ctx.beginPath();
    samples.forEach((s, i) => {
      const p = this.worldToScreen(s.x, s.z);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
    // 行驶方向箭头（沿环线均匀分布）
    this._drawDirectionArrows(ctx, samples);
    // 起点 START 标记 + 起步方向
    this._drawStartMarker(ctx, samples);
    // 自交叉红点
    hits.forEach((h) => {
      const p = this.worldToScreen(h.x, h.z);
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 1.5; ctx.stroke();
    });
  }

  // 控制点：按段类型着色 + 选中高亮；体验节点标签优先级 > 编号
  cps.forEach((cp, i) => {
    const p = this.worldToScreen(cp.pos.x, cp.pos.z);
    const sel = i === this.selected;
    const st = classifyControlPoint(cp);
    const heroTag = (cp.tags || []).find((t) => HERO_TAGS.includes(t));
    const r = sel ? 11 : 6;
    if (sel) {
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = sel ? '#ffd24d' : st.color;
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#0e1116'; ctx.stroke();
    // 控制点编号：工程信息，小号淡色（仅选中 / VP / hero 时显示）
    if (sel || cp.vpAnchor || heroTag) {
      ctx.fillStyle = '#6f7c93'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`#${i} y${cp.pos.y.toFixed(0)}`, p.x + r + 4, p.y + 12);
    }
  });
  // 体验节点标签（二次遍历，画在控制点上层，视觉优先级最高）
  cps.forEach((cp, i) => {
    const heroTag = (cp.tags || []).find((t) => HERO_TAGS.includes(t));
    if (!heroTag && !cp.vpAnchor) return;
    const p = this.worldToScreen(cp.pos.x, cp.pos.z);
    const label = HERO_LABEL[heroTag] || '';
    let ty = p.y - 16;
    if (label) {
      ctx.font = 'bold 12px "Noto Sans SC",monospace'; ctx.textAlign = 'center';
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(10,13,18,0.82)';
      ctx.fillRect(p.x - tw / 2, ty - 12, tw, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, p.x, ty);
      ty -= 18;
    }
    if (cp.vpAnchor) {
      ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      const vw = ctx.measureText(cp.vpAnchor).width + 10;
      ctx.fillStyle = '#e0b34d';
      ctx.fillRect(p.x - vw / 2, ty - 11, vw, 14);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillText(cp.vpAnchor, p.x, ty);
    }
    ctx.textAlign = 'left';
  });

  this._drawLegend(ctx);
  this._drawStatus(analysis);
};

// 行驶方向箭头：沿环线采样点间隔画箭头
P._drawDirectionArrows = function (ctx, samples) {
  const n = samples.length;
  if (n < 8) return;
  const stepN = Math.max(6, Math.floor(n / 18));
  ctx.fillStyle = 'rgba(143,208,255,0.9)';
  for (let i = 0; i < n; i += stepN) {
    const a = samples[i], b = samples[(i + 2) % n];
    const p = this.worldToScreen(a.x, a.z);
    const ang = Math.atan2(
      this.worldToScreen(b.x, b.z).y - p.y,
      this.worldToScreen(b.x, b.z).x - p.x,
    );
    const sz = 7;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(sz, 0); ctx.lineTo(-sz * 0.7, sz * 0.6); ctx.lineTo(-sz * 0.7, -sz * 0.6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
};

// 起点 START 标记：在起点控制点画明显旗标 + 起步方向大箭头
P._drawStartMarker = function (ctx, samples) {
  const cps = this.track.controlPoints;
  let si = cps.findIndex((c) => c.vpAnchor === 'VP1' || (c.tags && c.tags.includes('start')));
  if (si < 0) si = 0;
  const cp = cps[si];
  const p = this.worldToScreen(cp.pos.x, cp.pos.z);
  // 起步方向：指向下一个控制点
  const nxt = cps[(si + 1) % cps.length];
  const pn = this.worldToScreen(nxt.pos.x, nxt.pos.z);
  const ang = Math.atan2(pn.y - p.y, pn.x - p.x);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  // 粗起步箭头
  ctx.fillStyle = '#7affc0';
  ctx.beginPath();
  ctx.moveTo(34, 0); ctx.lineTo(14, 11); ctx.lineTo(14, 4);
  ctx.lineTo(-2, 4); ctx.lineTo(-2, -4); ctx.lineTo(14, -4); ctx.lineTo(14, -11);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // START 旗标牌
  ctx.fillStyle = '#1a8f5a';
  ctx.fillRect(p.x - 30, p.y - 34, 60, 18);
  ctx.strokeStyle = '#7affc0'; ctx.lineWidth = 2; ctx.strokeRect(p.x - 30, p.y - 34, 60, 18);
  ctx.fillStyle = '#eafff3'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
  ctx.fillText('START', p.x, p.y - 21);
  ctx.textAlign = 'left';
};

// 图例：段类型颜色说明（画布左下角）
P._drawLegend = function (ctx) {
  const items = SEGMENT_TYPES;
  const x = 14, h = 18;
  let y = this.canvas.height - items.length * h - 14;
  ctx.fillStyle = 'rgba(14,18,24,0.7)';
  ctx.fillRect(x - 8, y - 8, 132, items.length * h + 14);
  ctx.font = '11px monospace';
  items.forEach((st) => {
    ctx.fillStyle = st.color;
    ctx.fillRect(x, y + 3, 12, 12);
    ctx.fillStyle = '#cfe';
    ctx.fillText(`${st.name} ${st.zh}`, x + 18, y + 13);
    y += h;
  });
};

P._drawGrid = function (ctx, W, H) {
  const step = 100; // world meters per grid line
  const sStep = step * this.view.scale;
  if (sStep < 6) return;
  ctx.strokeStyle = 'rgba(120,140,170,0.10)'; ctx.lineWidth = 1;
  const origin = this.worldToScreen(0, 0);
  let x0 = origin.x % sStep; if (x0 < 0) x0 += sStep;
  let y0 = origin.y % sStep; if (y0 < 0) y0 += sStep;
  ctx.beginPath();
  for (let x = x0; x < W; x += sStep) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = y0; y < H; y += sStep) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  // 原点轴
  ctx.strokeStyle = 'rgba(140,180,220,0.30)';
  ctx.beginPath();
  ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, H);
  ctx.moveTo(0, origin.y); ctx.lineTo(W, origin.y);
  ctx.stroke();
};

P._drawRibbon = function (ctx, samples) {
  // 按段类型分段填充路面带（克制可辨）
  const left = [], right = [];
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const a = samples[i], b = samples[(i + 1) % n];
    let tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1; tx /= len; tz /= len;
    const nx = -tz, nz = tx;
    const hw = a.roadWidth / 2;
    left.push(this.worldToScreen(a.x + nx * hw, a.z + nz * hw));
    right.push(this.worldToScreen(a.x - nx * hw, a.z - nz * hw));
  }
  const cps = this.track.controlPoints;
  for (let i = 0; i < n; i++) {
    const a = samples[i];
    const st = cps[a.cpA] ? classifyControlPoint(cps[a.cpA]) : SEGMENT_DEFAULT;
    const i1 = (i + 1) % n;
    ctx.fillStyle = this._hexToRgba(st.color, 0.32);
    ctx.beginPath();
    ctx.moveTo(left[i].x, left[i].y);
    ctx.lineTo(left[i1].x, left[i1].y);
    ctx.lineTo(right[i1].x, right[i1].y);
    ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath(); ctx.fill();
  }
};

P._hexToRgba = function (hex, a) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

P._drawStatus = function (a) {
  const cps = this.track.controlPoints;
  const lines = [];
  lines.push(`控制点: ${cps.length}`);
  if (cps.length >= 3) {
    lines.push(`环线弧长: ${(a.closure.total).toFixed(0)} m (${(a.closure.total / 1000).toFixed(2)} km)`);
    lines.push(`闭合: ${a.closure.closed ? '✔ 已闭合' : '✘'}  退化段: ${a.closure.degenerate}`);
    lines.push(a.hits.length
      ? `⚠ 自交叉 ${a.hits.length} 处（标红，未来转桥/隧道）`
      : `✔ 无自交叉`);
    const tagged = cps.filter((c) => c.tags.length).length;
    const vps = cps.filter((c) => c.vpAnchor).map((c) => c.vpAnchor);
    lines.push(`已打标签点: ${tagged}  VP锚点: ${vps.join(',') || '无'}`);
  } else {
    lines.push('（至少 3 个控制点才能成环）');
  }
  this._status(lines.join('\n'));
};
