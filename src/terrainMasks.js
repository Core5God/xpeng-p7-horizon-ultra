// ---------- 地形生态 Mask 系统 ----------
// 为地形材质和植被生成提供统一的一套生态依据
import { clamp, smoothstep, fbm2, estimateSlope } from './vegetation/vegetationUtils.js';

/**
 * 计算指定坐标的地形生态 mask
 * @param {number} x - 世界 X 坐标
 * @param {number} z - 世界 Z 坐标
 * @param {object} ctx - 上下文：{ meshGroundHeight, groundHeight, nearestRoad, branchInfo, islandBase }
 * @returns {object} 各生态 mask 值（0–1）
 */
export function getTerrainMasks(x, z, ctx) {
  const height = ctx.meshGroundHeight(x, z);
  const slope = estimateSlope(x, z, ctx.meshGroundHeight);

  // 道路距离（主路 + 支路取最近）
  const rd = ctx.nearestRoad(x, z);
  const br = ctx.branchInfo(x, z);
  const roadDist = Math.min(rd.dist, br.dist);

  // 海岸距离（用距原点距离近似）
  const distFromCenter = Math.sqrt(x * x + z * z);
  const beach = 1 - smoothstep(0.8, 4.0, height);

  // 路边带：0-6m 路面/硬路肩, 6-14m 短草/碎石, 14-35m 灌木/小树, 35m+ 森林/草甸
  const roadside = 1 - smoothstep(8.0, 28.0, roadDist);

  // 噪声生态场
  const noise = fbm2(x * 0.003, z * 0.003);
  const macroNoise = fbm2(x * 0.001 + 100, z * 0.001 + 100);

  // 森林
  const forest = clamp(
    fbm2(x * 0.003, z * 0.003)
    * smoothstep(3.0, 9.0, height)
    * (1.0 - smoothstep(0.25, 0.55, slope))
    * smoothstep(22.0, 48.0, roadDist)
    * (1.0 - beach),
    0, 1
  );

  // 草甸
  const meadow = clamp(
    fbm2(x * 0.006 + 13.1, z * 0.006 - 8.4)
    * smoothstep(2.0, 7.0, height)
    * (1.0 - forest)
    * (1.0 - smoothstep(0.22, 0.45, slope)),
    0, 1
  );

  // 岩石
  const rock = clamp(
    smoothstep(14.0, 24.0, height)
    + smoothstep(0.42, 0.70, slope),
    0, 1
  );

  // 干地
  const dryland = clamp(
    smoothstep(6.0, 14.0, height)
    * (1.0 - forest * 0.7)
    * (1.0 - rock * 0.5),
    0, 1
  );

  // 湿地（低地 + 近水）
  const wetland = clamp(
    (1.0 - smoothstep(0.5, 2.5, height))
    * (1.0 - smoothstep(0.3, 0.6, slope)),
    0, 1
  );

  // 肥力（综合决定植被密度）
  const fertility = clamp(
    (forest * 0.6 + meadow * 0.8 + roadside * 0.3)
    * (1.0 - rock * 0.8)
    * (1.0 - beach * 0.5),
    0, 1
  );

  return {
    height, slope, roadDist, beach, roadside,
    forest, meadow, dryland, rock, wetland,
    fertility, noise, macro: macroNoise
  };
}
