// ---------- 森林斑块系统 ----------
// 从"随机撒树"升级为"森林斑块 + 林缘 + 远景树带"
import { getTerrainMasks } from '../terrainMasks.js';
import { smoothstep, clamp, randomRange } from './vegetationUtils.js';

// 9 种 EZ-Tree 变体索引
// 0=Oak Medium, 1=Oak Large, 2=Ash Medium, 3=Aspen Medium, 4=Aspen Small
// 5=Pine Medium, 6=Pine Large, 7=Bush 1, 8=Bush 2

/**
 * 生成森林斑块树位（替代旧的随机 treeSpots）
 * @param {object} opts
 * @param {Function} opts.meshGroundHeight
 * @param {Function} opts.groundHeight
 * @param {Function} opts.nearestRoad
 * @param {Function} opts.branchInfo
 * @param {Function} opts.islandBase
 * @param {number} opts.targetTrees - 目标树木总数（建议 1200-1800）
 * @param {number} opts.targetBushes - 目标灌木总数（建议 800-1500）
 * @returns {Array} treeSpots - [{ x, z, h, vi, rot, s }]
 */
export function generateForestSpots(opts) {
  const { meshGroundHeight, groundHeight, nearestRoad, branchInfo, islandBase } = opts;
  const targetTrees = opts.targetTrees || 1200;
  const targetBushes = opts.targetBushes || 800;
  const ctx = { meshGroundHeight, groundHeight, nearestRoad, branchInfo, islandBase };

  const treeSpots = [];
  const maxAttempts = targetTrees * 10;
  let placed = 0, attempts = 0;

  // ---------- 阶段 1：森林树木 ----------
  while (placed < targetTrees && attempts++ < maxAttempts) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 40 + Math.random() * 540;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const m = getTerrainMasks(x, z, ctx);

    // 道路避让（缩近到 8m，让路边植被更密）
    if (m.roadDist < 8) continue;

    // 高度范围
    if (m.height < 0.6 || m.height > 22) continue;

    // 坡度
    if (m.slope > 0.5) continue;

    // 沙滩不放树
    if (m.beach > 0.8) continue;

    // 森林密度决定放置概率
    let density = m.forest * 0.7 + m.meadow * 0.15;

    // 路边林缘加强
    if (m.roadDist >= 14 && m.roadDist < 40) {
      density += 0.25 * (1 - smoothstep(14, 40, m.roadDist));
    }

    if (Math.random() > density * 0.6 + 0.05) continue;

    // 树种分配（按高度分区）
    let vi;
    if (m.height < 3.5) {
      // 低地：不放 EZ-Tree（留给棕榈）
      continue;
    } else if (m.height > 14) {
      // 高地：松树
      vi = Math.random() < 0.55 ? 6 : 5; // Pine Large / Pine Medium
    } else if (m.height > 9) {
      // 中高：大橡树、松树混交
      vi = [1, 5, 0, 6][Math.floor(Math.random() * 4)];
    } else if (m.height > 5) {
      // 中低：橡树、白蜡、白杨混交
      vi = [0, 2, 3, 1, 4][Math.floor(Math.random() * 5)];
    } else {
      // 低坡：白杨、小橡树
      vi = [3, 4, 0][Math.floor(Math.random() * 3)];
    }

    // 林缘放灌木
    if (m.roadDist < 25 && Math.random() < 0.35) {
      vi = Math.random() < 0.5 ? 7 : 8; // Bush
    }

    const rot = Math.random() * Math.PI * 2;
    const s = 0.7 + Math.random() * 0.6;

    treeSpots.push({ x, z, h: m.height, vi, rot, s });
    placed++;
  }

  // ---------- 阶段 2：灌木填充 ----------
  let bushPlaced = 0;
  attempts = 0;
  const bushMaxAttempts = targetBushes * 8;

  while (bushPlaced < targetBushes && attempts++ < bushMaxAttempts) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 35 + Math.random() * 520;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const m = getTerrainMasks(x, z, ctx);

    if (m.roadDist < 8) continue;
    if (m.height < 1.0 || m.height > 18) continue;
    if (m.slope > 0.5) continue;
    if (m.beach > 0.7) continue;

    // 灌木密度：林缘 + 路边 + 草甸边缘
    let density = m.forest * 0.4 + m.roadside * 0.3 + m.meadow * 0.2;
    if (Math.random() > density * 0.5 + 0.05) continue;

    const vi = Math.random() < 0.5 ? 7 : 8; // Bush 1 / Bush 2
    const rot = Math.random() * Math.PI * 2;
    const s = 0.6 + Math.random() * 0.5;

    treeSpots.push({ x, z, h: m.height, vi, rot, s });
    bushPlaced++;
  }

  console.log(`[FOREST] 树木 ${placed}/${targetTrees}, 灌木 ${bushPlaced}/${targetBushes}`);
  return treeSpots;
}
