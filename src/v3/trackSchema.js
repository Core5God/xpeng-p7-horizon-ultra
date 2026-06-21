// Horizon V3 — Track JSON schema (PR1, grey-box closed loop)
// task-20260621-V3-PR1
//
// 顶层字段：schemaVersion / author / updatedAt / sourceTrackRevision
// controlPoints[]：id / pos{x,y,z} / roadWidth / bankDeg / tags[] / vpAnchor?
// segments[]：相邻控制点之间的语义段（本棒只存，不做物理）
// settings：chunkLength / viewAheadChunks / viewBehindChunks / terrainFollowRadius
//
// schema 参考已归档的 GPT deep-research 报告示例结构。

export const SCHEMA_VERSION = '3.0.0-pr1';

// PR1 必须预埋的 6 个物理/语义标签（供下一棒腾空物理用，本棒只能打 + 存 JSON）
export const PHYSICS_TAGS = [
  'crest',         // 山顶/拱起（车头抬升点）
  'jump_test',     // 测试性起跳点
  'bridge_bump',   // 桥面接缝跳动
  'downhill_drop', // 下坡骤降
  'landing_zone',  // 落地缓冲区
  'no_airborne',   // 禁止腾空（强制贴地）
];

// 语义/地标标签（landmark / VP 锚点用），不参与物理
export const LANDMARK_TAGS = [
  'start',         // 起点基地
  'valley',        // 山谷
  'hairpin',       // 发卡弯
  'summit',        // 山顶俯瞰
  'cave',          // 洞穴/隧道入口（本棒只标记）
  'tunnel',        // 隧道（本棒只标记）
  'coast_sunrise', // 海边日出段
  'harbor_sunset', // 港湾日落段
  'bridge',        // 桥（自交叉处未来转桥）
];

export const ALL_TAGS = [...LANDMARK_TAGS, ...PHYSICS_TAGS];

export const DEFAULT_SETTINGS = {
  chunkLength: 200,        // 沿弧长分块的块长（米）—— 供 PR3 流式用
  viewAheadChunks: 6,      // 前向可见块数
  viewBehindChunks: 2,     // 后向可见块数
  terrainFollowRadius: 60, // 地形跟随路面的影响半径（米）
};

let _uid = 0;
export function newCpId() {
  _uid += 1;
  return `cp_${Date.now().toString(36)}_${_uid}`;
}

// 创建一个空白 track（编辑器初始态）
export function emptyTrack(author = 'editor') {
  return {
    schemaVersion: SCHEMA_VERSION,
    author,
    updatedAt: new Date().toISOString(),
    sourceTrackRevision: 0,
    controlPoints: [],
    segments: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

// 创建一个控制点
export function makeControlPoint(x, y, z, opts = {}) {
  return {
    id: opts.id || newCpId(),
    pos: { x, y: y || 0, z },
    roadWidth: opts.roadWidth != null ? opts.roadWidth : 12,
    bankDeg: opts.bankDeg != null ? opts.bankDeg : 0,
    tags: Array.isArray(opts.tags) ? opts.tags.slice() : [],
    vpAnchor: opts.vpAnchor || null, // 'VP0' | 'VP1' | 'VP5' | null
  };
}

// 校验 track 结构（返回 {ok, errors[], warnings[]}）
export function validateTrack(track) {
  const errors = [];
  const warnings = [];
  if (!track || typeof track !== 'object') {
    return { ok: false, errors: ['track 不是对象'], warnings };
  }
  if (!track.schemaVersion) warnings.push('缺少 schemaVersion');
  if (!Array.isArray(track.controlPoints)) {
    errors.push('controlPoints 不是数组');
  } else {
    if (track.controlPoints.length < 3) {
      errors.push('闭合环线至少需要 3 个控制点');
    }
    track.controlPoints.forEach((cp, i) => {
      if (!cp.pos || typeof cp.pos.x !== 'number' || typeof cp.pos.z !== 'number') {
        errors.push(`控制点 #${i} pos 非法`);
      }
      if (typeof cp.roadWidth !== 'number' || cp.roadWidth <= 0) {
        warnings.push(`控制点 #${i} roadWidth 非法，已回退默认`);
      }
    });
  }
  if (!track.settings) warnings.push('缺少 settings，已回退默认');
  return { ok: errors.length === 0, errors, warnings };
}

// 规范化：补默认字段，保证后续模块拿到完整结构
export function normalizeTrack(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const out = {
    schemaVersion: t.schemaVersion || SCHEMA_VERSION,
    author: t.author || 'unknown',
    updatedAt: t.updatedAt || new Date().toISOString(),
    sourceTrackRevision: typeof t.sourceTrackRevision === 'number' ? t.sourceTrackRevision : 0,
    controlPoints: [],
    segments: Array.isArray(t.segments) ? t.segments : [],
    settings: { ...DEFAULT_SETTINGS, ...(t.settings || {}) },
  };
  const cps = Array.isArray(t.controlPoints) ? t.controlPoints : [];
  out.controlPoints = cps.map((cp) => makeControlPoint(
    cp.pos ? cp.pos.x : 0,
    cp.pos ? cp.pos.y : 0,
    cp.pos ? cp.pos.z : 0,
    {
      id: cp.id,
      roadWidth: cp.roadWidth,
      bankDeg: cp.bankDeg,
      tags: cp.tags,
      vpAnchor: cp.vpAnchor,
    },
  ));
  return out;
}

// 导出为可写入仓库的 JSON 字符串
export function serializeTrack(track) {
  const t = normalizeTrack(track);
  t.updatedAt = new Date().toISOString();
  return JSON.stringify(t, null, 2);
}
