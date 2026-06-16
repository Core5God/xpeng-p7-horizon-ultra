# Mixamo FBX → 单个多动画 GLB → Three.js 角色集成 · 实操规范
*已在「地平线海岸 ULTRA」(Three.js r169 / Vite) 跑通，可直接交给 Codex 复用。*

---

## 0. 结论速览（已验证）
- 6 个 Mixamo FBX（每个 ~21MB，含蒙皮+内嵌贴图）→ 合并为一个 `character.glb`，**1.66MB**，含 6 段动画 `idle / walk / run / jump / turn / startstop`。
- 工具链全部 **纯 npm（无需 Blender）**：`fbx2gltf`（Meta 官方转换器，含各平台二进制）+ `@gltf-transform/*`（合并/优化）+ `sharp`（贴图压缩）。
- 集成在 `src/character.js`，按 **F 键**在驾驶/步行间切换。

> ⚠️ **教训：不要用 assimp / assimpjs 转 Mixamo 蒙皮动画 FBX。** assimp 会插入 `mixamorig:Xxx_$AssimpFbx$_PreRotation/_Translation` 轴心辅助节点，导致 Three.js 里蒙皮绑定错乱——角色四肢被拉成细条、整体倒置（"炸开"）。必须用 **FBX2glTF**，它会把 FBX 轴心烘焙进节点、输出干净骨架（0 个 `$AssimpFbx$` 节点）、单位自动转米、Y-up 直立。

---

## 1. FBX → GLB（逐个转换，用 FBX2glTF）
Mixamo 只导 FBX。安装 `npm i fbx2gltf`，它自带各平台二进制（`node_modules/fbx2gltf/bin/{Linux,Darwin,Windows_NT}/FBX2glTF`）。逐个转：

```bash
chmod +x node_modules/fbx2gltf/bin/Linux/FBX2glTF
node_modules/fbx2gltf/bin/Linux/FBX2glTF -i "Breathing Idle.fbx" -o out/idle --binary
# 输出 out/idle.glb（--binary = glb；不加则输出 .gltf+.bin）
```

**为什么是它**：FBX2glTF 输出**干净骨架**（0 个 `$AssimpFbx$` 节点）、**单位自动转米**（角色 ~1.7m）、**Y-up 直立**、脚底约在 y=0、蒙皮正确。校验：
- `nodes` 里 `$AssimpFbx$` 计数 = 0
- 动画通道数 ≈ 真实骨骼数（本例 53，不是 assimp 的 156 虚数）
- 动画名为 `"mixamo.com"` → 合并时重命名
- 会顺带跳过空的 `Take 001` 轨道（正常警告）

## 2. 合并为单个多动画 GLB（核心）
思路：以 idle.glb 为底（保留**唯一**一份 mesh+skin+骨架），把其余文件的**动画**复制进来，按**节点名**重新绑定到底文件的骨骼。用 `@gltf-transform/core`：

```js
const { NodeIO } = require('@gltf-transform/core');
const io = new NodeIO();
const base = await io.read('idle.glb');
const r = base.getRoot();
r.listAnimations()[0].setName('idle');
const buffer = r.listBuffers()[0];
const byName = new Map();
r.listNodes().forEach(n => byName.has(n.getName()) || byName.set(n.getName(), n));

for (const [file, name] of [['walk','walk'],['run','run'],['jump','jump'],['turn','turn'],['startstop','startstop']]) {
  const src = await io.read(file + '.glb');
  const sAnim = src.getRoot().listAnimations()[0];
  const anim = base.createAnimation(name);
  const smap = new Map();
  for (const s of sAnim.listSamplers()) {
    const ni = base.createAccessor().setType(s.getInput().getType()).setArray(s.getInput().getArray().slice()).setBuffer(buffer);
    const no = base.createAccessor().setType(s.getOutput().getType()).setArray(s.getOutput().getArray().slice()).setBuffer(buffer);
    const ns = base.createAnimationSampler().setInput(ni).setOutput(no).setInterpolation(s.getInterpolation());
    anim.addSampler(ns); smap.set(s, ns);
  }
  for (const c of sAnim.listChannels()) {
    const bn = byName.get(c.getTargetNode().getName());
    if (!bn) continue;                      // 名字对不上的通道跳过
    anim.addChannel(base.createAnimationChannel().setTargetNode(bn).setTargetPath(c.getTargetPath()).setSampler(smap.get(c.getSampler())));
  }
}
await io.write('character_raw.glb', base);
```
> 验证：每段都应 `matched 156 / missed 0`（156 = 该骨架的动画通道数，随模型而异）。

## 3. 优化（贴图是大头）
原始 24.7MB 里 18MB 是两张 **4096² PNG**（Diffuse + Normal）。用 sharp 把贴图降到 1024 并转 WebP（Three.js r169 原生支持 `EXT_texture_webp`）：

```js
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { textureCompress, dedup, weld, prune } = require('@gltf-transform/functions');
const sharp = require('sharp');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);   // ★ 必须注册扩展，否则 webp 写不出去
const doc = await io.read('character_raw.glb');
await doc.transform(
  dedup(), weld(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
  prune(),
);
await io.write('character.glb', doc);   // → 2.36MB
```
**坑**：不 `registerExtensions(ALL_EXTENSIONS)` 会报 "extensions ... will not be written"，webp 贴图引用失效、模型变白。若不想用 webp，则 `targetFormat:'jpeg'`（basecolor）+ normal 保持 png，可免扩展。

## 4. Three.js 集成要点（见 `src/character.js`）
- **缩放/落脚**：FBX2glTF 输出已是 **Y-up 直立、米制**，**不要**再加"躺平翻转"启发式（那正是把角色翻倒的元凶）。只需：
  - `model.updateMatrixWorld(true)` 后取包围盒；
  - `scale = 目标身高 / size.y`（本项目 1.78m）；
  - 重新算包围盒，`position.x/z -= center`，`position.y -= box.min.y`（脚底落 y=0）。
- **朝向**：常量 `FORWARD_OFFSET`。模型"倒着走"就改成 `Math.PI`（Mixamo 经 assimp 后朝向不固定，肉眼校一次即可）。
- **动画**：`AnimationMixer(model)`，按 `clip.name` 取 `idle/walk/run/...`；`jump` 设 `LoopOnce + clampWhenFinished`。状态机按速度选 idle/walk/run，`fadeIn/fadeOut(0.18)` 交叉淡入；`setEffectiveTimeScale` 让步频随速度走、减少滑步。
- **贴地**：复用世界的 `surfaceHeight(x,z)`（路面/地形统一表面），跳跃叠加垂直速度+重力。
- `mesh.frustumCulled = false`：骨骼动画包围盒易误判导致整体消失，关掉视锥剔除。
- **接入循环**：`G.appState` 增加 `'walk'` 分支；`F` 键在 `drive`/`walk` 间切换并重置追车相机阻尼。

## 5. 给 Codex 的最小指令
> 把这 N 个 Mixamo FBX（同角色同骨架）合并成**一个 GLB**：用 **FBX2glTF**（`npm i fbx2gltf`，**不要用 assimp**）逐个 `-i x.fbx -o out/x --binary` → 以 idle 为底、用 @gltf-transform 把其余动画按节点名复制进来并重命名 `idle/walk/run/...` → registerExtensions(ALL_EXTENSIONS) 后用 sharp 把贴图压到 1024/webp（**不要 weld**，蒙皮网格会出问题）→ 输出。验收：`gltf.animations.length === N`、单 SkinnedMesh、`$AssimpFbx$` 节点为 0、gltf-viewer 里能播全部动画且**蒙皮不炸**。

## 6. 待人工确认（本次集成）
- 角色**朝向**是否正确（倒着走就翻 `FORWARD_OFFSET`）。
- **Walking / Fast Run 当时是否勾了 In Place**；没勾会有轻微滑步，需在合并前去掉根位移轨道。
- 身高/比例、脚底贴地观感。
