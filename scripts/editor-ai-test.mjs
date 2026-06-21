// AI interface + interaction test (PR1.0.2)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DIST = path.join(path.resolve('.'), 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(DIST, p);
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(await readFile(fp));
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${port}/?edit=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const r = await page.evaluate(() => {
  const ed = window.__v3editor;
  const summary = ed.summaryText();
  const validation = ed.validationText();
  const csv = ed.profileCsv();
  // test patch import: bump cp_mqnodecm_4 width
  ed.ioEl.value = JSON.stringify([{ id: 'cp_mqnodecm_4', roadWidth: 30, tags: ['valley'] }]);
  ed.importPatch();
  const cp = ed.track.controlPoints.find((c) => c.id === 'cp_mqnodecm_4');
  // test segment locate
  ed._locateSegment(7);
  return {
    summaryHead: summary.split('\n')[0],
    summaryLines: summary.split('\n').length,
    valHead: validation.split('\n')[0],
    csvHead: csv.split('\n')[0],
    csvRows: csv.split('\n').length,
    patchedWidth: cp.roadWidth,
    locatedSel: ed.selected,
  };
});
console.log('ERRORS:', errs.length ? errs.join('|') : 'none');
console.log(JSON.stringify(r, null, 2));
await browser.close();
server.close();
