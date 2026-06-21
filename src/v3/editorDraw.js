// Horizon V3 — editor part 3: draw (PR1)
// task-20260621-V3-PR1

import { TrackEditor } from './editor.js';
import { sampleClosedSpline, detectSelfIntersections, checkClosure, arcLengths } from './trackSpline.js';

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
    // 路面宽度带（半透明灰）
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
    // 自交叉红点
    hits.forEach((h) => {
      const p = this.worldToScreen(h.x, h.z);
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 1.5; ctx.stroke();
    });
  }

  // 控制点
  cps.forEach((cp, i) => {
    const p = this.worldToScreen(cp.pos.x, cp.pos.z);
    const sel = i === this.selected;
    ctx.beginPath(); ctx.arc(p.x, p.y, sel ? 8 : 6, 0, Math.PI * 2);
    ctx.fillStyle = sel ? '#ffd24d' : (cp.tags.length ? '#7affc0' : '#cfe');
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#0e1116'; ctx.stroke();
    // 序号 + y + 标签
    ctx.fillStyle = '#cfe'; ctx.font = '11px monospace';
    ctx.fillText(`#${i} y${cp.pos.y.toFixed(0)}`, p.x + 9, p.y - 4);
    if (cp.vpAnchor) {
      ctx.fillStyle = '#ffd24d';
      ctx.fillText(cp.vpAnchor, p.x + 9, p.y + 9);
    } else if (cp.tags.length) {
      ctx.fillStyle = '#7affc0'; ctx.font = '10px monospace';
      ctx.fillText(cp.tags[0], p.x + 9, p.y + 9);
    }
  });

  this._drawStatus(analysis);
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
  // 用左右边界多边形填充灰带
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
  ctx.fillStyle = 'rgba(150,160,175,0.22)';
  ctx.beginPath();
  left.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath(); ctx.fill();
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
