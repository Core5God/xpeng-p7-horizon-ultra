// perfMode.js —— 画质等级单一来源（task-20260625-001）
// 把原来的二档「高/低」(G.hiQuality true/false) 扩展成真正的三档 Low / Medium / High。
//
// 设计要点：
// - 用户可见画质等级 quality level：'low' | 'medium' | 'high'，本文件是唯一来源，
//   所有文件（ui.js / main.js / skycycle.js / world.js）统一从这里读，禁止各处再各算各的。
// - 兼容旧的 G.hiQuality 读取点：true→high、false→low，避免漏改导致运行时崩。
//   写入仍走 setQualityLevel；本文件内部把 G.hiQuality 同步成布尔派生值。
// - Mac/Retina 是高 DPR 填充率杀手：Medium 档在 Retina 上像素比强制压 1.0（绝不放开 1.25/1.5），
//   阴影仍 1024，只允许便宜的视觉提升（弱 bloom）。

import { G } from './core.js';

export const QUALITY_LEVELS = ['low', 'medium', 'high'];

// ---------- Mac / Retina 检测 ----------
// 高 DPR 的 Apple 设备（Retina）是动态像素比的主要受害者：屏幕 devicePixelRatio≥2，
// 一旦把渲染像素比放到 1.25/1.5，填充率成倍上升，Mac 集显/低功耗 GPU 直接掉断崖。
// 检测尽量保守：命中即按「需要压像素比」处理。无法判定时返回 false（按桌面独显放开）。
let _macRetinaCache = null;
export function detectMacRetina() {
  if (_macRetinaCache !== null) return _macRetinaCache;
  let isMac = false, hiDpr = false;
  try {
    const ua = (navigator.userAgent || '') + ' ' + (navigator.platform || '');
    // iPad 新系统 UA 伪装成 Mac；统一按 Apple 高 DPR 处理
    isMac = /Mac|iPhone|iPad|iPod/i.test(ua);
    hiDpr = (window.devicePixelRatio || 1) >= 1.5;
  } catch (e) { isMac = false; hiDpr = false; }
  _macRetinaCache = isMac && hiDpr;
  return _macRetinaCache;
}

// ---------- 三档参数表 ----------
// prCap        : 像素比上限（Math.min(devicePixelRatio, prCap)）
// prCapRetina  : Mac/Retina 下的像素比上限（覆盖 prCap，关键：Medium 在 Retina 必须 1.0）
// shadowSize   : 阴影贴图分辨率
// bloom        : 是否开启辉光（实际强度仍由各 TOD preset 的 bloom 值决定，这里是开关）
// dynamicPR    : 是否进入 main.js 的停车/低速抬像素比逻辑（仅 High 放开）
const LEVELS = {
  low: {
    label: '低',
    prCap: 1.0,
    prCapRetina: 1.0,
    shadowSize: 1024,
    bloom: false,
    dynamicPR: false,
  },
  medium: {
    label: '中',
    // 非 Retina/桌面可酌情允许像素比到 1.1（轻微抬，仍远低于 High 的 1.25/1.5）
    prCap: 1.1,
    // Mac/Retina 关键约束：固定 1.0，绝不放开
    prCapRetina: 1.0,
    shadowSize: 1024,
    // 便宜视觉提升：弱 bloom（强度在 bloomScale 里再打折）
    bloom: true,
    bloomScale: 0.55,
    dynamicPR: false,
  },
  high: {
    label: '高',
    prCap: 1.25,
    prCapRetina: 1.25, // 独显机器（5070ti 等）放开
    shadowSize: 2048,
    bloom: true,
    bloomScale: 1.0,
    dynamicPR: true,
  },
};

// ---------- 等级读写（单一来源） ----------
export function getQualityLevel() {
  const lvl = G.qualityLevel;
  return LEVELS[lvl] ? lvl : 'high';
}

export function getLevelParams(level) {
  return LEVELS[level] || LEVELS[getQualityLevel()];
}

// 把等级写进 G，并同步派生的旧 hiQuality 布尔（high→true，其余→false），保证旧读取点不崩
export function setQualityLevel(level) {
  if (!LEVELS[level]) level = 'high';
  G.qualityLevel = level;
  G.hiQuality = (level === 'high'); // 兼容派生值
  return level;
}

// 兼容入口：旧代码若仍调 setQuality(true/false)，映射到 high/low
export function levelFromLegacyBool(hi) {
  return hi ? 'high' : 'low';
}

// ---------- 各文件统一读取的派生量 ----------
// 像素比上限：Mac/Retina 命中时用 prCapRetina。
export function pixelRatioCap(level) {
  const p = getLevelParams(level || getQualityLevel());
  return detectMacRetina() ? p.prCapRetina : p.prCap;
}

// 实际可设的像素比（已和设备 devicePixelRatio 取小）
export function effectivePixelRatio(level) {
  let dpr = 1;
  try { dpr = window.devicePixelRatio || 1; } catch (e) { dpr = 1; }
  return Math.min(dpr, pixelRatioCap(level));
}

export function shadowMapSize(level) {
  return getLevelParams(level || getQualityLevel()).shadowSize;
}

export function bloomEnabled(level) {
  return !!getLevelParams(level || getQualityLevel()).bloom;
}

// bloom 强度缩放：High=1.0 全开，Medium 弱开，Low=0（关）
export function bloomStrengthScale(level) {
  const p = getLevelParams(level || getQualityLevel());
  if (!p.bloom) return 0;
  return p.bloomScale != null ? p.bloomScale : 1.0;
}

// 是否允许 main.js 的动态像素比（停车/低速抬清晰度）逻辑。仅 High 放开。
// Medium / Low 一律不进入抬像素比逻辑，尤其 Medium on Mac Retina 必须固定在 effectivePixelRatio。
export function dynamicPixelRatioAllowed(level) {
  return !!getLevelParams(level || getQualityLevel()).dynamicPR;
}

// 自动降级：逐级下降（high→medium→low），不再一次性掉到 low。返回降级后的等级，已到底返回 null。
export function stepDownLevel(level) {
  const cur = level || getQualityLevel();
  if (cur === 'high') return 'medium';
  if (cur === 'medium') return 'low';
  return null;
}

export function levelLabel(level) {
  return getLevelParams(level || getQualityLevel()).label;
}
