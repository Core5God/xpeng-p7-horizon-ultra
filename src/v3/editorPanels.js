// Horizon V3 — editor panels: summary / profile / segments / validation / AI IO (PR1.0.2)
// task-20260621-001
// 以原型扩展 TrackEditor，渲染产品级面板。不改 3D，纯 2D 编辑器。

import { TrackEditor } from './editor.js';
import { serializeTrack, normalizeTrack } from './trackSchema.js';
import { routeSummary, buildSegments, buildProfile, THRESHOLDS } from './routeAnalysis.js';
import { validateRoute, EXPECTED_VPS } from './routeValidate.js';

const P = TrackEditor.prototype;

// 主入口：导入/编辑后立即重算并重绘所有面板（禁用旧缓存）。
P.refreshPanels = function () {
  this._summary = routeSummary(this.track);
  this._segments = buildSegments(this.track);
  this._profile = buildProfile(this.track, 8);
  this._validation = validateRoute(this.track);
  this.renderSummary();
  this.renderSegments();
  this.renderValidation();
  this.drawProfile();
};

P.renderSummary = function () {
  const el = document.getElementById('v3p-summary');
  if (!el) return;
  const s = this._summary;
  if (!s || s.cpCount < 3) { el.innerHTML = '<span class="v3p-bad">控制点不足 3 个，无法成环</span>'; return; }
  const f = (v, d = 0) => v.toFixed(d);
  const flag = (bad, badTxt, okTxt) => `<b class="${bad ? 'v3p-bad' : 'v3p-ok'}">${bad ? badTxt : okTxt}</b>`;
  el.innerHTML =
    `<div class="v3p-grid">` +
    cell('总长', `${f(s.totalKm, 2)} km`) +
    cell('单圈预计', `${f(s.lapMin, 1)} min`) +
    cell('控制点', s.cpCount) +
    cell('Segment', s.segCount) +
    cell('VP', `${s.vpCount}/8`) +
    cell('最高点', `${f(s.maxY)} m`) +
    cell('最低点', `${f(s.minY)} m`) +
    cell('总高差', `${f(s.dHeight)} m`) +
    cell('最大上坡', `${f(s.maxUp, 1)} %`) +
    cell('最大下坡', `${f(s.maxDown, 1)} %`) +
    cell('闭合', flag(!s.closed, '✘未闭合', '✔已闭合')) +
    cell('自交叉', flag(s.selfIntersect > 0, `⚠${s.selfIntersect}`, '✔无')) +
    cell('起点过挤', flag(s.startCrowd, '⚠是', '✔否')) +
    cell('过陡路段', flag(s.tooSteep, '⚠有', '✔无')) +
    cell('HeroZone过短', flag(s.heroTooShort, '⚠是', '✔否')) +
    `</div>`;
  function cell(k, v) { return `<div class="v3p-cell"><span class="v3p-k">${k}</span><span class="v3p-v">${v}</span></div>`; }
};

P.renderSegments = function () {
  const el = document.getElementById('v3p-seglist');
  if (!el) return;
  const segs = this._segments || [];
  const warnByIdx = {};
  (this._validation ? this._validation.items : []).forEach((it) => {
    const m = it.detail && it.detail.match(/#(\d+)/g);
    if (it.level !== 'ok' && m) m.forEach((x) => { warnByIdx[+x.slice(1)] = true; });
  });
  if (!segs.length) { el.innerHTML = '<div class="v3p-empty">无段</div>'; return; }
  el.innerHTML = segs.map((s) => {
    const steep = Math.abs(s.maxGrade) > THRESHOLDS.maxGradePct;
    const warn = steep || warnByIdx[s.index] || s.len < THRESHOLDS.segShortMin;
    const hero = s.hero ? `<span class="v3p-hero">${s.hero}</span>` : '';
    const vp = s.vp ? `<span class="v3p-vp">${s.vp}</span>` : '';
    return `<div class="v3p-seg ${warn ? 'warn' : ''}" data-seg="${s.index}">` +
      `<span class="v3p-dot" style="background:${s.color}"></span>` +
      `<span class="v3p-sname">#${s.index} ${s.name}<small>${s.zh}</small></span>` +
      hero + vp +
      `<span class="v3p-smeta">${s.len.toFixed(0)}m · 均${s.avgGrade.toFixed(1)}% · 峰${s.maxGrade.toFixed(1)}%</span>` +
      (warn ? '<span class="v3p-segw">⚠</span>' : '') +
      `</div>`;
  }).join('');
};

P.renderValidation = function () {
  const el = document.getElementById('v3p-validation');
  if (!el) return;
  const v = this._validation;
  if (!v) { el.innerHTML = ''; return; }
  const scopeName = { math: '数学', visual: '视觉打结', start: '起点区域' };
  const head = `<div class="v3p-vhead ${v.pass ? 'ok' : 'bad'}">` +
    `校验：错误 ${v.counts.error} · 警告 ${v.counts.warn} · 通过 ${v.counts.ok}` +
    `${v.pass ? '　✔ 全部通过' : '　⚠ 需关注'}</div>`;
  const rows = v.items.map((it) => {
    const ic = it.level === 'error' ? '✘' : it.level === 'warn' ? '⚠' : '✔';
    return `<div class="v3p-vrow ${it.level}"><span class="v3p-vic">${ic}</span>` +
      `<span class="v3p-vscope">[${scopeName[it.scope] || it.scope}]</span> ` +
      `<b>${it.title}</b><br><small>${it.detail}</small></div>`;
  }).join('');
  el.innerHTML = head + rows;
};

// 高度剖面图：距离×海拔，按段类型填色 + crest/downhill_drop/landing_zone/tunnel 标记。
P.drawProfile = function () {
  const cv = document.getElementById('v3p-profile');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width = cv.clientWidth || 560;
  const H = cv.height = 150;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0d12'; ctx.fillRect(0, 0, W, H);
  const prof = this._profile;
  if (!prof || !prof.points.length) {
    ctx.fillStyle = '#7e8aa0'; ctx.font = '12px monospace';
    ctx.fillText('控制点不足，无剖面', 12, H / 2); return;
  }
  const pts = prof.points;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const padT = 16, padB = 22, padL = 40, padR = 8;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const sx = (s) => padL + (s / prof.total) * plotW;
  const span = (maxY - minY) || 1;
  const sy = (y) => padT + plotH - ((y - minY) / span) * plotH;
  // 水平网格 + 海拔刻度
  ctx.strokeStyle = 'rgba(120,140,170,0.15)'; ctx.fillStyle = '#7e8aa0'; ctx.font = '9px monospace';
  for (let k = 0; k <= 4; k++) {
    const y = padT + (plotH * k) / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    const val = maxY - (span * k) / 4;
    ctx.fillText(val.toFixed(0), 4, y + 3);
  }
  // 海平面 y=0
  if (minY < 0 && maxY > 0) {
    const y0 = sy(0); ctx.strokeStyle = 'rgba(79,182,200,0.5)';
    ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(W - padR, y0); ctx.stroke();
  }
  // 按段类型填色面积
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    ctx.fillStyle = hexA(a.segColor, 0.35);
    ctx.beginPath();
    ctx.moveTo(sx(a.s), sy(a.y)); ctx.lineTo(sx(b.s), sy(b.y));
    ctx.lineTo(sx(b.s), padT + plotH); ctx.lineTo(sx(a.s), padT + plotH);
    ctx.closePath(); ctx.fill();
  }
  // 海拔曲线
  ctx.strokeStyle = '#8fd0ff'; ctx.lineWidth = 1.6; ctx.beginPath();
  pts.forEach((p, i) => { const X = sx(p.s), Y = sy(p.y); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
  ctx.stroke();
  // 物理/语义标记：crest / downhill_drop / landing_zone / tunnel
  const marks = { crest: ['#e0b34d', '⛰'], downhill_drop: ['#ff8a5b', '↓'], landing_zone: ['#7affc0', '⊻'], jump_test: ['#ffd24d', '✦'], tunnel: ['#9aa0ad', '⌒'], cave: ['#9aa0ad', '⌒'] };
  const cps = this.track.controlPoints;
  pts.forEach((p) => {
    for (const t of p.tags) {
      if (!marks[t]) continue;
      const [col, gl] = marks[t];
      const X = sx(p.s), Y = sy(p.y);
      ctx.fillStyle = col; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(gl, X, Y - 6);
      ctx.textAlign = 'left';
      break;
    }
  });
  // x 轴距离刻度
  ctx.fillStyle = '#7e8aa0'; ctx.font = '9px monospace';
  for (let k = 0; k <= 4; k++) {
    const s = (prof.total * k) / 4;
    ctx.fillText((s / 1000).toFixed(1) + 'km', padL + (plotW * k) / 4 - 8, H - 6);
  }
};

function hexA(hex, a) {
  const m = hex.replace('#', '');
  return `rgba(${parseInt(m.slice(0,2),16)},${parseInt(m.slice(2,4),16)},${parseInt(m.slice(4,6),16)},${a})`;
}

// ---------- AI / GPT 协作接口 ----------
P.summaryText = function () {
  const s = this._summary || routeSummary(this.track);
  return [
    'Horizon V3 Route Summary',
    `total: ${s.totalKm.toFixed(2)} km (${s.totalM.toFixed(0)} m)`,
    `est lap: ${s.lapMin.toFixed(1)} min @${THRESHOLDS.avgSpeedKmh}km/h`,
    `controlPoints: ${s.cpCount}  segments: ${s.segCount}  VPs: ${s.vpCount}/8 [${s.vps.join(',')}]`,
    `height: max ${s.maxY.toFixed(0)} / min ${s.minY.toFixed(0)} / drop ${s.dHeight.toFixed(0)} m`,
    `grade: maxUp ${s.maxUp.toFixed(1)}% maxDown ${s.maxDown.toFixed(1)}%`,
    `closed: ${s.closed}  selfIntersect: ${s.selfIntersect}  startCrowd: ${s.startCrowd}  tooSteep: ${s.tooSteep}  heroTooShort: ${s.heroTooShort}`,
  ].join('\n');
};

P.validationText = function () {
  const v = this._validation || validateRoute(this.track);
  const lines = [`Horizon V3 Route Validation  errors=${v.counts.error} warns=${v.counts.warn} ok=${v.counts.ok} pass=${v.pass}`];
  for (const it of v.items) lines.push(`[${it.level}][${it.scope}] ${it.title} :: ${it.detail}`);
  return lines.join('\n');
};

P.profileCsv = function () {
  const prof = this._profile || buildProfile(this.track, 8);
  const rows = ['s_m,elevation_m,grade_pct,segment,tags'];
  for (const p of prof.points) rows.push(`${p.s.toFixed(1)},${p.y.toFixed(2)},${p.grade.toFixed(2)},${p.segName},${(p.tags||[]).join('|')}`);
  return rows.join('\n');
};

P.copyToClipboard = function (text, label) {
  this.ioEl.value = text;
  this.ioEl.select();
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  this._status((label || '已复制') + '（同时写入下方文本框）');
};

// Import Patch / Revision：浅合并控制点（按 id 覆盖 pos/roadWidth/bankDeg/tags/vpAnchor）。
P.importPatch = function () {
  try {
    const patch = JSON.parse(this.ioEl.value);
    const list = Array.isArray(patch) ? patch : (patch.controlPoints || []);
    if (!list.length) throw new Error('patch 无 controlPoints');
    const byId = {}; this.track.controlPoints.forEach((c) => { byId[c.id] = c; });
    let applied = 0;
    for (const p of list) {
      const cp = byId[p.id]; if (!cp) continue;
      if (p.pos) Object.assign(cp.pos, p.pos);
      ['roadWidth', 'bankDeg', 'vpAnchor'].forEach((k) => { if (p[k] !== undefined) cp[k] = p[k]; });
      if (Array.isArray(p.tags)) cp.tags = p.tags.slice();
      applied++;
    }
    this.selected = -1; this._syncCpEdit(); this.refreshPanels(); this.draw();
    this._status(`Patch 已应用：${applied} 个控制点更新`);
  } catch (err) { this._status('Patch 失败：' + err.message); }
};
