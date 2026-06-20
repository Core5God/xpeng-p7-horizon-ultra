// ---------- P0 Minimal Driving HUD ----------
// 运行时注入一层更克制的驾驶态 UI 策略，避免直接大改 index.html。
// 默认驾驶态只保留速度、档位、小地图、临时提示；竞速态再显示计时组件。

let installed = false;
let lastMode = '';
let hintTimer = 0;

const DRIVE_CLASS = 'p0-min-drive';
const RACING_CLASS = 'p0-racing';
const HINT_CLASS = 'p0-hints-visible';

export function installMinimalDriveHud() {
  if (installed) return;
  installed = true;

  const style = document.createElement('style');
  style.id = 'p0-minimal-driving-hud';
  style.textContent = `
    /* 驾驶态极简：屏幕只保留 速度 / 档位 / 小地图 / 临时提示(showMsg)。
       其余常驻 HUD（品牌、得分、技能弹字、播放列表、键位条、模式、漂移实时）
       默认全部隐藏，不常驻占屏。竞速 racebox 仅 race 模式显示。 */
    body.${DRIVE_CLASS} #title,
    body.${DRIVE_CLASS} #scorechip,
    body.${DRIVE_CLASS} #skillstack,
    body.${DRIVE_CLASS} #playlistbar,
    body.${DRIVE_CLASS} #keytips,
    body.${DRIVE_CLASS} #mode,
    body.${DRIVE_CLASS} #driftlive {
      opacity: 0 !important;
      pointer-events: none !important;
      transition: opacity 520ms ease !important;
    }

    /* 进入驾驶态前几秒，键位条做一次极弱的呼吸提示后自动归零，不常驻 */
    body.${DRIVE_CLASS}.${HINT_CLASS} #keytips {
      opacity: .28 !important;
    }

    body.${DRIVE_CLASS} #cluster {
      bottom: 26px !important;
      right: 30px !important;
      filter: drop-shadow(0 10px 28px rgba(0,0,0,.35));
    }

    body.${DRIVE_CLASS} #speed {
      font-size: 64px !important;
      font-weight: 300 !important;
      letter-spacing: -2.4px !important;
      opacity: .88 !important;
      text-shadow: 0 2px 20px rgba(0,0,0,.34) !important;
    }

    body.${DRIVE_CLASS} #speedunit {
      opacity: .38 !important;
    }

    body.${DRIVE_CLASS} #gear {
      opacity: .52 !important;
      letter-spacing: 3px !important;
    }

    body.${DRIVE_CLASS} #minimap {
      opacity: .42 !important;
      width: 96px !important;
      height: 96px !important;
      bottom: 26px !important;
      left: 26px !important;
      background: rgba(12,16,24,.22) !important;
      border-color: rgba(255,255,255,.10) !important;
      backdrop-filter: blur(10px) saturate(1.25) !important;
      -webkit-backdrop-filter: blur(10px) saturate(1.25) !important;
      transition: opacity 300ms ease, transform 300ms ease !important;
    }

    body.${DRIVE_CLASS} #minimap:hover {
      opacity: .9 !important;
    }

    body.${DRIVE_CLASS} #msg {
      font-weight: 500 !important;
      letter-spacing: .5px !important;
      text-shadow: 0 8px 36px rgba(0,0,0,.42) !important;
    }

    body.${DRIVE_CLASS} #racebox {
      display: none !important;
    }

    body.${DRIVE_CLASS}.${RACING_CLASS} #racebox {
      display: block !important;
      opacity: .88 !important;
    }

    body.${DRIVE_CLASS}.${RACING_CLASS} #scorechip {
      opacity: .55 !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
}

export function updateMinimalDriveHud(appState, racePhase, dt = 0) {
  if (!installed) return;
  const isDrive = appState === 'drive';
  const isRacing = isDrive && racePhase && racePhase !== 'free';

  document.body.classList.toggle(DRIVE_CLASS, isDrive);
  document.body.classList.toggle(RACING_CLASS, !!isRacing);

  if (isDrive && lastMode !== 'drive') {
    // 刚进入驾驶态给一次短暂提示，随后自动安静。
    hintTimer = 3.5;
  }
  lastMode = appState;

  if (hintTimer > 0) {
    hintTimer -= dt;
    document.body.classList.add(HINT_CLASS);
  } else {
    document.body.classList.remove(HINT_CLASS);
  }
}
