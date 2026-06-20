// ---------- HMI Design Tokens (Stage 3.1 → 3.2.2) ----------
// 统一的 HMI 视觉语言基线：字体 / 字号(clamp 自适应,4K 不碎) / 玻璃 / 文本层级 / 动效。
// PR3.2.2 对 cockpit band 做信息结构与质感微调：两侧渐隐、左侧 Energy/Range
//   放大成主信息（细能量条占位）、中间路线预览 + AUTOSTEER、右侧速度档位强化层级。

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
    socNum: 'clamp(34px,3.0vw,72px)',
    rangeNum: 'clamp(22px,1.7vw,42px)',
    speedNum: 'clamp(54px,4.6vw,128px)',
    labelTiny: 'clamp(9px,0.46vw,12px)',
  },
  glass: {
    bg: 'rgba(10,14,18,0.32)',
    border: 'rgba(255,255,255,0.12)',
    blur: '18px',
    radius: '28px',
    bandBg: 'rgba(10,14,20,0.22)',
    bandBorder: 'rgba(255,255,255,0.08)',
    bandBlur: '20px',
    bandHairline: 'rgba(220,235,255,0.32)',
    bandRadius: '40px',
    bandGlow: 'rgba(120,170,255,0.10)',
    bandEdge: 'rgba(120,180,255,0.32)',
    accent: 'rgba(168,206,255,0.85)',
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
