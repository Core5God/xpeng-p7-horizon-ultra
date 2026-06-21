# 修复交付：菜单矮屏滚动条 + 步行模式驾驶 HUD 残留

分支：`feat/fix-menu-scroll-walk-hud-20260621`
基线：`origin/main` @ `34d3aa0`
改动文件（git diff --name-status origin/main）：
```
M	index.html
M	src/ui.js
A	docs/fix-menu-scroll-walk-hud-20260621.md
```

> 追加（task-20260621-008 范围内的视觉优化）：车漆 PAINT 色盘 `.swatch` 金属光泽质感，见文末「Bug 3 / 视觉优化」。

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

---

## Bug 3 / 视觉优化：车漆 PAINT 色盘金属光泽

### 需求
车漆选择色盘（`.swatch` 圆形色块）原为 42px 纯色圆 + 2px 边框，较扁平。需求方要求加金属车漆质感、更精致，且与整体 Apple 玻璃冷色调协调、克制不浮夸。

### 关键约束
底色由 JS（`buildRows` 里 `b.style.background = ...`）**内联动态填入**（每个色不同，含一个 conic 金属渐变）。内联 `background` 简写会覆盖 CSS 的 `background-image`，故金属高光层必须用**与底色无关的叠加方式**实现，才能任意底色套同一套效果。

### 实现方式（index.html `.swatch`）
- 用 `::before` 伪元素叠加层（`inset:0` + `overflow:hidden` 裁成圆），不碰底色，三层 background 叠加：
  1. `radial-gradient` 顶部偏左柔和高光斑（环境光反射 glint，球面立体感）；
  2. `radial-gradient` 底部暗部（让色块像金属漆小球而非平面圆）；
  3. `linear-gradient` 细微对角高光→暗部过渡（漆面斜向反光）。
- `.swatch` 本体加 inset box-shadow：顶部内高光 + 底部内暗影 + 1px 内白圈，强化金属边圈反光。
- `.sel` 选中态在金属质感上保留并略增强冷白外环（`0 0 0 2px rgba(255,255,255,.62)`）。
- hover `scale(1.12)` 微动效保留。

关键 CSS：
```css
.swatch{position:relative;width:clamp(32px,4.4vh,42px);height:clamp(32px,4.4vh,42px);
  border-radius:50%;border:2px solid rgba(255,255,255,.22);overflow:hidden;
  box-shadow:inset 0 1px 1px rgba(255,255,255,.30),inset 0 -3px 6px rgba(0,0,0,.42),
             inset 0 0 0 1px rgba(255,255,255,.10),0 2px 5px rgba(0,0,0,.30)}
.swatch::before{content:'';position:absolute;inset:0;border-radius:50%;pointer-events:none;
  background:
    radial-gradient(60% 50% at 32% 26%,rgba(255,255,255,.62) 0%,rgba(255,255,255,.20) 34%,rgba(255,255,255,0) 60%),
    radial-gradient(120% 120% at 50% 118%,rgba(0,0,0,.40) 0%,rgba(0,0,0,0) 52%),
    linear-gradient(150deg,rgba(255,255,255,.14) 0%,rgba(255,255,255,0) 40%,rgba(0,0,0,.10) 100%)}
.swatch:hover{transform:scale(1.12)}
.swatch.sel{border-color:var(--glass-border-hi);
  box-shadow:inset 0 1px 1px rgba(255,255,255,.34),inset 0 -3px 6px rgba(0,0,0,.42),
             inset 0 0 0 1px rgba(255,255,255,.14),0 0 0 2px rgba(255,255,255,.62),0 2px 9px rgba(0,0,0,.32)}
```

### 验证
- Playwright 注入多种底色（蓝/红/白/近黑/conic 金属）核对 computed style：内联底色保留（`rgb(27,58,107)` 等），`::before` content=`""`、`backgroundImage` 含 3 个 gradient 层，`.swatch` boxShadow 含 inset，`overflow:hidden`。
- 隔离渲染截图：每个色块呈现「左上高光斑 + 底部暗边 + 斜向漆面反光 + 内圈反光」的金属漆小球观感，任意底色一致生效，选中项带冷白外环。风格克制，与玻璃冷色调协调。
- `npx vite build` 通过（dist/index.html 28.53 kB）。
