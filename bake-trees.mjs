// 离线烘焙 ez-tree → 量化静态几何（pos:Int16 norm:Int8 uv:Uint16）
const elStub = () => ({ addEventListener(){}, removeEventListener(){}, setAttribute(){}, style:{}, getContext: () => null, src:'' });
globalThis.document = { createElementNS: elStub, createElement: elStub };
globalThis.Image = function(){ return elStub(); };
globalThis.self = globalThis;

const { Tree } = await import('./node_modules/@dgreenheck/ez-tree/build/ez-tree.es.js');
const fs = await import('fs');

const PRESETS = ['Oak Medium','Oak Large','Ash Medium','Aspen Medium','Aspen Small','Pine Medium','Pine Large','Bush 1','Bush 2'];
const variants = [];
const bufs = [];
let offset = 0;
function push(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  bufs.push(u8);
  const o = offset;
  offset += u8.byteLength;
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { bufs.push(new Uint8Array(pad)); offset += pad; }
  return o;
}
function quant(g) {
  const pos = g.attributes.position.array, nor = g.attributes.normal.array, uv = g.attributes.uv.array;
  let pm = 0; for (const v of pos) pm = Math.max(pm, Math.abs(v));
  let um = 0; for (const v of uv) um = Math.max(um, Math.abs(v));
  pm = pm || 1; um = um || 1;
  const qp = new Int16Array(pos.length), qn = new Int8Array(nor.length), qu = new Uint16Array(uv.length);
  for (let i = 0; i < pos.length; i++) qp[i] = Math.round(pos[i]/pm*32760);
  for (let i = 0; i < nor.length; i++) qn[i] = Math.round(Math.max(-1, Math.min(1, nor[i]))*127);
  for (let i = 0; i < uv.length; i++) qu[i] = Math.round(Math.max(0, uv[i])/um*65535);
  const big = pos.length/3 > 65535;
  const idx = big ? new Uint32Array(g.index.array) : new Uint16Array(g.index.array);
  return { vcount: pos.length/3, icount: idx.length, idx32: big, posScale: pm, uvScale: um,
    pos: push(qp), nor: push(qn), uv: push(qu), idx: push(idx) };
}
for (let i = 0; i < PRESETS.length; i++) {
  const t = new Tree();
  t.loadPreset(PRESETS[i]);
  t.options.seed = 1000 + i*77;
  t.options.leaves.count = Math.round(t.options.leaves.count * 0.65); // 控制体积
  t.generate();
  const bg = t.branchesMesh.geometry, lg = t.leavesMesh.geometry;
  bg.computeBoundingBox();
  variants.push({ name: PRESETS[i], srcH: +bg.boundingBox.max.y.toFixed(3),
    leafType: String(t.options.leaves.type), leafTint: t.options.leaves.tint,
    barkType: String(t.options.bark.type), barkTint: t.options.bark.tint,
    parts: { branch: quant(bg), leaf: quant(lg) } });
  console.log(PRESETS[i], variants[i].parts.branch.vcount, variants[i].parts.leaf.vcount);
}
const total = Buffer.concat(bufs.map(b => Buffer.from(b)));
fs.writeFileSync('public/assets/trees/trees.bin', total);
fs.writeFileSync('public/assets/trees/trees.json', JSON.stringify({ variants }));
console.log('bin bytes:', total.length);
