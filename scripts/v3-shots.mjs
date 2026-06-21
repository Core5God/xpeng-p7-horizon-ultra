import { chromium } from 'playwright';
const BASE = 'http://localhost:5188/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
for (const [vp, name] of [['0','vp0_overview'],['1','vp1_start'],['5','vp5_summit'],['edit','vp_edit']]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const url = vp === 'edit' ? BASE + '?edit=1' : BASE + `?v3=1&vp=${vp}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `/tmp/v3shots/${name}.png` });
  console.log('shot', name);
  await ctx.close();
}
await browser.close();
