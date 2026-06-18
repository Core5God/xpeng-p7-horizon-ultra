// ---------- 天空 HDR 资产语义映射 ----------
// 把 HDR 文件名映射到语义化的天气/时段 preset
// 避免在 skycycle.js 中硬编码 KEYS

export const SKY_PRESETS = {
  day_clear: {
    file: 'day3',
    tod: 'day',
    weather: 'clear',
    dir: [0, 0.33, 0.95],
    sunC: 0xfff4e0, sunI: 7.0,
    hemiC: 0xcfe5ff, hemiI: 1.3,
    fog: 0xaec6da, exp: 0.85, envI: 1.5,
    water: 0x0d4a66, bloom: 0.04,
    night: 0, grd: 0x9a875c
  },
  day_cloudy: {
    file: 'day2',
    tod: 'day',
    weather: 'cloudy',
    dir: [0.79, 0.12, 0.60],
    sunC: 0xdfe6ee, sunI: 3.0,
    hemiC: 0xc8d2dc, hemiI: 1.6,
    fog: 0xc2c8cf, exp: 1.0, envI: 1.5,
    water: 0x294a5a, bloom: 0.03,
    night: 0, grd: 0x6f6a5e
  },
  dusk_warm: {
    file: 'evening',
    tod: 'dusk',
    weather: 'warm',
    dir: [0.05, 0.09, 0.99],
    sunC: 0xffc792, sunI: 6.0,
    hemiC: 0xffd9b0, hemiI: 1.3,
    fog: 0xcf7a72, exp: 0.88, envI: 1.2,
    water: 0x06283a, bloom: 0.08,
    night: 0, grd: 0x6e5a44
  },
  night_clear: {
    file: 'night2',
    tod: 'night',
    weather: 'clear',
    dir: [0.016, 0.45, 0.89],
    sunC: 0x9fb6e0, sunI: 1.2,
    hemiC: 0x2a3a55, hemiI: 0.6,
    fog: 0x141d2e, exp: 1.20, envI: 0.85,
    water: 0x04141f, bloom: 0.25,
    night: 1, grd: 0x20242e
  },
  night_cloudy: {
    file: 'night1',
    tod: 'night',
    weather: 'cloudy',
    dir: [0.32, 0.945, 0.04],
    sunC: 0x8aa0cc, sunI: 0.8,
    hemiC: 0x223355, hemiI: 0.5,
    fog: 0x0a1020, exp: 1.25, envI: 0.70,
    water: 0x02101a, bloom: 0.25,
    night: 1, grd: 0x171a22
  }
};

// 预计算 THREE.Color 对象（避免每帧 new）
import * as THREE from 'three';
for (const key of Object.keys(SKY_PRESETS)) {
  const p = SKY_PRESETS[key];
  p._sunC = new THREE.Color(p.sunC);
  p._hemiC = new THREE.Color(p.hemiC);
  p._fog = new THREE.Color(p.fog);
  p._water = new THREE.Color(p.water);
  p._grd = new THREE.Color(p.grd);
  p._dir = new THREE.Vector3(...p.dir).normalize();
}

// 各时段兼容的天气列表
export const TOD_COMPATIBLE = {
  day:   ['day_clear', 'day_cloudy'],
  dusk:  ['dusk_warm'],
  night: ['night_clear', 'night_cloudy'],
  dawn:  ['dusk_warm']  // 复用黄昏 HDR 做黎明（低亮度）
};

// 获取指定时段的所有 preset
export function getCompatiblePresets(todPhase) {
  return TOD_COMPATIBLE[todPhase] || TOD_COMPATIBLE.day;
}

// 随机选择一个天气（避免连续相同）
export function pickRandomWeather(todPhase, prevWeather) {
  const list = (TOD_COMPATIBLE[todPhase] || TOD_COMPATIBLE.day).filter(w => w !== prevWeather);
  if (list.length === 0) return (TOD_COMPATIBLE[todPhase] || TOD_COMPATIBLE.day)[0];
  return list[Math.floor(Math.random() * list.length)];
}
