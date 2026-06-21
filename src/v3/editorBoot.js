// Horizon V3 — editor bootstrap (?edit=1) PR1
// task-20260621-V3-PR1
// 汇总 editor 三个分片（class + interaction + draw），对外暴露 launchEditor。

import { TrackEditor } from './editor.js';
import './editorInteract.js'; // 扩展原型：交互 + IO
import './editorDraw.js';     // 扩展原型：绘制

export function launchEditor() {
  document.body.style.margin = '0';
  const ed = new TrackEditor(document.body);
  window.__v3editor = ed; // 便于 headless / 控制台调试
  // 自动尝试载入仓库里的初始环线
  ed._loadDefault();
  return ed;
}
