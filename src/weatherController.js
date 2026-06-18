// ---------- 随机天气状态机 ----------
// 慢速昼夜循环（12 分钟一整天）+ 随机天气状态
// 替代旧的 84 秒固定 HDR 轮播

import { SKY_PRESETS, pickRandomWeather, TOD_COMPATIBLE } from './skyPresets.js';

const DEFAULT_CONFIG = {
  dayLengthSec: 720,       // 12 分钟一整天
  weatherMinSec: 180,      // 天气最短持续 3 分钟
  weatherMaxSec: 420,      // 天气最长持续 7 分钟
  transitionSec: 25,       // 天气过渡 25 秒
  startWeather: 'day_clear'
};

export class WeatherController {
  constructor(config) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    this.dayLengthSec = cfg.dayLengthSec;
    this.weatherMinSec = cfg.weatherMinSec;
    this.weatherMaxSec = cfg.weatherMaxSec;
    this.transitionSec = cfg.transitionSec;

    this.time = 0;
    this.todPhase = 'day';
    this.todT = 0;          // 当前阶段内进度 0-1

    this.currentWeather = cfg.startWeather;
    this.nextWeather = null;

    this.weatherTimer = 0;
    this.weatherDuration = this._randomDuration();

    this.inTransition = false;
    this.transitionTimer = 0;
  }

  _randomDuration() {
    return this.weatherMinSec + Math.random() * (this.weatherMaxSec - this.weatherMinSec);
  }

  _getTodPhase(t) {
    const p = (t % this.dayLengthSec) / this.dayLengthSec;
    if (p < 0.55) return { phase: 'day',   localT: p / 0.55 };
    if (p < 0.67) return { phase: 'dusk',  localT: (p - 0.55) / 0.12 };
    if (p < 0.92) return { phase: 'night', localT: (p - 0.67) / 0.25 };
    return               { phase: 'dawn',  localT: (p - 0.92) / 0.08 };
  }

  update(dt) {
    this.time += dt;
    const { phase, localT } = this._getTodPhase(this.time);
    const prevPhase = this.todPhase;
    this.todPhase = phase;
    this.todT = localT;

    // 时段变化 → 强制切换到该时段兼容的天气
    if (phase !== prevPhase) {
      this.currentWeather = pickRandomWeather(phase, this.currentWeather);
      this.nextWeather = null;
      this.inTransition = false;
      this.transitionTimer = 0;
      this.weatherTimer = 0;
      this.weatherDuration = this._randomDuration();
    }

    if (this.inTransition) {
      this.transitionTimer += dt;
      if (this.transitionTimer >= this.transitionSec) {
        this.currentWeather = this.nextWeather;
        this.nextWeather = null;
        this.inTransition = false;
        this.transitionTimer = 0;
        this.weatherTimer = 0;
        this.weatherDuration = this._randomDuration();
      }
    } else {
      this.weatherTimer += dt;
      // 白天和夜晚允许随机切换天气；黄昏/黎明保持固定
      if (this.weatherTimer >= this.weatherDuration && (phase === 'day' || phase === 'night')) {
        const compat = TOD_COMPATIBLE[phase] || TOD_COMPATIBLE.day;
        if (compat.length > 1) {
          this.nextWeather = pickRandomWeather(phase, this.currentWeather);
          this.inTransition = true;
          this.transitionTimer = 0;
        } else {
          this.weatherTimer = 0;
          this.weatherDuration = this._randomDuration();
        }
      }
    }
  }

  getState() {
    const A = this.currentWeather;
    const B = this.inTransition ? this.nextWeather : this.currentWeather;
    const blend = this.inTransition
      ? Math.min(this.transitionTimer / this.transitionSec, 1)
      : 0;

    // nightAmount：0=白天, 1=深夜
    let nightAmount = 0;
    if (this.todPhase === 'dusk') nightAmount = this.todT * 0.8;
    else if (this.todPhase === 'night') nightAmount = 0.8 + this.todT * 0.2;
    else if (this.todPhase === 'dawn') nightAmount = 1.0 - this.todT;

    return {
      todPhase: this.todPhase,
      todT: this.todT,
      currentPreset: A,
      nextPreset: B,
      blend,
      nightAmount,
      weatherChanged: this.inTransition && this.transitionTimer < 0.1
    };
  }
}
