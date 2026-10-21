// 입력 중 표시 (내 상태 전송 · 다른 사람 표시)

import { postJson } from './api';
import { textInput, typingLine } from './dom';
import { isLocked, room, settings, state } from './state';
import { uid } from './storage';

let typingActive = false;
let typingSentAt = 0;
let typingStopTimer: ReturnType<typeof setTimeout> | undefined;

const sendTyping = (on: boolean) =>
  postJson({ action: 'typing', room, uid, name: settings.name, on, key: state.adminKey }).catch(() => {});

export function noteTyping(): void {
  if (!settings.typing || state.connection === 'local' || isLocked()) return;
  if (state.adminKey && textInput.value[0] === '/') return;   // 관리자 명령어는 제외

  clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(stopTyping, 4000);

  const now = Date.now();
  if (now - typingSentAt > 2000) {
    typingSentAt = now;
    typingActive = true;
    void sendTyping(true);
  }
}

export function stopTyping(): void {
  clearTimeout(typingStopTimer);
  if (!typingActive) return;
  typingActive = false;
  typingSentAt = 0;
  void sendTyping(false);
}

// 다른 사람의 입력 중 표시
export function renderTyping(names: string[]): void {
  if (!settings.typing || !names.length) {
    typingLine.textContent = '';
    typingLine.classList.remove('on');
    return;
  }
  let who: string;
  if (!settings.showName) who = '누군가';
  else if (names.length === 1) who = `${names[0]} 님이`;
  else if (names.length === 2) who = `${names[0]}, ${names[1]} 님이`;
  else who = `${names.length}명이`;

  typingLine.textContent = `${who} 메시지를 쓰는 중…`;
  typingLine.classList.add('on');
}
