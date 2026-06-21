// Horizon V3 — Browser track editor (?edit=1) PR1
// task-20260621-V3-PR1
//
// 俯视 2D 编辑器（Canvas 2D，不依赖 three）：
//   - 点放 / 拖动 / 删除控制点
//   - 每点设高度(y) / 道路宽度 / banking
//   - 打标签（landmark/VP 锚点 + 6 个物理标签）
//   - 实时平滑闭合样条预览（Catmull-Rom）
//   - 闭环校验 + 自交叉检测（标红提示）
//   - 导入/导出 Track JSON
//
// 仅负责编辑器交互与 JSON I/O；Track-to-World 在 trackToWorld.js。

import {
  emptyTrack, makeControlPoint, normalizeTrack, serializeTrack,
  validateTrack, ALL_TAGS, PHYSICS_TAGS, LANDMARK_TAGS,
} from './trackSchema.js';
import {
  sampleClosedSpline, resampleByArc, detectSelfIntersections, checkClosure, arcLengths,
} from './trackSpline.js';

export class TrackEditor {
  constructor(container) {
    this.container = container;
    this.track = emptyTrack('Core5God');
    this.view = { ox: 0, oz: 0, scale: 0.12 }; // world→screen: px = (world - o)*scale + center
    this.selected = -1;
    this.dragging = -1;
    this.mode = 'move'; // PR1.0.1 编辑模式: draw|move|height|tag|vp|validate
    this.panning = false;
    this.panStart = null;
    this._build();
    this._bind();
    this.resize();
    this.draw();
  }

  // ---------- DOM ----------
  _build() {
    const root = document.createElement('div');
    root.id = 'v3edit-root';
    root.innerHTML = `
      <canvas id="v3edit-canvas"></canvas>
      <div id="v3p-topbar">
        <div class="v3p-title">路线概览 Route Summary · 山海闭合环线</div>
        <div id="v3p-summary"></div>
      </div>
      <div id="v3edit-guide">
        <div class="v3g-title">✨ 上手步骤</div>
        <ol>
          <li>① 点「载入初始环线」加载起始赛道</li>
          <li>② 拖动控制点调整走向（选中点会高亮）</li>
          <li>③ 在右侧面板改高度/路宽/标签</li>
          <li>④ 点「Validate」检查闭环与总长</li>
          <li>⑤ 点「导出 JSON」保存 / 进入灰模驾驶(?v3=1)</li>
        </ol>
        <button id="v3g-close">知道了，隐藏</button>
      </div>
      <div id="v3edit-panel">
        <div class="v3e-title">V3 赛道编辑器 · 灰模阶段</div>
        <div class="v3e-sub">文件</div>
        <div class="v3e-row">
          <button data-act="newtrack">新建</button>
          <button data-act="loaddefault">载入初始环线</button>
          <button data-act="import">导入 JSON</button>
          <button data-act="export">导出 JSON</button>
          <button data-act="fit">对齐视野</button>
        </div>
        <div class="v3e-sub">编辑模式</div>
        <div id="v3e-modes" class="v3e-row">
          <button data-mode="draw" class="v3e-mode">加点</button>
          <button data-mode="move" class="v3e-mode">移动</button>
          <button data-mode="height" class="v3e-mode">高度</button>
          <button data-mode="tag" class="v3e-mode">标签</button>
          <button data-mode="vp" class="v3e-mode">VP 机位</button>
          <button data-mode="validate" class="v3e-mode">校验</button>
        </div>
        <div class="v3e-hint">选中点会高亮(放大+黄圈) · 拖动点=移动 · 选中按 Del=删除 · 右键拖=平移 · 滚轮=缩放</div>
        <div id="v3e-status" class="v3e-status"></div>
        <div id="v3e-export-summary" class="v3e-export" style="display:none"></div>
        <div id="v3e-cpedit" class="v3e-cpedit" style="display:none">
          <div class="v3e-sub">选中控制点详情</div>
          <div id="v3e-cpinfo" class="v3e-cpinfo"></div>
          <label>高度 y <input type="range" id="v3e-y" min="-200" max="600" step="1"><span id="v3e-yv"></span></label>
          <label>路宽 roadWidth <input type="range" id="v3e-w" min="4" max="40" step="0.5"><span id="v3e-wv"></span></label>
          <label>倾斜 bankDeg <input type="range" id="v3e-bank" min="-25" max="25" step="0.5"><span id="v3e-bankv"></span></label>
          <label>VP锚点
            <select id="v3e-vp"><option value="">无</option><option>VP1</option><option>VP2</option><option>VP3</option><option>VP4</option><option>VP5</option><option>VP6</option><option>VP7</option><option>VP8</option></select>
          </label>
          <div class="v3e-sub">地标标签</div>
          <div id="v3e-landmarks" class="v3e-tags"></div>
          <div class="v3e-sub">物理标签（本棒只存）</div>
          <div id="v3e-physics" class="v3e-tags"></div>
        </div>
        <textarea id="v3e-io" placeholder="导入：粘贴 Track JSON / Patch 后点对应按钮&#10;导出：点 Copy 类按钮后从此复制"></textarea>
        <details class="v3e-grp" open><summary>高度剖面（距离×海拔）</summary>
          <canvas id="v3p-profile"></canvas>
        </details>
        <details class="v3e-grp" open><summary>Segment 路线节奏（点击定位视图）</summary>
          <div class="v3p-seghd"><span>名称</span><span>HeroZone/VP</span><span>长度·坎度</span></div>
          <div id="v3p-seglist" class="v3p-seglist"></div>
        </details>
        <details class="v3e-grp" open><summary>路线校验 Route Validation</summary>
          <div id="v3p-validation" class="v3p-validation"></div>
        </details>
        <details class="v3e-grp"><summary>复制·导入·导出（贴给 GPT）</summary>
          <div class="v3e-sub">复制（中文优先）</div>
          <div class="v3e-row">
            <button data-act="copysummaryzh">复制路线概览（中文）</button>
            <button data-act="copyvalidationzh">复制校验报告（中文）</button>
          </div>
          <div class="v3e-row">
            <button data-act="copytrack">复制 Track JSON</button>
            <button data-act="copysummary">复制概览（EN）</button>
            <button data-act="copyvalidation">复制校验（EN）</button>
          </div>
          <div class="v3e-sub">导入 / 导出数据</div>
          <div class="v3e-row">
            <button data-act="importrevised">导入修订 JSON</button>
            <button data-act="importpatch">导入 Patch</button>
            <button data-act="exportprofile">导出剖面数据 CSV</button>
          </div>
        </details>
      </div>`;
    this.container.appendChild(root);
    this.canvas = root.querySelector('#v3edit-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.panel = root.querySelector('#v3edit-panel');
    this.statusEl = root.querySelector('#v3e-status');
    this.cpEdit = root.querySelector('#v3e-cpedit');
    this.ioEl = root.querySelector('#v3e-io');
    this._injectStyle();
    this._buildTagButtons();
  }

  _injectStyle() {
    if (document.getElementById('v3edit-style')) return;
    const st = document.createElement('style');
    st.id = 'v3edit-style';
    st.textContent = `
      #v3edit-root{position:fixed;inset:0;background:#0e1116;font-family:'Noto Sans SC',sans-serif;z-index:9999}
      #v3edit-canvas{position:absolute;inset:0;display:block;cursor:crosshair}
      #v3edit-panel{position:absolute;top:0;right:0;width:300px;height:100%;overflow-y:auto;
        background:rgba(16,20,28,.92);color:#dfe6f0;padding:14px;box-sizing:border-box;font-size:13px}      .v3e-title{font-weight:700;font-size:15px;margin-bottom:10px;color:#8fd0ff}
      .v3e-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
      #v3edit-panel button{background:#1d2735;color:#cfe;border:1px solid #2f3e52;border-radius:8px;
        padding:6px 10px;cursor:pointer;font-size:12px}
      #v3edit-panel button:hover{background:#26384d}
      .v3e-hint{font-size:11px;color:#7e8aa0;line-height:1.5;margin-bottom:8px}
      .v3e-status{font-size:12px;line-height:1.6;margin-bottom:8px;white-space:pre-wrap}
      .v3e-sub{font-weight:600;margin:8px 0 4px;color:#9fb0c8}
      .v3e-grp{margin:8px 0;border:1px solid #1d2735;border-radius:8px;background:rgba(10,14,20,.4);overflow:hidden}
      .v3e-grp>summary{cursor:pointer;list-style:none;padding:7px 10px;font-weight:700;font-size:12px;
        color:#8fd0ff;background:#141b26;user-select:none}
      .v3e-grp>summary::-webkit-details-marker{display:none}
      .v3e-grp>summary::before{content:'▾ ';color:#5b7088}
      .v3e-grp[open]>summary{border-bottom:1px solid #1d2735}
      .v3e-grp>:not(summary){margin:8px 10px}
      .v3p-seghd{display:flex;gap:5px;padding:3px 8px;margin:6px 10px 0!important;font-size:10px;
        color:#7e8aa0;border-bottom:1px solid #1d2735}
      .v3p-seghd span:last-child{margin-left:auto}
      .v3e-cpedit label{display:flex;align-items:center;gap:6px;font-size:12px;margin:4px 0}
      .v3e-cpedit input[type=range]{flex:1}
      .v3e-tags{display:flex;flex-wrap:wrap;gap:4px}
      .v3e-tag{padding:3px 7px;border-radius:6px;border:1px solid #2f3e52;background:#161d28;
        cursor:pointer;font-size:11px;color:#9fb0c8}
      .v3e-tag.on{background:#2a6df4;color:#fff;border-color:#2a6df4}
      .v3e-tag.phys.on{background:#e0793a;border-color:#e0793a}
      #v3e-io{width:100%;height:120px;margin-top:8px;background:#0a0d12;color:#9fe;border:1px solid #243245;
        border-radius:8px;font-family:monospace;font-size:10px;box-sizing:border-box}
      #v3edit-guide{position:absolute;left:14px;top:78px;width:280px;background:rgba(16,22,32,.94);
        color:#dfe6f0;border:1px solid #2a4664;border-radius:10px;padding:12px 14px;z-index:10000;font-size:12px}
      .v3g-title{font-weight:700;color:#7affc0;margin-bottom:6px}
      #v3edit-guide ol{margin:0 0 8px;padding-left:18px;line-height:1.7;color:#cdd8e8}
      #v3edit-guide li{margin:2px 0}
      #v3g-close{background:#1d2735;color:#cfe;border:1px solid #2f3e52;border-radius:7px;
        padding:5px 10px;cursor:pointer;font-size:11px}
      .v3e-mode{position:relative}
      .v3e-mode.on{background:#2a6df4 !important;color:#fff !important;border-color:#2a6df4 !important}
      .v3e-cpinfo{font:11px/1.6 monospace;color:#9fe;background:#0a0d12;border:1px solid #243245;
        border-radius:6px;padding:6px 8px;margin:4px 0;white-space:pre-wrap}
      .v3e-export{font:11px/1.6 monospace;background:#10261b;border:1px solid #1f6b45;border-radius:8px;
        padding:8px 10px;margin-bottom:8px;color:#bfeede;white-space:pre-wrap}
      .v3e-export.bad{background:#2a1414;border-color:#7a2f2f;color:#ffc9c9}
      #v3p-topbar{position:absolute;top:0;left:0;right:300px;background:rgba(12,16,22,.96);
        border-bottom:1px solid #243245;color:#dfe6f0;padding:8px 14px;z-index:10001;box-sizing:border-box}
      #v3p-topbar .v3p-title{font-weight:700;font-size:13px;color:#7affc0;margin-bottom:6px}
      .v3p-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:4px 10px}
      .v3p-cell{display:flex;flex-direction:column;font-size:11px;line-height:1.3}
      .v3p-k{color:#8aa;font-size:10px}
      .v3p-v{color:#dfe6f0;font-weight:600;font-family:monospace}
      .v3p-ok{color:#7affc0}.v3p-bad{color:#ff8a8a}
      #v3p-profile{width:100%;height:150px;background:#0a0d12;border:1px solid #243245;border-radius:6px;display:block}
      .v3p-seglist{max-height:230px;overflow-y:auto;border:1px solid #1d2735;border-radius:6px}
      .v3p-seg{display:flex;align-items:center;gap:5px;padding:4px 6px;font-size:11px;cursor:pointer;border-bottom:1px solid #161d28}
      .v3p-seg:hover{background:#1a2433}
      .v3p-seg.warn{background:rgba(122,47,47,.25)}
      .v3p-dot{width:9px;height:9px;border-radius:50%;flex:none}
      .v3p-sname{font-weight:600;color:#cfe}.v3p-sname small{color:#7e8aa0;margin-left:3px;font-weight:400}
      .v3p-hero{background:#2a6df4;color:#fff;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:700}
      .v3p-vp{background:#e0b34d;color:#1a1a1a;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:700}
      .v3p-smeta{margin-left:auto;color:#9fb0c8;font-family:monospace;font-size:10px}
      .v3p-segw{color:#ffb14d;font-weight:700}
      .v3p-validation{font-size:11px}
      .v3p-vhead{padding:5px 8px;border-radius:6px;margin-bottom:6px;font-weight:600}
      .v3p-vhead.ok{background:#10261b;color:#bfeede}.v3p-vhead.bad{background:#2a1f14;color:#ffe0bf}
      .v3p-vrow{padding:4px 6px;border-left:3px solid #444;margin-bottom:3px;background:#0f1620;border-radius:0 4px 4px 0}
      .v3p-vrow small{color:#9fb0c8}
      .v3p-vrow.ok{border-color:#3aa06a}.v3p-vrow.warn{border-color:#e0a23a}.v3p-vrow.error{border-color:#e05a5a}
      .v3p-vic{font-weight:700}.v3p-vrow.ok .v3p-vic{color:#7affc0}.v3p-vrow.warn .v3p-vic{color:#ffb14d}.v3p-vrow.error .v3p-vic{color:#ff8a8a}
      .v3p-vscope{color:#8aa;font-size:10px}
      .v3p-empty,.v3p-bad{color:#7e8aa0;font-size:11px;padding:4px}
    `;
    document.head.appendChild(st);
  }

  _buildTagButtons() {
    const lm = this.panel.querySelector('#v3e-landmarks');
    const ph = this.panel.querySelector('#v3e-physics');
    LANDMARK_TAGS.forEach((t) => {
      const b = document.createElement('span');
      b.className = 'v3e-tag'; b.dataset.tag = t; b.textContent = t;
      lm.appendChild(b);
    });
    PHYSICS_TAGS.forEach((t) => {
      const b = document.createElement('span');
      b.className = 'v3e-tag phys'; b.dataset.tag = t; b.textContent = t;
      ph.appendChild(b);
    });
  }

  // ---------- coordinate transforms ----------
  worldToScreen(wx, wz) {
    const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
    return {
      x: (wx - this.view.ox) * this.view.scale + cx,
      y: (wz - this.view.oz) * this.view.scale + cy,
    };
  }
  screenToWorld(sx, sy) {
    const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
    return {
      x: (sx - cx) / this.view.scale + this.view.ox,
      z: (sy - cy) / this.view.scale + this.view.oz,
    };
  }

  resize() {
    this.canvas.width = window.innerWidth - 300;
    this.canvas.height = window.innerHeight;
  }

  // PR1.0.1 — 自动 fit 到环线包围盒（打开/载入后不再一片空旷）。
  fitToTrack(pad = 1.18) {
    const cps = this.track.controlPoints;
    if (!cps.length) { this.view = { ox: 0, oz: 0, scale: 0.12 }; return; }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const cp of cps) {
      minX = Math.min(minX, cp.pos.x); maxX = Math.max(maxX, cp.pos.x);
      minZ = Math.min(minZ, cp.pos.z); maxZ = Math.max(maxZ, cp.pos.z);
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const spanX = Math.max(1, (maxX - minX) * pad);
    const spanZ = Math.max(1, (maxZ - minZ) * pad);
    const sx = this.canvas.width / spanX;
    const sz = this.canvas.height / spanZ;
    this.view.scale = Math.max(0.01, Math.min(2, Math.min(sx, sz)));
    this.view.ox = cx; this.view.oz = cz;
  }
}
