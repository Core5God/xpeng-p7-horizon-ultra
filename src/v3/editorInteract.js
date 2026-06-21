// Horizon V3 — editor part 2: draw + interaction + IO (PR1)
// task-20260621-V3-PR1
// 以原型扩展方式补全 TrackEditor（拆分以控制单文件行数 ≤300）。

import { TrackEditor } from './editor.js';
import { makeControlPoint, normalizeTrack, serializeTrack, ALL_TAGS } from './trackSchema.js';
import {
  sampleClosedSpline, detectSelfIntersections, checkClosure, arcLengths,
} from './trackSpline.js';

const P = TrackEditor.prototype;

// 命中测试：返回控制点 index 或 -1
P.hitTest = function (sx, sy) {
  const R = 9;
  for (let i = this.track.controlPoints.length - 1; i >= 0; i--) {
    const s = this.worldToScreen(this.track.controlPoints[i].pos.x, this.track.controlPoints[i].pos.z);
    if (Math.hypot(s.x - sx, s.y - sy) <= R) return i;
  }
  return -1;
};

P._bind = function () {
  const cv = this.canvas;
  window.addEventListener('resize', () => { this.resize(); this.draw(); });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('mousedown', (e) => {
    const r = cv.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (e.button === 2) { this.panning = true; this.panStart = { sx, sy, ox: this.view.ox, oz: this.view.oz }; return; }
    const hit = this.hitTest(sx, sy);
    if (hit >= 0) { this.selected = hit; this.dragging = hit; this._syncCpEdit(); this.draw(); return; }
    // 空白处加点
    const w = this.screenToWorld(sx, sy);
    const cp = makeControlPoint(Math.round(w.x), 0, Math.round(w.z));
    this.track.controlPoints.push(cp);
    this.selected = this.track.controlPoints.length - 1;
    this._syncCpEdit();
    this.draw();
  });
  cv.addEventListener('mousemove', (e) => {
    const r = cv.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (this.panning && this.panStart) {
      this.view.ox = this.panStart.ox - (sx - this.panStart.sx) / this.view.scale;
      this.view.oz = this.panStart.oz - (sy - this.panStart.sy) / this.view.scale;
      this.draw(); return;
    }
    if (this.dragging >= 0) {
      const w = this.screenToWorld(sx, sy);
      this.track.controlPoints[this.dragging].pos.x = Math.round(w.x);
      this.track.controlPoints[this.dragging].pos.z = Math.round(w.z);
      this.draw();
    }
  });
  window.addEventListener('mouseup', () => { this.dragging = -1; this.panning = false; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.12 : 0.89;
    this.view.scale = Math.max(0.01, Math.min(2, this.view.scale * f));
    this.draw();
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selected >= 0 && document.activeElement === document.body) {
        this.track.controlPoints.splice(this.selected, 1);
        this.selected = -1; this._syncCpEdit(); this.draw();
      }
    }
  });

  // 面板按钮
  this.panel.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act) this._onAction(act);
    const tag = e.target.dataset && e.target.dataset.tag;
    if (tag) this._toggleTag(tag);
  });
  // CP 编辑控件
  const bind = (id, key, span, factor = 1) => {
    const el = this.panel.querySelector('#' + id);
    el.addEventListener('input', () => {
      if (this.selected < 0) return;
      const cp = this.track.controlPoints[this.selected];
      const v = parseFloat(el.value);
      if (key === 'y') cp.pos.y = v;
      else cp[key] = v;
      if (span) this.panel.querySelector('#' + span).textContent = v.toFixed(1);
      this.draw();
    });
  };
  bind('v3e-y', 'y', 'v3e-yv');
  bind('v3e-w', 'roadWidth', 'v3e-wv');
  bind('v3e-bank', 'bankDeg', 'v3e-bankv');
  this.panel.querySelector('#v3e-vp').addEventListener('change', (e) => {
    if (this.selected < 0) return;
    this.track.controlPoints[this.selected].vpAnchor = e.target.value || null;
    this.draw();
  });
};

P._toggleTag = function (tag) {
  if (this.selected < 0) return;
  const cp = this.track.controlPoints[this.selected];
  const i = cp.tags.indexOf(tag);
  if (i >= 0) cp.tags.splice(i, 1); else cp.tags.push(tag);
  this._syncCpEdit(); this.draw();
};

P._syncCpEdit = function () {
  if (this.selected < 0) { this.cpEdit.style.display = 'none'; return; }
  const cp = this.track.controlPoints[this.selected];
  this.cpEdit.style.display = 'block';
  const set = (id, v) => { this.panel.querySelector('#' + id).value = v; };
  const setS = (id, v) => { this.panel.querySelector('#' + id).textContent = v; };
  set('v3e-y', cp.pos.y); setS('v3e-yv', cp.pos.y.toFixed(1));
  set('v3e-w', cp.roadWidth); setS('v3e-wv', cp.roadWidth.toFixed(1));
  set('v3e-bank', cp.bankDeg); setS('v3e-bankv', cp.bankDeg.toFixed(1));
  set('v3e-vp', cp.vpAnchor || '');
  this.panel.querySelectorAll('.v3e-tag').forEach((b) => {
    b.classList.toggle('on', cp.tags.includes(b.dataset.tag));
  });
};

P._onAction = function (act) {
  if (act === 'newtrack') {
    if (!confirm('清空当前赛道？')) return;
    this.track.controlPoints = []; this.selected = -1; this._syncCpEdit(); this.draw();
  } else if (act === 'loaddefault') {
    this._loadDefault();
  } else if (act === 'export') {
    this.ioEl.value = serializeTrack(this.track);
    this.ioEl.select();
    this._status('已导出到下方文本框，可复制保存为 track.main.json');
  } else if (act === 'import') {
    try {
      const obj = JSON.parse(this.ioEl.value);
      this.track = normalizeTrack(obj);
      this.selected = -1; this._syncCpEdit(); this.fitToTrack(); this.draw();
      this._status('导入成功：' + this.track.controlPoints.length + ' 个控制点');
    } catch (err) { this._status('导入失败：' + err.message); }
  }
};

P._loadDefault = async function () {
  try {
    const res = await fetch('./track.main.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    this.track = normalizeTrack(await res.json());
    this.selected = -1; this._syncCpEdit(); this.fitToTrack(); this.draw();
    this._status('已载入 track.main.json：' + this.track.controlPoints.length + ' 个控制点');
  } catch (err) { this._status('载入 track.main.json 失败：' + err.message); }
};

P._status = function (msg) {
  if (this.statusEl) this.statusEl.textContent = msg;
};
