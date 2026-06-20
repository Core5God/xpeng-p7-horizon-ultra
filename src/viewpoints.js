// ---------- 固定视觉验收点（Visual Acceptance Viewpoints）----------
// task-20260620-003 / Horizon V2 Visual Baseline Sprint 阶段2
//
// 目的：建立 8 个固定相机机位，作为所有视觉前后对比的统一基准。
//   - 坐标全部由 src/world.js 的确定性几何（CatmullRom 主路 samples / 支路 bSamples /
//     islandBase 地形 / 灯塔取点）离线复算得到，非随手编造。
//   - 每个验收点固定 6 个参数：相机位置 / 相机朝向(lookAt) / 天气时段(tod) /
//     车位(samples 或 bSamples index) / 截图命名 / 验收重点。
//   - 本阶段不改任何视觉/材质/几何，仅新增此配置 + 截图/跳转工具。
//
// TOD 取值用 world.js 的静态 PRESETS key（applyTod 直接生效、可复现）：
//   'day'（白天 HDRI）/ 'sunset'（落日）/ 'night'（夜晚）
// 注：动态天气系统另有 SKY_PRESETS（day_clear/day_cloudy/dusk_warm/night_clear/
//   night_cloudy），由 weatherController 随机调度，不适合做可复现基准，故此处不用。
//
// 用法：
//   - 浏览器内跳转：URL 加 ?vp=3 直接跳到第 3 个验收点；或运行时按 1~8 数字键。
//     （见 src/main.js installViewpointJump 钩子）
//   - 批量截图：scripts/capture-viewpoints.mjs（需有 GPU 的真实浏览器环境，
//     当前 VPS 沙箱无 GPU 无法 headless 渲染 WebGL）。

export const VIEWPOINTS = [
  {
    id: 1,
    name: 'vp01_garage.png',
    label: '出生点 / 车库近景',
    // 车库展示位 garageIdx=0，主路 samples[0]=(410.4, 0.80, 0.0)
    carRoad: 'main',
    carIdx: 0,
    carPos: { x: 410.4, y: 0.80, z: 0.0 },
    // 相机在车右前方俯视，看清车身材质与出生点路面
    camPos: { x: 416.0, y: 3.40, z: -5.0 },
    lookAt: { x: 410.4, y: 1.00, z: 0.0 },
    tod: 'day',
    focus: '看出生点车身材质 / 路面与车库地面接缝是否干净',
  },
  {
    id: 2,
    name: 'vp02_straight.png',
    label: '主路直道',
    // 全环线最直路段 samples[146]=(173.4, 0.80, 211.9)，曲率≈0.039rad
    carRoad: 'main',
    carIdx: 146,
    carPos: { x: 173.4, y: 0.80, z: 211.9 },
    // 相机贴尾偏上，朝行进方向（tangent*30 前瞻点）
    camPos: { x: 180.8, y: 3.20, z: 213.2 },
    lookAt: { x: 143.9, y: 0.80, z: 206.7 },
    tod: 'day',
    focus: '看直道路面贴图平铺 / 路缘与地形过渡 / 远景透视是否自然',
  },
  {
    id: 3,
    name: 'vp03_curve.png',
    label: '主路弯道',
    // 全环线最弯路段 samples[74]=(381.9, 0.80, 212.1)，曲率≈0.682rad
    carRoad: 'main',
    carIdx: 74,
    carPos: { x: 381.9, y: 0.80, z: 212.1 },
    camPos: { x: 392.0, y: 3.40, z: 206.0 },
    lookAt: { x: 359.4, y: 0.80, z: 232.0 },
    tod: 'day',
    focus: '看弯道内外侧路面三角化 / 护栏走线 / 弯心地形压平带是否隆起',
  },
  {
    id: 4,
    name: 'vp04_forest.png',
    label: '森林路段',
    // 森林密度最高的主路段 samples[296]=(-240.5, 34.83, 239.2)
    // （路侧 ±45m 取样 forest mask 之和最大，y≈35 高地林区）
    carRoad: 'main',
    carIdx: 296,
    carPos: { x: -240.5, y: 34.83, z: 239.2 },
    camPos: { x: -232.0, y: 38.30, z: 246.0 },
    lookAt: { x: -263.7, y: 34.83, z: 220.2 },
    tod: 'day',
    focus: '看树木分布密度 / 林缘穿模 / 树影投射 / 树与地面接触是否悬浮',
  },
  {
    id: 5,
    name: 'vp05_lighthouse.png',
    label: '海边 / 灯塔方向',
    // 灯塔在离岛中心最远海角 li=60，灯塔位(428.6, 1.00, 186.2)；
    // 相机站在对应主路 samples[60]=(404.1, 0.80, 177.4) 朝灯塔/外海方向。
    carRoad: 'main',
    carIdx: 60,
    carPos: { x: 404.1, y: 0.80, z: 177.4 },
    camPos: { x: 398.0, y: 4.50, z: 172.0 },
    lookAt: { x: 428.6, y: 8.00, z: 186.2 },
    tod: 'sunset',
    focus: '看灯塔造型 / 海面着色与地平线雾 / 海岸线沙水过渡（落日光照下）',
  },
  {
    id: 6,
    name: 'vp06_bridge.png',
    label: '高坡 / 桥面 / 起伏路段',
    // 支路 bSamples 最高点 bIdx=81=(93.9, 14.58, 76.3)，支路全程贴地内陆公路、
    // 此处为最显著的高坡/起伏段（bBridge 已全 false，无真桥）。
    carRoad: 'branch',
    carIdx: 81,
    carPos: { x: 93.9, y: 14.58, z: 76.3 },
    camPos: { x: 102.0, y: 18.10, z: 82.0 },
    lookAt: { x: 70.2, y: 13.50, z: 57.8 },
    tod: 'day',
    focus: '看坡道纵向起伏顺滑度 / 支路与地形压平带接缝 / 上下坡路面拉伸',
  },
  {
    id: 7,
    name: 'vp07_night.png',
    label: '夜晚路段',
    // 复用主路直道 samples[146] 同机位，切夜晚 preset，验收夜间光照基准。
    carRoad: 'main',
    carIdx: 146,
    carPos: { x: 173.4, y: 0.80, z: 211.9 },
    camPos: { x: 180.8, y: 3.20, z: 213.2 },
    lookAt: { x: 143.9, y: 0.80, z: 206.7 },
    tod: 'night',
    focus: '看夜间路灯/车灯/星空/海面反射 / bloom 是否过曝 / 暗部噪点',
  },
  {
    id: 8,
    name: 'vp08_worst.png',
    label: '当前问题最明显路段（非路口）',
    // samples[28]=(413.6, 0.80, 83.2)：主路紧贴海岸线运行，路面坐于海平面附近，
    // 路两侧地形一侧 +2.88m、另一侧 -1.27m（已没入水下）→ 砂/路/水三相接缝 +
    // 材质突变最明显的真实路段。远离两个 Y 路口（路口专项已冻结），dCenter≈422m。
    carRoad: 'main',
    carIdx: 28,
    carPos: { x: 413.6, y: 0.80, z: 83.2 },
    // 相机偏陆侧俯瞰海岸接缝，朝行进方向兼顾水线
    camPos: { x: 408.0, y: 4.00, z: 79.0 },
    lookAt: { x: 414.5, y: 0.50, z: 113.2 },
    tod: 'day',
    focus: '看路—沙—水三相接缝是否穿帮 / 海平面与路肩材质突变 / 路面是否泡在水里',
  },
];

// 可用 TOD preset（静态、可复现）：world.js PRESETS
export const TOD_KEYS = ['day', 'sunset', 'night'];

// 供截图工具/跳转钩子按 id 取点
export function getViewpoint(id) {
  return VIEWPOINTS.find((v) => v.id === Number(id)) || null;
}
