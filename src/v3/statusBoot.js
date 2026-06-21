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

export function launchStatus() {
  Array.prototype.forEach.call(document.body.children, (el) => { el.style.display = 'none'; });
  document.documentElement.classList.add('v3-dash-active');
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'v3dash';
  root.innerHTML = '<div class="dh-err">Loading V3 cockpit\u2026</div>';
  document.body.appendChild(root);
  document.title = 'Horizon V3 \u00b7 Project Cockpit';
  fetch(STATUS_URL, { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((data) => render(root, data))
    .catch((err) => {
      root.innerHTML = '<div class="dh-err">Failed to load status JSON.<br>' +
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

function envBlock(title, safe, project, branch, commit, url, branchOk){
  const safePill = safe
    ? '<span class="pill ok">\u2714 SAFE</span>'
    : '<span class="pill bad">\u2716 AT RISK</span>';
  return '<div class="card"><h2>' + esc(title) + ' ' + safePill + '</h2>' +
    '<div class="envbox">' +
    row('Project', esc(project)) +
    row('Branch', esc(branch) + (branchOk === undefined ? '' :
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
    const nextHtml = s.next ? '<small class="next">' + esc(s.next) + '</small>' : '';
    return '<div class="stage">' +
      '<span class="id">' + esc(s.id) + '</span>' +
      '<span class="nm">' + esc(s.name) + nextHtml + '</span>' +
      '<span class="meta">' +
        '<span class="st-tag ' + statusClass(s.status) + '">' + esc(s.status) + '</span>' +
        '<div class="sbar"><div class="sfill" style="width:' + p + '%;background:' + barColor(p) + '"></div></div>' +
        '<div style="font-size:12px;color:var(--dash-sub);margin-top:3px">' + p + '%</div>' +
      '</span>' +
    '</div>';
  }).join('');

  const linksHtml =
    linkBtn('V3 Track Editor', links.v3Editor) +
    linkBtn('V3 Greybox Loop', links.v3Greybox) +
    linkBtn('Viewpoint 0', links.vp0) +
    linkBtn('Viewpoint 1', links.vp1) +
    linkBtn('Viewpoint 5', links.vp5) +
    linkBtn('Status JSON', links.statusJson) +
    linkBtn('V2 Production', links.v2Production, 'prod');

  const dailyHtml = (d.dailyLog||[]).map((l)=>
    '<div class="dl"><div class="d">' + esc(l.date) + '</div><div class="s">' + esc(l.summary) + '</div></div>'
  ).join('');

  const overall = Number(d.overallProgress)||0;

  root.innerHTML =
    '<div class="dh-top">' +
      '<div>' +
        '<div class="dh-title">' + esc(d.projectName) + '</div>' +
        '<div class="dh-sub">' + esc(d.currentStatus) + '</div>' +
        '<div class="dh-gate" style="margin-top:8px">Current Gate: <b>' + esc(d.currentGate) + '</b>' +
          (pr15Hold ? ' &nbsp;\u00b7&nbsp; <span class="pill bad">PR1.5 HOLD</span>' :
            ' &nbsp;\u00b7&nbsp; <span class="pill ok">PR1.5 released</span>') + '</div>' +
      '</div>' +
      '<div class="dh-prog">' +
        '<div class="lbl"><span>Overall Progress</span><b>' + overall + '%</b></div>' +
        '<div class="bar"><div class="fill" style="width:' + overall + '%"></div></div>' +
      '</div>' +
    '</div>' +

    '<div class="grid cols2" style="margin-bottom:16px">' +
      envBlock('V2 Production', d.v2Safe, d.v2Project, d.v2Branch, d.v2Commit, d.v2Url) +
      envBlock('V3 Rebuild', d.v3Safe, d.v3Project, d.v3Branch, d.v3Commit, d.v3Url, v3OnBranch) +
    '</div>' +

    '<div class="card" style="margin-bottom:16px"><h2>Stages \u00b7 12 PR Gates</h2>' +
      '<div class="stages">' + stagesHtml + '</div></div>' +

    '<div class="grid cols2" style="margin-bottom:16px">' +
      '<div class="card plan"><h2>Today Plan</h2>' + listOrdered(d.todayPlan) + '</div>' +
      '<div class="card plan"><h2>Tomorrow Plan</h2>' + listOrdered(d.tomorrowPlan) + '</div>' +
    '</div>' +

    '<div class="card blk" style="margin-bottom:16px"><h2>Blocked \u00b7 Do Not Touch</h2>' +
      '<ul>' + (d.blockedItems||[]).map((t)=>'<li>' + esc(t) + '</li>').join('') + '</ul></div>' +

    '<div class="card" style="margin-bottom:16px"><h2>Review Links</h2>' +
      '<div class="links">' + linksHtml + '</div></div>' +

    '<div class="card daily"><h2>Daily Log</h2>' + dailyHtml + '</div>' +

    '<div class="foot">Single source of truth: <a href="' + esc(links.statusJson || STATUS_URL) +
      '" target="_blank" rel="noopener">horizon-v3-status.json</a> \u00b7 ' +
      'This cockpit only renders the JSON. V2 is isolated and untouched.</div>';
}
