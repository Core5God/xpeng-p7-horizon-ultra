// ---------- HMI Design Tokens (Stage 3.1 → 3.2.1) ----------
// 统一的 HMI 视觉语言基线：字体 / 字号(clamp 自适应,4K 不碎) / 玻璃 / 文本层级 / 动效。
// 提炼自 Slow Roads 的安静极简 + 智能电车车机 HMI 质感：
//   巨大留白 / 低饱和 / 细线 / 超轻字体 / 大字距 / 少装饰 / 靠位置层级表达信息。
// 只建立 tokens + 注入 :root CSS 变量，供 hmiDrivingHud 与后续阶段统一引用。
// 不重排所有 UI、不动游戏逻辑、不动路口、不动世界资产。
// PR3.2.1：cockpit display band 视觉规格沉淀（band 几何 / 冷调色板 / 文字双层冷蓝发光）。

export const HMI = {
  font: {
    family: "'Inter','SF Pro Display',system-ui,sans-serif",
    mono: "'SF Mono','Roboto Mono',monospace",
  },
  // clamp(min, preferred(vw), max) —— 随视口缩放，4K 下不碎、不过大。
  scale: {
    base: 'clamp(14px,0.72vw,22px)',
    small: 'clamp(10px,0.48vw,14px)',
    label: 'clamp(9px,0.42vw,12px)',
    speed: 'clamp(48px,4.2vw,118px)',
    // —— PR3.2.1 cockpit band 字号（主数字 / 次数字 / 标签，字距 .16em-.28em）——
    bandNum: 'clamp(28px,3.2vw,72px)',
    bandNum2: 'clamp(18px,1.6vw,34px)',
    bandLabel: 'clamp(9px,0.72vw,14px)',
  },
  glass: {
    bg: 'rgba(10,14,18,0.32)',
    border: 'rgba(255,255,255,0.12)',
    blur: '18px',
    radius: '28px',
    // —— PR3.2.1 cockpit display band token：冷白/低饱和蓝白，克制不过曝 ——
    bandBg: 'rgba(8,14,18,0.26)',            // 玻璃底（深、透）
    bandBorder: 'rgba(210,235,255,0.14)',    // 顶沿 hairline border-top
    bandEdge: 'rgba(160,215,255,0.18)',      // 边缘光（cockpit display 边）
    bandGlow: 'rgba(100,180,255,0.12)',      // 弱蓝光（外发光 / 底部 radial）
    bandBlur: '18px',                         // backdrop-filter blur
    bandSat: '125%',                          // backdrop-filter saturate
    bandRadius: '40px',                       // 备用上沿圆角（实际用 40%/100% 椭圆）
    // band 几何（贴底、低位、宽居中、轻微环绕）
    bandW: 'min(88vw,1760px)',
    bandH: 'clamp(78px,7.2vw,132px)',
    bandBottom: 'max(28px,env(safe-area-inset-bottom))',
  },
  text: {
    primary: 'rgba(255,255,255,.88)',
    secondary: 'rgba(255,255,255,.48)',
    tertiary: 'rgba(255,255,255,.24)',
    // —— PR3.2.1 cockpit band 冷调文本层级 ——
    bandPrimary: 'rgba(236,248,255,.92)',    // 主文字（时速/电量值）
    bandSecondary: 'rgba(190,215,225,.58)',  // 次文字（标签/单位）
    bandAccent: 'rgba(170,220,255,.78)',     // 青蓝高亮值
  },
  glow: {
    // 电子屏文字克制双层冷蓝发光（夜晚 VP7 不过曝）
    bandText: '0 0 6px rgba(170,220,255,.22),0 0 18px rgba(120,190,255,.10)',
    bandTextSoft: '0 0 4px rgba(170,220,255,.14)',
  },
  motion: {
    fast: '180ms ease',
    normal: '360ms ease',
    slow: '640ms ease',
  },
};

// 把上面的 tokens 拍平成 :root CSS 变量名，便于在样式表 / 注入模块里统一引用。
// 命名规则：--hmi-<group>-<key>，如 --hmi-font / --hmi-scale-speed / --hmi-glass-bandBg。
function flattenTokens(tokens) {
  const vars = {};
  for (const group of Object.keys(tokens)) {
    const entries = tokens[group];
    for (const key of Object.keys(entries)) {
      // font.family / font.mono 简化为 --hmi-font / --hmi-font-mono，其余 --hmi-<group>-<key>
      let name;
      if (group === 'font') {
        name = key === 'family' ? '--hmi-font' : `--hmi-font-${key}`;
      } else {
        name = `--hmi-${group}-${key}`;
      }
      vars[name] = entries[key];
    }
  }
  return vars;
}

let installed = false;

// 生成一个 <style> 把 HMI tokens 注入成 :root CSS 变量。幂等：重复调用只注入一次。
export function installHmiTokens(tokens = HMI) {
  if (installed) return;
  if (typeof document === 'undefined') return;
  installed = true;

  const vars = flattenTokens(tokens);
  const decl = Object.keys(vars)
    .map((name) => `    ${name}: ${vars[name]};`)
    .join('\n');

  const style = document.createElement('style');
  style.id = 'hmi-design-tokens';
  style.textContent = `:root{\n${decl}\n}`;
  document.head.appendChild(style);
}

// 便于调试 / 后续模块直接拿到拍平后的变量映射。
export function getHmiVars(tokens = HMI) {
  return flattenTokens(tokens);
}
