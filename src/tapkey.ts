// 탭 키 (버튼 · 스페이스바)

import { initAudio, startKeyTone, stopKeyTone } from './audio';
import { renderComposer, cancelGapTimers, scheduleGaps, showMorseInInput } from './composer';
import { sheet, tapKey } from './dom';
import { isLocked, settings, state } from './state';
import { noteTyping } from './typing';

let pressStart = 0;

// 눌림 상태 해제
export function resetKey(): void {
  pressStart = 0;
  tapKey.classList.remove('down');
  stopKeyTone();
}

function onKeyDown(): void {
  if (pressStart || isLocked()) return;
  pressStart = performance.now();
  tapKey.classList.add('down');
  cancelGapTimers();
  initAudio();
  noteTyping();
  if (settings.keySound) startKeyTone();
}

function onKeyUp(): void {
  if (!pressStart) return;
  const heldMs = performance.now() - pressStart;
  pressStart = 0;
  tapKey.classList.remove('down');
  stopKeyTone();

  state.morse += heldMs < settings.dashMs ? '.' : '-';
  showMorseInInput();
  renderComposer();
  if (settings.autoGap) scheduleGaps();
}

// 스페이스바 = 탭 키 (입력 중이거나 설정이 열려 있으면 제외)
const isTypingNow = () =>
  /INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? '') || sheet.classList.contains('open');

export function initTapKey(): void {
  tapKey.addEventListener('pointerdown', e => {
    e.preventDefault();
    tapKey.setPointerCapture(e.pointerId);
    onKeyDown();
  });
  tapKey.addEventListener('pointerup', onKeyUp);
  tapKey.addEventListener('pointercancel', onKeyUp);
  tapKey.addEventListener('contextmenu', e => e.preventDefault());

  addEventListener('keydown', e => {
    if (settings.spaceToTap && e.code === 'Space' && !isTypingNow()) {
      e.preventDefault();
      if (!e.repeat) onKeyDown();
    }
  });
  addEventListener('keyup', e => {
    if (settings.spaceToTap && e.code === 'Space' && !isTypingNow()) onKeyUp();
  });
}
