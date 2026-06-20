# 无头 WebGL 截图（headless-shot）使用说明

> task-20260620-015 验证产出。让 Leader 在无 GPU 的 VPS 上对本 Three.js demo 做无头自检截图。
> 结论：**可行**。SwiftShader 软件渲染能跑出真实 WebGL2 3D 画面（非黑屏）。

## 方案

- Playwright + headless Chromium + **SwiftShader**（软件 WebGL2，零 GPU）。
- 实测后端：`ANGLE (Vulkan 1.3.0 SwiftShader Device (Subzero))`，`WebGL 2.0 (OpenGL ES 3.0)` 可用。
- 启动参数：`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --no-sandbox --disable-dev-shm-usage`。
- 截图用 **CDP `Page.captureScreenshot`** 直接抓帧，绕开 Playwright 对持续 rAF 动画的“稳定”等待（否则 `page.screenshot` 会一直超时）。
- 不依赖 xvfb（纯 headless 即可）；系统 `libgl1-mesa-dri` 已预装。

## 依赖（已装好，复用无需重装）

- npm（仓库本地 devDependency）：`playwright@^1.61.0`
- Chromium 浏览器二进制：`npx playwright install chromium`（已下载到 `~/.cache/ms-playwright/`）
- 系统包：`libgl1-mesa-dri`、`xvfb` —— 早已预装，本次未动系统。

重装命令（换机器时）：
```bash
npm i -D playwright && npx playwright install chromium
```

## 用法

```bash
cd /home/ubuntu/repos/xpeng-p7-horizon-ultra
npx vite build                       # 先产出 dist/（脚本默认托管 dist）

# 默认截 vp=2(直道) + vp=3(弯道)，输出 .shots/*.jpg
node scripts/headless-shot.mjs
# 或 npm run shot

# 指定机位（1~8）
node scripts/headless-shot.mjs 2 3 5
node scripts/headless-shot.mjs --vp 2,3,7

# 常用选项
node scripts/headless-shot.mjs --vp 2 \
  --out .shots --fmt jpg --w 1600 --h 900 --quality 80 --settle 2000

# 用已起好的外部服务（不自己起静态服务）
node scripts/headless-shot.mjs --url http://localhost:4173 --vp 2
```

- 脚本自己起一个临时静态服务托管 `dist/`（随机端口，跑完即关，不占常驻端口）。
- 输出默认 `.shots/vpNN_<name>.jpg`（已加入 .gitignore）。
- `?fastdebug=1` 由脚本自动带上（跳过重植被/降质/自动进场）。

## 实测结果

- vp=2 直道、vp=3 弯道均截出**真实 3D 画面**：路面/车道线/护栏/锥桶/P7 车/地形/天空云/HUD（速度·里程·验收点标签）全部可见，非黑屏。
- 样张：`.shots/vp02_straight.jpg`、`.shots/vp03_curve.jpg`（1600×900，~140KB/张，JPEG q80）。

## 性能 / 画质

- **单张耗时 ~120~220s**（高度波动）。瓶颈是 **boot 期间的程序化建场**（`buildScenery` 生成 40 树+20 灌木约 30s、角色 GLB、PMREM 等），不是截图本身——软件渲染下着色器/几何在 CPU 上跑得慢。`--settle` 调小帮助有限。
- 画质：1600×900、关阴影、pixelRatio=1、bloom/后期仍开。**足够 Leader 判断 UI/构图/路面贴图/HUD 布局**，不适合像素级材质验收。
- 建议：批量多机位时一次传多个 `vp`，但要给足超时（每张按 ~4min 预留）。boot 超时上限脚本内设 180s。

## 备选 / 注意

- 若将来要更快：可考虑带 GPU 的小节点（耗时可降到秒级），或在产品侧加更激进的 `fastdebug` 跳过建场（属产品代码改动，本任务未动 src/）。
- headless-gl（gl npm 包）方案未采用：它只给裸 WebGL1 上下文，本项目用 Three r169 + WebGL2 + 完整 DOM/HUD，移植成本高且不还原真实页面，SwiftShader 路线更贴近线上效果。

## 本次改动清单（未 push）

- 新增 `scripts/headless-shot.mjs`（纯工具，不含业务逻辑）。
- `package.json`：加 `playwright` devDependency + `npm run shot` 脚本。
- `.gitignore`：加 `.shots/`、`.build-tmp/`。
- 未改任何 `src/` 业务代码。
