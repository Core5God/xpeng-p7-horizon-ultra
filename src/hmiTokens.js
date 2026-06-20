// ---------- HMI Design Tokens (Stage 3.1) ----------
// 统一的 HMI 视觉语言基线：字体 / 字号(clamp 自适应,4K 不碎) / 玻璃 / 文本层级 / 动效。
// 提炼自 Slow Roads 的安静极简 + 智能电车车机 HMI 质感：
//   巨大留白 / 低饱和 / 细线 / 超轻字体 / 大字距 / 少装饰 / 靠位置层级表达信息。
// 只建立 tokens + 注入 :root CSS 变量，供 hmiDrivingHud 与后续阶段统一引用。
// 不重排所有 UI、不动游戏逻辑、不动路口、不动世界资产。

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
  },
  glass: {
    bg: 'rgba(10,14,18,0.32)',
    border: 'rgba(255,255,255,0.12)',
    blur: '18px',
    radius: '28px',
    // —— cockpit 信息带（OLED/Mini-LED 屏感）专用 glass token，克制不过曝 ——
    bandBg: 'rgba(12,16,22,0.36)',          // 深灰半透明底
    bandBorder: 'rgba(255,255,255,0.10)',   // 容器细边
    bandBlur: '22px',                        // 玻璃模糊
    bandHairline: 'rgba(255,255,255,0.34)', // 顶沿一条细高光
    bandRadius: '40px',                      // 上沿大圆角(弧面感)
    bandGlow: 'rgba(120,170,255,0.10)',     // 极轻科技蓝外发光
    accent: 'rgba(168,206,255,0.85)',        // 数字科技蓝/青白微光
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

// 把上面的 tokens 拍平成 :root CSS 变量名，便于在样式表 / 注入模块里统一引用。
// 命名规则：--hmi-<group>-<key>，如 --hmi-font / --hmi-scale-speed / --hmi-glass-bg。
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
