// V3-DASH | Horizon V3 Project Cockpit (status page)
// Single source of truth: public/status/horizon-v3-status.json
// This module only fetches and renders the JSON. It hardcodes NO progress content.

const STATUS_URL = './status/horizon-v3-status.json';

const CSS = `
:root{--dash-bg:#0b0e14;--dash-panel:#141923;--dash-panel2:#1b212d;
--dash-line:rgba(255,255,255,.08);--dash-txt:#e8edf6;--dash-sub:#97a3b6;
--dash-accent:#5b9dff;--dash-ok:#37d399;--dash-warn:#ffb454;--dash-hold:#ff6b6b;
--dash-gray:#6b7689;}
*{box-sizing:border-box}
html,body{margin:0;padding:0;overflow:auto !important;background:var(--dash-bg);
font-family:'Rajdhani','Noto Sans SC','PingFang SC',system-ui,sans-serif;color:var(--dash-txt)}
#v3dash{min-height:100vh;padding:24px clamp(14px,4vw,48px) 64px;max-width:1180px;margin:0 auto}
.dh-top{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between;margin-bottom:22px}
.dh-title{font-size:clamp(22px,3.2vw,34px);font-weight:700;letter-spacing:.5px;line-height:1.1}
.dh-sub{color:var(--dash-sub);font-size:14px;margin-top:6px}
.dh-gate{font-size:13px;color:var(--dash-sub)}
.dh-gate b{color:var(--dash-accent);font-size:16px}
.dh-prog{min-width:240px;flex:1}
.dh-prog .bar{height:14px;border-radius:9px;background:var(--dash-panel2);overflow:hidden;border:1px solid var(--dash-line)}
.dh-prog .fill{height:100%;background:linear-gradient(90deg,#3a6dff,#5b9dff);border-radius:9px;transition:width .5s}
.dh-prog .lbl{display:flex;justify-content:space-between;font-size:13px;color:var(--dash-sub);margin-bottom:6px}
.dh-prog .lbl b{color:var(--dash-txt);font-size:20px}
.grid{display:grid;gap:16px}
.cols2{grid-template-columns:1fr 1fr}
.cols3{grid-template-columns:repeat(3,1fr)}
@media(max-width:880px){.cols2,.cols3{grid-template-columns:1fr}}
.card{background:var(--dash-panel);border:1px solid var(--dash-line);border-radius:16px;padding:18px 18px 16px}
.card h2{margin:0 0 12px;font-size:15px;letter-spacing:.6px;text-transform:uppercase;color:var(--dash-sub);font-weight:700}
.envbox{display:flex;flex-direction:column;gap:6px;font-size:14px}
.envbox .row{display:flex;justify-content:space-between;gap:10px}
.envbox .k{color:var(--dash-sub)}
.envbox .v{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dash-txt)}
.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
.pill.ok{background:rgba(55,211,153,.14);color:var(--dash-ok)}
.pill.bad{background:rgba(255,107,107,.14);color:var(--dash-hold)}
.stages{display:flex;flex-direction:column;gap:8px}
.stage{display:grid;grid-template-columns:96px 1fr auto;gap:12px;align-items:center;
padding:10px 12px;background:var(--dash-panel2);border:1px solid var(--dash-line);border-radius:12px}
.stage .id{font-weight:700;font-size:13px;color:var(--dash-txt);font-family:ui-monospace,monospace}
.stage .nm{font-size:14px}
.stage .nm small{display:block;color:var(--dash-sub);font-size:12px;margin-top:2px}
.stage .nm small.next::before{content:'\\2192 next: ';color:var(--dash-accent)}
.stage .meta{text-align:right;min-width:120px}
.stage .sbar{height:6px;width:110px;border-radius:4px;background:#0d1119;overflow:hidden;margin-top:6px;margin-left:auto}
.stage .sfill{height:100%;border-radius:4px}
.st-tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;white-space:nowrap}
.st-review,.st-submitted{background:rgba(91,157,255,.16);color:var(--dash-accent)}
.st-preparing{background:rgba(255,180,84,.16);color:var(--dash-warn)}
.st-hold{background:rgba(255,107,107,.16);color:var(--dash-hold)}
.st-notstarted{background:rgba(107,118,137,.16);color:var(--dash-gray)}
.plan ol{margin:0;padding-left:20px}
.plan li{margin:0 0 8px;font-size:14px;line-height:1.45}
.blk ul{margin:0;padding-left:0;list-style:none}
.blk li{padding-left:26px;position:relative;color:#ffd7d7;margin:0 0 8px;font-size:14px;line-height:1.45}
.blk li::before{content:'\\26d4';position:absolute;left:0;top:0}
.links{display:flex;flex-wrap:wrap;gap:10px}
.linkbtn{display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:11px;
background:var(--dash-panel2);border:1px solid var(--dash-line);color:var(--dash-txt);
text-decoration:none;font-size:13px;font-weight:600;transition:all .15s}
.linkbtn:hover{border-color:var(--dash-accent);transform:translateY(-1px);background:#222a38}
.linkbtn.prod{border-color:rgba(255,180,84,.4)}
.daily .dl{padding:10px 12px;background:var(--dash-panel2);border-radius:10px;border:1px solid var(--dash-line);margin-bottom:8px}
.daily .dl .d{font-weight:700;color:var(--dash-accent);font-size:13px;font-family:ui-monospace,monospace}
.daily .dl .s{font-size:14px;color:var(--dash-txt);margin-top:4px;line-height:1.45}
.foot{margin-top:26px;color:var(--dash-sub);font-size:12px;text-align:center;line-height:1.6}
.foot a{color:var(--dash-accent)}
.dh-err{padding:40px;text-align:center;color:var(--dash-hold);font-size:16px}
`;

function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

// 英文阶段状态 → 中文展示（兜底映射表；JSON *Zh 字段优先）
const STATUS_ZH = {
  'not started': '未开始',
  'preparing': '准备中',
  'doing': '进行中',
  'submitted for review': '已提交待验收',
  'review': '待评审',
  'passed': '已通过',
  'hold': '暂停 / HOLD',
  'blocked': '阻塞',
  'failed': '未通过',
  'cleanup': '整改中'
};
function statusZh(s){
  const k = String(s||'').trim().toLowerCase();
  if (STATUS_ZH[k]) return STATUS_ZH[k];
  if (k.indexOf('hold') >= 0) return '暂停 / HOLD';
  if (k.indexOf('submit') >= 0) return '已提交待验收';
  if (k.indexOf('review') >= 0) return '待评审';
  if (k.indexOf('prepar') >= 0) return '准备中';
  if (k.indexOf('not start') >= 0) return '未开始';
  return s || '';
}

export function launchStatus() {
  Array.prototype.forEach.call(document.body.children, (el) => { el.style.display = 'none'; });
  document.documentElement.classList.add('v3-dash-active');
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'v3dash';
  root.innerHTML = '<div class="dh-err">正在加载 V3 项目驾驶舱\u2026</div>';
  document.body.appendChild(root);
  document.title = 'Horizon V3 \u00b7 项目驾驶舱';
  fetch(STATUS_URL, { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((data) => render(root, data))
    .catch((err) => {
      root.innerHTML = '<div class="dh-err">状态 JSON 加载失败。<br>' +
        esc(err && err.message || err) + '</div>';
    });
}

function statusClass(s){
  const k = String(s||'').toLowerCase();
  if (k.indexOf('hold') >= 0) return 'st-hold';
  if (k.indexOf('submit') >= 0) return 'st-submitted';
  if (k.indexOf('review') >= 0) return 'st-review';
  if (k.indexOf('prepar') >= 0) return 'st-preparing';
  return 'st-notstarted';
}

function barColor(p){
  if (p >= 80) return '#37d399';
  if (p >= 40) return '#5b9dff';
  if (p > 0) return '#ffb454';
  return '#3a4252';
}

function envBlock(title, safe, project, branch, commit, url, branchOk, safeZh){
  const safePill = safe
    ? '<span class="pill ok">\u2714 安全</span>'
    : '<span class="pill bad">\u2716 有风险</span>';
  const safeLine = safeZh
    ? '<div class="row"><span class="k">安全状态</span><span class="v">' + esc(safeZh) + '</span></div>'
    : '';
  return '<div class="card"><h2>' + esc(title) + ' ' + safePill + '</h2>' +
    '<div class="envbox">' +
    safeLine +
    row('项目', esc(project)) +
    row('分支', esc(branch) + (branchOk === undefined ? '' :
      (branchOk ? ' <span class="pill ok">on v3-main</span>' : ' <span class="pill bad">off-branch</span>'))) +
    row('Commit', esc(commit)) +
    '<div class="row"><span class="k">URL</span><a class="v" style="color:var(--dash-accent)" href="' +
      esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a></div>' +
    '</div></div>';
}

function row(k, vHtml){
  return '<div class="row"><span class="k">' + esc(k) + '</span><span class="v">' + vHtml + '</span></div>';
}

function listOrdered(arr){
  return '<ol>' + (arr||[]).map((t)=>'<li>' + esc(t) + '</li>').join('') + '</ol>';
}

function linkBtn(label, href, cls){
  if (!href) return '';
  return '<a class="linkbtn ' + (cls||'') + '" href="' + esc(href) +
    '" target="_blank" rel="noopener">' + esc(label) + '</a>';
}

function render(root, d){
  const stages = Array.isArray(d.stages) ? d.stages : [];
  const pr15 = stages.find((s)=>String(s.id).indexOf('1.5') >= 0);
  const pr15Hold = pr15 && String(pr15.status||'').toLowerCase().indexOf('hold') >= 0;
  const links = d.reviewLinks || {};
  const v3OnBranch = String(d.v3Branch||'') === 'v3-main';

  const stagesHtml = stages.map((s)=>{
    const p = Number(s.progress)||0;
    const nm = s.nameZh || s.name;
    const nx = s.nextZh || s.next;
    const nextHtml = nx ? '<small class="next">' + esc(nx) + '</small>' : '';
    return '<div class="stage">' +
      '<span class="id">' + esc(s.id) + '</span>' +
      '<span class="nm">' + esc(nm) + nextHtml + '</span>' +
      '<span class="meta">' +
        '<span class="st-tag ' + statusClass(s.status) + '">' + esc(statusZh(s.status)) + '</span>' +
        '<div class="sbar"><div class="sfill" style="width:' + p + '%;background:' + barColor(p) + '"></div></div>' +
        '<div style="font-size:12px;color:var(--dash-sub);margin-top:3px">' + p + '%</div>' +
      '</span>' +
    '</div>';
  }).join('');

  const linksHtml =
    linkBtn('V3 路线编辑器', links.v3Editor) +
    linkBtn('V3 灰模驾驶', links.v3Greybox) +
    linkBtn('VP0 全环俯视', links.vp0) +
    linkBtn('VP1 起点基地', links.vp1) +
    linkBtn('VP5 山顶俯瞰', links.vp5) +
    linkBtn('状态 JSON', links.statusJson) +
    linkBtn('V2 生产站', links.v2Production, 'prod');

  const dailyHtml = (d.dailyLog||[]).map((l)=>
    '<div class="dl"><div class="d">' + esc(l.date) + '</div><div class="s">' + esc(l.summaryZh || l.summary) + '</div></div>'
  ).join('');

  const overall = Number(d.overallProgress)||0;

  root.innerHTML =
    '<div class="dh-top">' +
      '<div>' +
        '<div class="dh-title">' + esc(d.projectNameZh || d.projectName) + '</div>' +
        '<div class="dh-sub">当前状态：' + esc(d.currentStatusZh || statusZh(d.currentStatus)) + '</div>' +
        '<div class="dh-gate" style="margin-top:8px">当前阶段：<b>' + esc(d.currentGateZh || d.currentGate) + '</b>' +
          (pr15Hold ? ' &nbsp;\u00b7&nbsp; <span class="pill bad">PR1.5 HOLD</span>' :
            ' &nbsp;\u00b7&nbsp; <span class="pill ok">PR1.5 已释放</span>') + '</div>' +
      '</div>' +
      '<div class="dh-prog">' +
        '<div class="lbl"><span>项目总进度</span><b>' + overall + '%</b></div>' +
        '<div class="bar"><div class="fill" style="width:' + overall + '%"></div></div>' +
      '</div>' +
    '</div>' +

    '<div class="grid cols2" style="margin-bottom:16px">' +
      envBlock('V2 生产环境', d.v2Safe, d.v2Project, d.v2Branch, d.v2Commit, d.v2Url, undefined, d.v2SafeZh) +
      envBlock('V3 重做环境', d.v3Safe, d.v3Project, d.v3Branch, d.v3Commit, d.v3Url, v3OnBranch, d.v3SafeZh) +
    '</div>' +

    '<div class="card" style="margin-bottom:16px"><h2>阶段进度 \u00b7 12 个 PR 门禁</h2>' +
      '<div class="stages">' + stagesHtml + '</div></div>' +

    '<div class="grid cols2" style="margin-bottom:16px">' +
      '<div class="card plan"><h2>今日计划</h2>' + listOrdered(d.todayPlanZh || d.todayPlan) + '</div>' +
      '<div class="card plan"><h2>明日计划</h2>' + listOrdered(d.tomorrowPlanZh || d.tomorrowPlan) + '</div>' +
    '</div>' +

    '<div class="card blk" style="margin-bottom:16px"><h2>当前禁止事项</h2>' +
      '<ul>' + ((d.blockedItemsZh || d.blockedItems)||[]).map((t)=>'<li>' + esc(t) + '</li>').join('') + '</ul></div>' +

    '<div class="card" style="margin-bottom:16px"><h2>验收入口</h2>' +
      '<div class="links">' + linksHtml + '</div></div>' +

    '<div class="card daily"><h2>每日记录</h2>' + dailyHtml + '</div>' +

    '<div class="foot">唯一真实进度源：<a href="' + esc(links.statusJson || STATUS_URL) +
      '" target="_blank" rel="noopener">horizon-v3-status.json</a> \u00b7 ' +
      '本驾驶舱仅渲染 JSON。V2 已隔离，未受影响。</div>';
}
