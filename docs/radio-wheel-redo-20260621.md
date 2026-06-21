# 电台径向轮盘重做（方向修正版）— task-20260621-007

> 分支：`feat/radio-wheel-redo-20260621`　基线：`origin/main` @ 4ca3863
> 改动文件：`index.html`、`src/ui.js`（CSS/markup/交互）；`src/audio.js` 仅调用不改。

## 背景与方向修正

上一轮（task-005）把电台从「长按 B + 拨方向选择」的径向轮盘，改成了左上角常驻玻璃卡片 + 一套键盘控制（←/→ 切歌、↑ 模式、↓ 播停、S 随机）。需求方反馈这套键盘控制**直接和驾驶控制冲突**：

- 驾驶键：`vehicle.js` 用 `ArrowUp/Down`=油门/刹车、`ArrowLeft/Right`=转向（WASD 同）。
- 上一轮把 ←/→/↑/↓/S 当电台键 → 驾驶中想切歌按方向键，要么必须先开面板、要么直接去操控车。不可接受。

本轮**回到「长按 B 拨方向」的瞬时手势**：B 不是驾驶键，长按期间叠加临时轮盘，用方向拨动选项，松手即选，不长期占用驾驶键、不和驾驶冲突。同时把判定做准、UI 做成精致 Apple 玻璃风。

---

## 1. 手势流程（快速切歌主交互）

```
长按 B（驾驶/步行态）
   └─ showWheel()：唤出径向轮盘（瞬时叠加，不解锁鼠标、不占驾驶键）
       └─ 鼠标增量当摇杆（mousemove 累积 rwVX/rwVY），或方向键瞬时拨动 rwNudge()
           └─ rwUpdateAim()：实时算方向，对应扇区高亮放大 + 指针指向
   松开 B（keyup）
   └─ hideWheel(true)：在当前瞄准方向执行动作；死区内松手 = 取消
```

方向 → 动作映射：

| 拨动方向 | 动作 | audio.js 调用 |
|---|---|---|
| 右 → | 下一首 | `nextTrack()`（+ 必要时 `setMusicMode('playlist')`） |
| 左 ← | 上一首 | `prevTrack()` |
| 下 ↓ | 播 / 停 | `setMusic(true/false)` + `startPlaylist()` |
| 上 ↑ | 关闭（取消，无操作） | — |
| 死区内 | 取消 | — |

- ESC / 松手在死区内 = 取消（`hideWheel(false)`）。
- Enter（轮盘开启时）= 确认当前方向。
- 保留原 audio.js 调用：`setMusic / nextTrack / prevTrack / startPlaylist / toggleShuffle / getCurrentTrack`，未改 audio.js。

---

## 2. 新轮盘 UI（极简 Apple 玻璃）

毛玻璃 `backdrop-filter:blur(22px) saturate(1.35)`、冷白低饱和、细边 `var(--glass-border)`、圆角、柔和阴影、柔和淡入淡出，与新版 HUD 同质感。居中靠下（`bottom:16%`），松手即消失。

**HTML（markup 片段）**

```html
<div id="radioWheel">
  <div class="rw-disc"></div>
  <div class="rw-ptr" id="rwPtr"></div>
  <div class="rw-seg" data-dir="up"    id="rwUp"><span class="rw-ic">✕</span><span class="rw-lb">关闭</span></div>
  <div class="rw-seg" data-dir="right" id="rwRight"><span class="rw-ic">⏭</span><span class="rw-lb">下一首</span></div>
  <div class="rw-seg" data-dir="down"  id="rwDown"><span class="rw-ic">⏯</span><span class="rw-lb">播/停</span></div>
  <div class="rw-seg" data-dir="left"  id="rwLeft"><span class="rw-ic">⏮</span><span class="rw-lb">上一首</span></div>
  <div class="rw-hub">
    <div class="rw-mode" id="rwMode">歌单</div>
    <div class="rw-name" id="rwName">—</div>
    <div class="rw-state" id="rwState">NOW PLAYING</div>
  </div>
</div>
```

**CSS（关键片段）**

```css
#radioWheel{position:fixed;left:50%;bottom:16%;transform:translate(-50%,12px) scale(.92);
  z-index:44;width:248px;height:248px;pointer-events:none;
  opacity:0;transition:opacity .18s ease,transform .22s cubic-bezier(.2,.85,.25,1)}
#radioWheel.show{opacity:1;transform:translate(-50%,0) scale(1)}
.rw-disc{position:absolute;inset:0;border-radius:50%;
  background:radial-gradient(circle at 50% 38%,rgba(34,42,56,.30),rgba(16,20,30,.46));
  backdrop-filter:blur(22px) saturate(1.35);border:1px solid var(--glass-border);
  box-shadow:0 14px 44px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.10)}
/* 当前将选中扇区：高亮放大 + 冷白光晕 */
.rw-seg.active{background:rgba(120,170,255,.20);border-color:rgba(180,215,255,.55);
  color:#f3f9ff;box-shadow:0 0 18px rgba(120,170,255,.30),inset 0 1px 0 rgba(255,255,255,.16)}
.rw-seg[data-dir=up].active{transform:translateX(-50%) scale(1.16)}
/* 方向指针：从中心指向拨动方向 */
.rw-ptr{...transform-origin:50% 100%;
  background:linear-gradient(to top,rgba(120,170,255,0),rgba(180,215,255,.85));...}
```

视觉反馈：拨动方向时对应扇区 `.active` 高亮 + `scale(1.16)` 放大 + 冷白光晕，中心指针实时指向，柔和过渡。

---

## 3. 判定改进（死区 / 角度 / 迟滞）

旧版死区 28px + atan2 四象限映射生硬。本轮 `rwUpdateAim()`：

- **死区** `RW_DEAD = 30px`：拨出此半径才进入「瞄准」态；死区内松手 = 取消（不误选）。
- **角度映射**：屏幕 y 向下，取 `atan2(-vy, vx)` 归一到 `[0,360)`。象限划分：右 `[315,45)`、上 `[45,135)`、左 `[135,225)`、下 `[225,315)` —— 更跟手。
- **迟滞** `RW_HYST = 10°`：已选中某方向后，须越过「临界角 + 10°」才换向，临界角加缓冲带避免边界来回抖动跳变（diff 用环形角差计算）。
- **实时高亮**：每次 mousemove 即更新 active 扇区与指针角度，"拨一下就准确选中"。
- **半径上限** 120px：拨太远会被钳制，保证还能回到死区取消。

---

## 4. 常驻信息卡如何去冲突

- 移除上一轮 `#radioPanel` 那套与驾驶冲突的键盘控制（←/→/↑/↓/S 全部删掉，不再绑方向键）。
- 新增 `#radioInfo`：**仅驾驶态展示**（`body.drive #radioInfo{display:flex}`），`pointer-events:none`，**纯展示**当前模式 / 曲名 / 播放态（NOW PLAYING / PAUSED / LIVE RADIO），右侧提示「长按 B 拨选」。
- 不绑任何键盘事件、不抢驾驶键；快速切歌完全交给长按 B 轮盘。
- 信息卡内容仅在标签变化时写 DOM（`drawMinimap` 内缓存比对，避免逐帧冗余）。
- 旧 `#playlistbar`（仅鼠标点按、无键盘绑定）保留于车库等非驾驶场景，不冲突。

---

## 5. 不破坏既有键位

- ESC/F/C/R/T/P/M/H/V 与暂停逻辑保持原样；ESC 在轮盘开启时仅取消轮盘后 return。
- B 改为 keydown 唤出 / keyup 选中（`!e.repeat` 防长按重复唤出）。
- **pointerlock 不变**：轮盘是瞬时手势，用 mousemove 增量当摇杆，不解锁鼠标；移除了已失效的 `_radioUnlock` 解锁分支。

---

## 6. 构建 / 自检证据

- `npx vite build`：✓ built（50 modules，dist/index.html 26.78 kB）。
- Headless（Playwright + http 静态服务）：页面加载 **0 个 JS 运行错误**（仅 file:// 下的 CORS 噪声，http 下为 0）。
- DOM 自检：`radioWheel / rwPtr / rwUp/Right/Down/Left / rwMode/Name/State / radioInfo / riName` 全部存在。
- 判定映射自检：右→right、左→left、下→down、上→up、死区→dead，全部正确。
- 截图：`/tmp/wheel-final.png` —— 唤出轮盘，右扇区（下一首）高亮放大 + 冷白光晕，中心 hub 显示「歌单 / Year 3000 / NOW PLAYING」，指针指右。

## 7. 提交 / 分支

- author：Core5God <129576964+Core5God@users.noreply.github.com>
- 分支：`feat/radio-wheel-redo-20260621`
- commit：见 `git log`（下文回填）
