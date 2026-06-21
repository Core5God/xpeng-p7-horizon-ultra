// Generate initial grey-box loop track.main.json (PR1)
// task-20260621-V3-PR1
// 节奏：起点基地 → 山谷 → 爬坡发卡弯 → 山顶俯瞰 → 洞穴/隧道(标签) →
//        海边日出段 → 港湾日落段 → 回起点。目标单圈 8–12km。
import { writeFileSync } from 'fs';
import { sampleClosedSpline, arcLengths, detectSelfIntersections, checkClosure } from '../src/v3/trackSpline.js';
import { makeControlPoint, normalizeTrack, SCHEMA_VERSION } from '../src/v3/trackSchema.js';

// 控制点：[x, z, y, roadWidth, bankDeg, tags[], vpAnchor]
// 单位米。环线尺度 ~ 直径 3km → 周长 ~9km。
const D = [
  // 起点基地（平坦）
  [   0,    0,   2, 16, 0, ['start'], 'VP1'],
  [ 600,  -200,  6, 14, 0, [], null],
  // 山谷下凹段
  [1200, -300, -28, 13, 0, ['valley'], null],
  [1700,  -100,-34, 12, 0, ['valley','no_airborne'], null],
  // 爬坡 + 发卡弯（窄、bank）
  [2000,  300,  40, 11, 8, ['hairpin'], null],
  [1850,  750, 120, 10, 14, ['hairpin','downhill_drop'], null],
  [1500,  950, 210, 10, 10, [], null],
  // 山顶俯瞰
  [1000, 1050, 290, 12, 0, ['summit','crest'], 'VP5'],
  [ 450, 1000, 300, 12, 0, ['summit','crest','jump_test'], null],
  // 下山 → 洞穴/隧道（标签，本棒不做几何）
  [ -50,  850, 180, 12, 0, ['downhill_drop'], null],
  [-450,  600,  60, 13, 0, ['cave'], null],
  [-700,  300,  10, 13, 0, ['tunnel','no_airborne'], null],
  // 海边日出段（压低，接近海平面）
  [-900,  -50,  -6, 14, 0, ['coast_sunrise'], null],
  [-850, -450,  -8, 15, 0, ['coast_sunrise'], null],
  // 港湾日落段（自交叉留给未来桥 → 这里贴一段近自身但不交叉）
  [-500, -750, -4, 15, 0, ['harbor_sunset','bridge_bump'], null],
  [ -50, -850,  0, 16, 0, ['harbor_sunset','bridge'], null],
  // 回起点
  [-300, -400,  2, 16, 0, ['no_airborne'], null],
];

const cps = D.map(([x, z, y, w, bank, tags, vp]) =>
  makeControlPoint(x, y, z, { roadWidth: w, bankDeg: bank, tags, vpAnchor: vp }));

// 段落语义（相邻控制点之间）
const segments = [];
for (let i = 0; i < cps.length; i++) {
  segments.push({ from: cps[i].id, to: cps[(i + 1) % cps.length].id, kind: 'road' });
}

const track = normalizeTrack({
  schemaVersion: SCHEMA_VERSION,
  author: 'Core5God',
  sourceTrackRevision: 1,
  controlPoints: cps,
  segments,
});

// 校验
const dense = sampleClosedSpline(track.controlPoints, 28);
const { total } = arcLengths(dense);
const hits = detectSelfIntersections(dense);
const clo = checkClosure(dense);
console.log('控制点:', track.controlPoints.length);
console.log('环线弧长:', (total / 1000).toFixed(2), 'km');
console.log('闭合:', clo.closed, '退化段:', clo.degenerate);
console.log('自交叉:', hits.length, '处');

writeFileSync(new URL('../track.main.json', import.meta.url), JSON.stringify(track, null, 2));
console.log('written track.main.json');
