// 生成 /tmp/assetmap.json —— 把运行时按路径加载的资源转成 base64 data URI，供单文件构建内联。
// 仅读取项目内 public/assets（持久化在桌面），不需要联网/安装，沙箱重启后随时可再跑。
import fs from 'fs';
const A = {};
const b = 'public/assets/';
const put = (key, path, mime) => { A[key] = 'data:' + mime + ';base64,' + fs.readFileSync(path).toString('base64'); };
put('e29.glb', b + 'e29.glb', 'application/octet-stream');
put('character.glb', b + 'character.glb', 'application/octet-stream');
put('iron.glb', b + 'iron.glb', 'application/octet-stream');
put('sky_day.hdr', b + 'sky_day.hdr', 'application/octet-stream');
put('trees.json', b + 'trees/trees.json', 'application/json');
put('trees.bin', b + 'trees/trees.bin', 'application/octet-stream');
for (const f of ['oak_color.png', 'ash_color.png', 'aspen_color.png', 'pine_color.png']) put(f, b + 'trees/' + f, 'image/png');
for (const f of ['oak_color_1k.jpg', 'pine_color_1k.jpg']) put(f, b + 'trees/' + f, 'image/jpeg');
for (const s of ['day2', 'day3', 'evening', 'night1', 'night2']) put('sky/' + s, b + 'sky/' + s + '.hdr', 'application/octet-stream');
for (const f of ['sand_diff', 'forest_diff', 'rock_diff', 'dry_diff']) put('terrain/' + f, b + 'terrain/' + f + '.jpg', 'image/jpeg');
for (const f of ['sand_rough', 'rock_rough', 'dry_rough', 'forest_rough', 'forest_nrm']) put('terrain/' + f, b + 'terrain/' + f + '.webp', 'image/webp');
put('terrain/road2_diff', b + 'terrain/road2_diff.jpg', 'image/jpeg');
put('terrain/road2_nrm', b + 'terrain/road2_nrm.webp', 'image/webp');
put('terrain/road2_rough', b + 'terrain/road2_rough.webp', 'image/webp');
fs.writeFileSync('.build-tmp/assetmap.json', JSON.stringify(A));
console.log('assetmap:', Object.keys(A).length, 'keys');
