// editor smoke test (PR1.0.2) — verify ?edit=1 boots, panels populate, no console errors.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const REPO = path.resolve('.');
const DIST = path.join(REPO, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    let fp = path.join(DIST, p);
    try { if ((await stat(fp)).isDirectory()) fp = path.join(fp, 'index.html'); } catch {}
    const buf = await readFile(fp);
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const url = `http://localhost:${port}/?edit=1`;

const errors = [];
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const result = await page.evaluate(() => {
  const ed = window.__v3editor;
  const sum = document.getElementById('v3p-summary');
  const segs = document.querySelectorAll('#v3p-seglist .v3p-seg');
  const val = document.querySelectorAll('#v3p-validation .v3p-vrow');
  const prof = document.getElementById('v3p-profile');
  return {
    hasEditor: !!ed,
    cpCount: ed ? ed.track.controlPoints.length : 0,
    summaryHtml: sum ? sum.innerText.replace(/\n+/g, ' | ').slice(0, 300) : 'MISSING',
    segCount: segs.length,
    valCount: val.length,
    profW: prof ? prof.width : 0,
    summaryObj: ed && ed._summary ? { km: ed._summary.totalKm, vp: ed._summary.vpCount } : null,
  };
});
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
console.log('RESULT:', JSON.stringify(result, null, 2));

// take a screenshot for visual sanity
await page.screenshot({ path: '.shots/editor-pr102.png' });
console.log('shot: .shots/editor-pr102.png');
await browser.close();
server.close();
