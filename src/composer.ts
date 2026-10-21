// 입력창 · 미리보기 · 작성 중인 모스부호

import { backspaceBtn, charWarn, clearBtn, previewBox, previewMorse, previewText, sendBtn, textInput } from './dom';
import { countUnsupported, decode, encode, LANG_INFO } from './morse';
import { isBlocked, isLocked, settings, state } from './state';
import { noteTyping, stopTyping } from './typing';

// 탭 키로 입력할 때 글자 · 단어 사이 자동 띄우기
let letterTimer: ReturnType<typeof setTimeout> | undefined;
let wordTimer: ReturnType<typeof setTimeout> | undefined;

export const cancelGapTimers = () => { clearTimeout(letterTimer); clearTimeout(wordTimer); };

// 잠깐 멈추면 글자, 더 멈추면 단어 띄우기
export function scheduleGaps(): void {
  letterTimer = setTimeout(() => {
    if (state.morse && !/ $/.test(state.morse)) { state.morse += ' '; renderComposer(); }
  }, settings.letterMs);

  wordTimer = setTimeout(() => {
    state.morse = state.morse.trimEnd() + ' / ';
    renderComposer();
  }, Math.max(settings.wordMs, settings.letterMs + 300));
}

export function renderComposer(): void {
  const mode = settings.preview;
  previewBox.style.display = mode === 'off' ? 'none' : '';
  previewMorse.style.display = mode === 'text' ? 'none' : '';
  previewText.style.display = mode === 'morse' ? 'none' : '';
  previewMorse.textContent = state.morse;
  previewText.textContent = state.morse ? decode(state.morse, settings.lang) : '';
  sendBtn.disabled = !state.morse.trim() || isBlocked() || isLocked();

  const skipped = countUnsupported(textInput.value, settings.lang);
  charWarn.textContent = skipped
    ? `지원하지 않는 문자 ${skipped}개는 제외돼요 (${LANG_INFO[settings.lang].allowed})`
    : '';
}

// 모스 → 텍스트로 입력창에 표시
export const showMorseInInput = () => {
  textInput.value = decode(state.morse, settings.lang).replace(/·/g, '').trimEnd();
};

export function clearDraft(): void {
  cancelGapTimers();
  stopTyping();
  state.morse = '';
  textInput.value = '';
  renderComposer();
}

// 모스부호가 남아 있으면 입력 중 표시 켜기, 비었으면 끄기
const syncTyping = () => { if (state.morse) noteTyping(); else stopTyping(); };

export function initComposer(): void {
  textInput.addEventListener('input', () => {
    cancelGapTimers();
    state.morse = encode(textInput.value, settings.lang);
    renderComposer();
    syncTyping();
  });

  clearBtn.onclick = () => {
    clearDraft();
    if (settings.showInput) textInput.focus();
  };

  // 한 글자 지우기
  backspaceBtn.onclick = () => {
    cancelGapTimers();
    const trimmed = state.morse.replace(/[ /]+$/, '');
    const lastSpace = trimmed.lastIndexOf(' ');
    state.morse = lastSpace < 0 ? '' : trimmed.slice(0, lastSpace) + ' ';
    showMorseInInput();
    renderComposer();
    syncTyping();
  };
}
