# XPENG THE NEXT P7 · 地平线海岸 ULTRA

基于 Three.js 的轻量级品牌驾驶游戏（Web 端，免安装）。
在线体验：https://horizon.beastle.cn

## 玩法
- 自由漫游海岛 / 三条竞速路线（经典环线 · 黄昏冲刺 · 跨谷挑战），金银铜奖牌 + 8 项成就
- 可破坏道具（遮阳伞/躺椅/木箱/栅栏/路锥）、连击计分、漂移与腾空物理
- 三套时间光照（落日/白天/夜晚）、照片模式与品牌海报导出、Lofi 电台

## 操作
WASD 驾驶 · SHIFT 性能模式 · SPACE 漂移 · C 视角 · V 车漆 · N 时间 · R 竞速 · P 照片 · T 复位 · ESC 菜单

## 开发
```bash
npm install
npm run dev      # 本地开发
npm run build    # 构建到 dist/
```

## 技术栈
Vite + Three.js 0.169（官方 Sky 大气散射 / Water 实时反射 / PBR / Bloom）、
EZ-Tree 程序化树木（MIT）、自研街机车辆物理 / 碰撞 / 计分系统、WebAudio 程序化音效与音乐。

模块结构：`src/{core,world,vehicle,gameplay,audio,ui,fx,main}.js`

## 资产说明
`public/assets/e29.glb` 为车辆模型资产，版权归属其原作者/品牌方，仅用于本演示项目。
