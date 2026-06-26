// 单文件预览构建配置（常驻项目，沙箱重启也不丢）。
// 用法：node tools/gen-assetmap.mjs && npx vite build --config vite.singlefile.mjs --outDir /tmp/hc-single --emptyOutDir
// 或直接：bash tools/build-preview.sh
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'fs';
const A = JSON.parse(fs.readFileSync('.build-tmp/assetmap.json', 'utf8'));
function inlineAssets() {
  return { name: 'inline-assets', enforce: 'pre',
    transform(code, id) {
      id = id.replace(/\\/g, '/');
      if (id.endsWith('/src/vehicle.js')) code = code.replace("const GLB_URL = 'assets/e29.glb';", `const GLB_URL = ${JSON.stringify(A['e29.glb'])};`);
      if (id.endsWith('/src/character.js')) {
        code = code.replace("'assets/character.glb'", JSON.stringify(A['character.glb']));
        code = code.replace("'assets/iron.glb'", JSON.stringify(A['iron.glb']));
      }
      if (id.endsWith('/src/skycycle.js')) { const m=['day2','day3','evening','night1','night2'].map(s=>`${JSON.stringify(s)}:${JSON.stringify(A['sky/'+s])}`).join(','); code = code.replace("'assets/sky/' + k.f + '.hdr'", `(({${m}})[k.f])`); }
      if (id.endsWith('/src/world.js')) {
        code = code.replace("'assets/sky_day.hdr'", JSON.stringify(A['sky_day.hdr']));
        code = code.replace("fetch('assets/trees/trees.json')", `fetch(${JSON.stringify(A['trees.json'])})`);
        code = code.replace("fetch('assets/trees/trees.bin')", `fetch(${JSON.stringify(A['trees.bin'])})`);
        const texMap=['oak_color.png','ash_color.png','aspen_color.png','pine_color.png','oak_color_1k.jpg','pine_color_1k.jpg'].map(f=>`${JSON.stringify(f)}:${JSON.stringify(A[f])}`).join(',');
        code = code.replace("texLoader.load('assets/trees/' + f)", `texLoader.load(({${texMap}})[f])`);
        const terr={"sand_diff.jpg":"terrain/sand_diff","forest_diff.jpg":"terrain/forest_diff","rock_diff.jpg":"terrain/rock_diff","dry_diff.jpg":"terrain/dry_diff","sand_rough.webp":"terrain/sand_rough","rock_rough.webp":"terrain/rock_rough","dry_rough.webp":"terrain/dry_rough","forest_rough.webp":"terrain/forest_rough","forest_nrm.webp":"terrain/forest_nrm"};
        for (const [fn,key] of Object.entries(terr)) code = code.split("TP+'"+fn+"'").join(JSON.stringify(A[key]));
        code = code.replace("'assets/terrain/road2_diff.jpg'", JSON.stringify(A['terrain/road2_diff']));
        code = code.replace("'assets/terrain/waternormals.jpg'", JSON.stringify(A['terrain/waternormals']));
        code = code.replace("'assets/terrain/road2_nrm.webp'", JSON.stringify(A['terrain/road2_nrm']));
        code = code.replace("'assets/terrain/road2_rough.webp'", JSON.stringify(A['terrain/road2_rough']));
      }
      return code;
    },
    transformIndexHtml(html){ return html.replace(/<link rel="preload"[^>]*>\s*/g,''); } };
}
export default defineConfig({ plugins:[inlineAssets(), viteSingleFile()], build:{ assetsInlineLimit:100000000, cssCodeSplit:false } });
