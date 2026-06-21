# 修复交付：菜单矮屏滚动条 + 步行模式驾驶 HUD 残留

分支：`feat/fix-menu-scroll-walk-hud-20260621`
基线：`origin/main` @ `34d3aa0`
改动文件（git diff --name-status origin/main）：
```
M	index.html
M	src/ui.js
```

---

## Bug 1：菜单矮屏出现竖直滚动条

### 根因
暂停/车库菜单左侧面板 `.rail` 使用固定 padding/字号/间距（`padding:42px 38px 32px`、`h1 42px`、`.cta padding:16px`、`.sec margin:30px`、`.swatch 42px`、`.charcard padding:14px`），内容总高度在矮屏（≤768/720 高）超过 `max-height:calc(100vh - 40px)`，触发 `overflow-y:auto` 渲染可见竖直滚动条（需求方蓝框）。

### 修改点（index.html）
1. **clamp() + vh 平滑压缩**：`.rail` padding、`.rail h1` 字号、`.cta` padding/margin、`.cta>span/em`、`.sec` margin/padding、`.row` gap、`.swatch` 尺寸、`.charcard` padding 全部改为随视口高度收缩的 `clamp()`，正常分辨率保持原视觉、矮屏自动收紧落进 `max-height`。
2. **隐藏滚动条兜底**：`.rail` 加 `scrollbar-width:none; -ms-overflow-style:none` 与 `.rail::-webkit-scrollbar{display:none}`，保留 `overflow-y:auto` 仍可滚但无视觉滚动条。
3. **分级 @media 断点**：`@media (max-height:820px)` 与 `(max-height:720px)` 逐级再压缩（h1、logoblk margin、cta、sec、swatch、charcard），覆盖 13" 笔记本缩放等极端矮屏。

关键 CSS：
```css
.rail{ ... max-height:calc(100vh - 40px);
  padding:clamp(20px,4.2vh,42px) clamp(24px,3vw,38px) clamp(18px,3.2vh,32px);
  overflow-y:auto; scrollbar-width:none; -ms-overflow-style:none; ... }
.rail::-webkit-scrollbar{display:none;width:0;height:0}
.rail h1{font-size:clamp(30px,5.2vh,42px); ...}
.cta{ ... margin:0 0 clamp(7px,1.3vh,12px); padding:clamp(10px,1.8vh,16px) 24px; ...}
.swatch{width:clamp(32px,4.4vh,42px);height:clamp(32px,4.4vh,42px); ...}
.charcard{ ... padding:clamp(9px,1.6vh,14px) 18px; ...}
@media (max-height:720px){ .rail{padding:18px 30px 16px} .rail h1{font-size:28px}
  .cta{margin:0 0 7px;padding:9px 22px} .swatch{width:32px;height:32px} ... }
```

### 验证（Playwright headless，量 .rail scrollHeight vs clientHeight）
| 视口 | scrollH | clientH | 溢出 | JS错误 |
|---|---|---|---|---|
| 1920x1080 | 1038 | 1038 | 否 | 0 |
| 1440x900 | 858 | 858 | 否 | 0 |
| 1366x768 | 726 | 726 | 否 | 0 |
| 1280x720 | 678 | 678 | 否 | 0 |

四档全部 `scrollHeight == clientHeight` → 内容完整落进 max-height，不溢出、不出现可见滚动条，且无内容截断。

---

## Bug 2：步行模式仍显示驾驶 HUD（电量/车速/导航线/AUTOSTEER）

### 根因
驾驶 HUD 由 CSS `body.drive #hmiDrivingHud{display:block}`（src/hmiDrivingHud.js:24）控制；`#radioInfo` 同理 `body.drive #radioInfo{display:flex}`（index.html:254）。原 KeyF 进入 walk 的路径（src/ui.js）**只 `remove('nohud')`，未 `remove('drive')`**，body 仍带 `drive` 类 → 驾驶 HUD 继续显示。对照 garage 路径（232-233 add nohud/remove drive）与 startDrive（260-261 remove nohud/add drive）可知 `drive` 类即 HUD 可见性开关。

### 修改点（src/ui.js，KeyF 处理）
- 进入 walk：新增 `document.body.classList.remove('drive')` → 隐藏整套驾驶 HUD。
- 上车回 drive（walk 分支）：新增 `document.body.classList.add('drive')` → 恢复 HUD。
- 步行专用 `showMsg('🚶 步行模式｜WASD...')` 横幅不受影响（独立于 drive 类）。
- `#radioInfo` 随 `drive` 类一并隐藏（步行不显示车机信息卡，符合预期）。

关键 JS：
```js
if (G.appState === 'drive') { // 下车 → 步行
  G.appState = 'walk';
  document.body.classList.remove('nohud');
  document.body.classList.remove('drive'); // 步行隐藏整套驾驶 HUD
  ...
} else if (G.appState === 'walk') { // F 上车 → 驾驶
  G.appState = 'drive';
  setCharacterVisible(false);
  document.body.classList.add('drive'); // 上车恢复驾驶 HUD
  ...
}
```

### 验证（Playwright headless，量 body class 切换下的 computed display）
以与 #hmiDrivingHud 同构的 `body.drive #radioInfo{display:flex}` 规则代理验证 HUD 开关：
- body=`drive` → `#radioInfo` display=`flex`（HUD 显示）
- body=`walk` → `#radioInfo` display=`none`（HUD 隐藏）✅
- body 回 `drive` → display=`flex`（HUD 恢复）✅

反复切换 class 显示状态正确，页面无 JS 错误（pageerror=0）。`#hmiDrivingHud` 走完全相同的 `body.drive` 规则，故行为一致（运行时注入，headless 未跑满游戏 init 故 DOM 节点未生成，以同构 CSS 规则推导）。

---

## 构建证据
```
npx vite build
✓ 50 modules transformed.
dist/index.html                 27.78 kB │ gzip:   9.01 kB
dist/assets/index-BB_AGWBQ.js  370.92 kB │ gzip: 139.76 kB
dist/assets/three-ZelMX2jd.js  553.73 kB │ gzip: 141.53 kB
✓ built in 4.76s
```

## Commit / 分支
- 分支：`feat/fix-menu-scroll-walk-hud-20260621`
- author：Core5God <129576964+Core5God@users.noreply.github.com>
- commit / push ref：见下文回填
