// ---------- HMI Design Tokens (Stage 3.1 → 3.2.2) ----------
// 统一的 HMI 视觉语言基线：字体 / 字号(clamp 自适应,4K 不碎) / 玻璃 / 文本层级 / 动效。
// HMI Recovery (20260620)：拆掉整块厚黑底栏，改成「左/中/右 三个独立信息岛 + 一条贴底细弧光」。
//   背景接近无底（仅极淡薄玻璃），整体轻/透/薄/安静，让车与路重新成为主角。

export const HMI = {
  font: {
    family: "'Inter','SF Pro Display',system-ui,sans-serif",
    mono: "'SF Mono','Roboto Mono',monospace",
  },
  scale: {
    base: 'clamp(14px,0.72vw,22px)',
    small: 'clamp(10px,0.48vw,14px)',
    label: 'clamp(9px,0.42vw,12px)',
    speed: 'clamp(48px,4.2vw,118px)',
    socNum: 'clamp(30px,2.7vw,60px)',
    rangeNum: 'clamp(16px,1.25vw,28px)',
    // 右侧车速数字（透视等高校准 20260621 / task-006）：上一轮放大到 clamp(78,6.6vw,150) 后，
    // 在 headless 实测中右侧 .hmi-speed-num 透视投影高度=143.7px，而左侧电量大数字 .hmi-soc(98) 投影仅 70.7px，
    // 比值高达 2.03×——明显过大（根因：左右块各带 rotateY ±38deg 透视斜切，靠原始字号比拉太开就会失衡）。
    // 校准目标：右侧车速「89」透视后表观高度 ≈ 左侧电量「98」的 1.0~1.3 倍（车速是主信息可略大，但不能两倍多）。
    // 调回 clamp(44,3.8vw,84)：headless getBoundingClientRect 实测 4 档分辨率比值稳定在 1.08~1.12×（详见交付文档），
    // 与左侧大数字基本等高、仅微大一档；KM/H 与挡位 D 仍贴基线 nowrap 不裁切。
    speedNum: 'clamp(44px,3.8vw,84px)',
    labelTiny: 'clamp(9px,0.44vw,11px)',
  },
  glass: {
    bg: 'rgba(10,14,18,0.32)',
    border: 'rgba(255,255,255,0.12)',
    blur: '18px',
    radius: '28px',
    // 信息岛极淡薄玻璃（透明度 ≤0.12）；接近无底。
    islandBg: 'rgba(14,20,30,0.10)',
    islandBlur: '7px',
    islandBorder: 'rgba(180,215,255,0.10)',
    // 贴底曲面弧光（cockpit screen edge）—唯一的「屏感」载体。
    arcLine: 'rgba(196,228,255,0.55)',
    arcGlow: 'rgba(130,185,255,0.30)',
    accent: 'rgba(168,206,255,0.92)',
    accentSoft: 'rgba(168,206,255,0.42)',
  },
  text: {
    primary: 'rgba(255,255,255,.88)',
    secondary: 'rgba(255,255,255,.48)',
    tertiary: 'rgba(255,255,255,.24)',
  },
  motion: {
    fast: '180ms ease',
    normal: '360ms ease',
    slow: '640ms ease',
  },
};

function flattenTokens(tokens) {
  const vars = {};
  for (const group of Object.keys(tokens)) {
    const entries = tokens[group];
    for (const key of Object.keys(entries)) {
      let name;
      if (group === 'font') name = key === 'family' ? '--hmi-font' : `--hmi-font-${key}`;
      else name = `--hmi-${group}-${key}`;
      vars[name] = entries[key];
    }
  }
  return vars;
}

let installed = false;
export function installHmiTokens(tokens = HMI) {
  if (installed) return;
  if (typeof document === 'undefined') return;
  installed = true;
  const vars = flattenTokens(tokens);
  const decl = Object.keys(vars).map((n) => `    ${n}: ${vars[n]};`).join('\n');
  const style = document.createElement('style');
  style.id = 'hmi-design-tokens';
  style.textContent = `:root{\n${decl}\n}`;
  document.head.appendChild(style);
}
export function getHmiVars(tokens = HMI) { return flattenTokens(tokens); }
