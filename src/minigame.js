import * as THREE from 'three';
import { appState } from './config.js';
import { clamp, sampleLegSurface } from './math.js';
import { sound } from './audio.js';

// =========================================================================
// MINI-GAME ENGINE (4 Tactile Challenges + 3D Target Ring)
// =========================================================================
export function createMiniGameController({ scene, repairAllTears, transitionToView, showToast, getGrabState }) {
  const targetRingGroup = new THREE.Group();
  const targetRingMesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.068, 0.0042, 14, 48),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 })
  );
  const targetInnerMesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.066, 36),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })
  );
  targetRingGroup.add(targetRingMesh);
  targetRingGroup.add(targetInnerMesh);
  targetRingGroup.visible = false;
  scene.add(targetRingGroup);

  const LEVELS = [
    {
      title: 'Kéo Căng Không Rách',
      desc: 'Kéo tất giãn vào vùng 70%–95% độ căng và giữ 2.5 giây mà KHÔNG làm đứt sợi nào!',
      hasTimer: false,
      showTargetRing: false
    },
    {
      title: 'Xé Cửa Sổ Chuẩn',
      desc: 'Xé ít nhất 18 sợi bên trong vòng sáng trên đùi phải, tối đa 10 sợi rách tràn ra ngoài!',
      hasTimer: false,
      showTargetRing: true,
      ringCenter: (() => {
        const pt = sampleLegSurface(1, 0.28, Math.PI * 0.46, 0.012);
        return new THREE.Vector3(pt.x, pt.y, pt.z);
      })(),
      ringRadius: 0.078,
      needInside: 18,
      maxOutside: 10
    },
    {
      title: 'Kỹ Thuật Xé Hai Tay',
      desc: 'Kéo nhẹ rồi nhấn phím 1 (Ghim tay), sau đó dùng Tay 2 kéo ngược chiều để xé ≥ 26 sợi!',
      hasTimer: false,
      showTargetRing: false,
      needTwoHand: 26
    },
    {
      title: 'Xé Tốc Độ 20 Giây',
      desc: 'Xé điên cuồng ≥ 110 sợi trên cả hai chân (hoặc váy) trong vòng 20 giây để đạt 3 sao!',
      hasTimer: true,
      duration: 20.0,
      needTotal: 110
    }
  ];

  const gameState = {
    active: false,
    completed: false,
    totalScore: 0,
    holdSeconds: 0,
    brokenInRun: 0,
    insideBreaks: 0,
    outsideBreaks: 0,
    twoHandBreaks: 0,
    timeLeft: 20.0,
    timerStarted: false
  };

  const elGameHud = document.getElementById('game-hud');
  const elHudLevel = document.getElementById('hud-level-badge');
  const elHudTitle = document.getElementById('hud-title');
  const elHudDesc = document.getElementById('hud-desc');
  const elHudProg = document.getElementById('hud-progress');
  const elHudProgTxt = document.getElementById('hud-progress-text');
  const elHudTimer = document.getElementById('hud-timer');
  const elHudScore = document.getElementById('hud-score');
  const elHudSubstat = document.getElementById('hud-substat');
  const elWinModal = document.getElementById('win-modal');

  function startLevel(idx) {
    appState.levelIndex = idx;
    const lvl = LEVELS[idx];
    gameState.active = true;
    gameState.completed = false;
    gameState.holdSeconds = 0;
    gameState.brokenInRun = 0;
    gameState.insideBreaks = 0;
    gameState.outsideBreaks = 0;
    gameState.twoHandBreaks = 0;
    gameState.timeLeft = lvl.duration || 20.0;
    gameState.timerStarted = false;

    repairAllTears(true);
    elWinModal.classList.add('hidden');
    elHudLevel.textContent = `Màn ${idx + 1} / ${LEVELS.length}`;
    elHudTitle.textContent = lvl.title;
    elHudDesc.textContent = lvl.desc;
    elHudProg.style.width = '0%';
    elHudProgTxt.textContent = '0%';
    elHudTimer.classList.toggle('hidden', !lvl.hasTimer);
    if (lvl.hasTimer) elHudTimer.textContent = `${gameState.timeLeft.toFixed(1)}s`;
    elHudScore.textContent = `${gameState.totalScore} điểm`;
    elHudSubstat.textContent = 'Sẵn sàng!';
    elHudSubstat.className = 'text-slate-400';

    document.querySelectorAll('.lvl-pill').forEach((p, i) => {
      p.className = i === idx
        ? 'lvl-pill studio-btn px-2 py-0.5 rounded bg-sky-500 text-white font-semibold'
        : 'lvl-pill studio-btn px-2 py-0.5 rounded bg-white/10 text-slate-300 hover:bg-white/20';
    });

    if (lvl.showTargetRing) {
      targetRingGroup.position.copy(lvl.ringCenter);
      targetRingGroup.lookAt(lvl.ringCenter.x, lvl.ringCenter.y, lvl.ringCenter.z + 1);
      targetRingGroup.visible = true;
      transitionToView('view1', 'btn-view-1');
    } else {
      targetRingGroup.visible = false;
      if (idx === 3) transitionToView('full', 'btn-view-full');
      else transitionToView('view1', 'btn-view-1');
    }
  }

  function completeLevel(stars, points, summary) {
    if (gameState.completed) return;
    gameState.completed = true;
    gameState.totalScore += points;
    sound.playChime(true);
    elHudScore.textContent = `${gameState.totalScore} điểm`;
    document.getElementById('win-stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
    document.getElementById('win-title').textContent = `Hoàn thành Màn ${appState.levelIndex + 1}!`;
    document.getElementById('win-desc').textContent = summary;
    document.getElementById('win-points').textContent = `+${points}`;
    document.getElementById('win-total').textContent = `${gameState.totalScore}`;
    const nextBtn = document.getElementById('btn-win-next');
    nextBtn.textContent = appState.levelIndex < LEVELS.length - 1 ? 'Màn tiếp theo →' : 'Chơi lại từ Màn 1 ↻';
    elWinModal.classList.remove('hidden');
  }

  function exitToSandbox() {
    appState.gameMode = 'sandbox';
    gameState.active = false;
    targetRingGroup.visible = false;
    elGameHud.classList.add('hidden');
    elWinModal.classList.add('hidden');
  }

  function enterMiniGame() {
    appState.gameMode = 'minigame';
    elGameHud.classList.remove('hidden');
    startLevel(appState.levelIndex);
  }

  function update(dt, peakTension, newlyBroken) {
    if (appState.gameMode !== 'minigame' || !gameState.active || gameState.completed) return;
    const lvl = LEVELS[appState.levelIndex];
    const { mainGrab, pinnedGrab } = getGrabState();

    if (targetRingGroup.visible) {
      const pulse = 1.0 + Math.sin(performance.now() * 0.005) * 0.035;
      targetRingGroup.scale.setScalar(pulse);
    }

    if (appState.levelIndex === 0) {
      if (newlyBroken.length > 0) {
        gameState.holdSeconds = 0;
        gameState.brokenInRun += newlyBroken.length;
        sound.playChime(false);
        showToast('Rách mất rồi! Kéo nhẹ tay hơn & nhấn Chơi lại!');
        elHudSubstat.textContent = `Lỗi: đứt ${gameState.brokenInRun} sợi!`;
        elHudSubstat.className = 'text-rose-400 font-semibold';
        return;
      }
      if (gameState.brokenInRun === 0 && (mainGrab || pinnedGrab) && peakTension >= 0.70 && peakTension <= 0.98) {
        gameState.holdSeconds += dt;
        elHudSubstat.textContent = 'Đúng độ căng! Giữ yên...';
        elHudSubstat.className = 'text-emerald-300 font-semibold';
      } else if (gameState.brokenInRun === 0) {
        gameState.holdSeconds = Math.max(0, gameState.holdSeconds - dt * 0.4);
        elHudSubstat.textContent = peakTension > 0.15 ? 'Kéo thêm chút nữa (70%–95%)' : 'Kéo tất ra ngoài không làm rách';
        elHudSubstat.className = 'text-slate-300';
      }
      const pct = clamp((gameState.holdSeconds / 2.5) * 100, 0, 100);
      elHudProg.style.width = `${pct.toFixed(1)}%`;
      elHudProgTxt.textContent = `${gameState.holdSeconds.toFixed(1)}s`;
      if (gameState.holdSeconds >= 2.5 && gameState.brokenInRun === 0) {
        completeLevel(3, 500, 'Kiểm soát độ đàn hồi đỉnh cao! Kéo giãn cực đại mà không đứt sợi nào.');
      }
    } else if (appState.levelIndex === 1) {
      for (const br of newlyBroken) {
        const d = Math.hypot(br.x - lvl.ringCenter.x, br.y - lvl.ringCenter.y, br.z - lvl.ringCenter.z);
        if (d <= lvl.ringRadius) gameState.insideBreaks++;
        else gameState.outsideBreaks++;
      }
      const pct = clamp((gameState.insideBreaks / lvl.needInside) * 100, 0, 100);
      elHudProg.style.width = `${pct.toFixed(1)}%`;
      elHudProgTxt.textContent = `${gameState.insideBreaks}/${lvl.needInside}`;
      elHudSubstat.textContent = `Ngoài vòng: ${gameState.outsideBreaks}/${lvl.maxOutside}`;
      elHudSubstat.className = gameState.outsideBreaks > lvl.maxOutside ? 'text-rose-400 font-bold' : 'text-sky-300';

      if (gameState.outsideBreaks > lvl.maxOutside) {
        sound.playChime(false);
        showToast('Rách tràn ra ngoài nhiều quá! Thử xé gọn hơn nhé.');
        startLevel(1);
        return;
      }
      if (gameState.insideBreaks >= lvl.needInside) {
        const stars = gameState.outsideBreaks <= 2 ? 3 : (gameState.outsideBreaks <= 6 ? 2 : 1);
        completeLevel(stars, stars * 200, `Xé cửa sổ siêu chuẩn! Trong vòng: ${gameState.insideBreaks} sợi, ngoài vòng: ${gameState.outsideBreaks} sợi.`);
      }
    } else if (appState.levelIndex === 2) {
      const isTwoHanding = Boolean(pinnedGrab && mainGrab);
      if (isTwoHanding && newlyBroken.length > 0) {
        gameState.twoHandBreaks += newlyBroken.length;
      }
      const pct = clamp((gameState.twoHandBreaks / lvl.needTwoHand) * 100, 0, 100);
      elHudProg.style.width = `${pct.toFixed(1)}%`;
      elHudProgTxt.textContent = `${gameState.twoHandBreaks}/${lvl.needTwoHand}`;
      if (!pinnedGrab) {
        elHudSubstat.textContent = 'Bước 1: Kéo tất/váy rồi nhấn phím 1 để ghim Tay 1';
        elHudSubstat.className = 'text-amber-300';
      } else {
        elHudSubstat.textContent = 'Bước 2: Dùng chuột kéo ngược chiều bằng Tay 2!';
        elHudSubstat.className = 'text-emerald-300 font-semibold';
      }
      if (gameState.twoHandBreaks >= lvl.needTwoHand) {
        completeLevel(3, 650, 'Cú xé hai tay cực mượt! Sợi lưới bung mở tự nhiên như thật.');
      }
    } else if (appState.levelIndex === 3) {
      if ((mainGrab || newlyBroken.length > 0) && !gameState.timerStarted) {
        gameState.timerStarted = true;
      }
      if (gameState.timerStarted) {
        gameState.timeLeft = Math.max(0, gameState.timeLeft - dt);
        elHudTimer.textContent = `${gameState.timeLeft.toFixed(1)}s`;
      }
      gameState.brokenInRun += newlyBroken.length;
      const pct = clamp((gameState.brokenInRun / lvl.needTotal) * 100, 0, 100);
      elHudProg.style.width = `${pct.toFixed(1)}%`;
      elHudProgTxt.textContent = `${gameState.brokenInRun}/${lvl.needTotal}`;
      elHudSubstat.textContent = gameState.timerStarted ? 'Kéo mạnh xé liên tục!' : 'Chạm vào tất hoặc váy để bắt đầu đếm giờ!';
      elHudSubstat.className = 'text-sky-300';

      if (gameState.brokenInRun >= lvl.needTotal) {
        const stars = gameState.timeLeft >= 6 ? 3 : (gameState.timeLeft >= 2 ? 2 : 1);
        completeLevel(stars, 500 + Math.round(gameState.timeLeft * 35), `Xé ${gameState.brokenInRun} sợi khi còn dư ${gameState.timeLeft.toFixed(1)} giây!`);
      } else if (gameState.timerStarted && gameState.timeLeft <= 0) {
        sound.playChime(false);
        showToast(`Hết giờ! Bạn xé được ${gameState.brokenInRun}/${lvl.needTotal} sợi — Thử lại nhé!`);
        startLevel(3);
      }
    }
  }

  // Bind level buttons
  document.querySelectorAll('.lvl-pill').forEach(btn => {
    btn.addEventListener('click', () => startLevel(parseInt(btn.dataset.lvl, 10)));
  });
  document.getElementById('btn-retry-lvl').addEventListener('click', () => startLevel(appState.levelIndex));
  document.getElementById('btn-win-retry').addEventListener('click', () => startLevel(appState.levelIndex));
  document.getElementById('btn-win-next').addEventListener('click', () => {
    startLevel((appState.levelIndex + 1) % LEVELS.length);
  });

  return { startLevel, exitToSandbox, enterMiniGame, update };
}
