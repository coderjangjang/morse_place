// 방 · 초대 링크 · 방 상태 표시 · 입력 잠금

import type { RoomState } from '../shared/types';
import { clearDraft, renderComposer } from './composer';
import { backspaceBtn, clearBtn, langBtn, makeEl, roomBar, roomBtn, tapKey, textInput } from './dom';
import { renderFeed } from './feed';
import { LANG_INFO } from './morse';
import { isLocked, room, settings, state } from './state';
import { resetKey } from './tapkey';

export async function copyLink(btn?: HTMLElement | null): Promise<void> {
  const url = location.origin + location.pathname + '?r=' + room;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    prompt('링크를 복사하세요', url);
    return;
  }
  const target = btn && btn.tagName ? btn : roomBtn;
  const original = target.textContent;
  target.textContent = '복사됨';
  setTimeout(() => { target.textContent = original; }, 1200);
}

export function renderRoomBar(): void {
  const { notice, closed, slow } = state.roomState;
  roomBar.textContent = '';
  if (notice) roomBar.append(makeEl('div', 'room-notice', '공지  ' + notice));
  if (closed) {
    roomBar.append(makeEl('div', 'room-flag', state.adminKey
      ? '채팅이 닫혀 있어요 (관리자는 보낼 수 있어요)'
      : '관리자가 채팅을 닫았어요. 다시 열릴 때까지 메시지를 보낼 수 없어요.'));
  }
  if (slow) roomBar.append(makeEl('div', 'room-flag', `슬로우 모드: ${slow}초에 한 번 보낼 수 있어요`));
  roomBar.style.display = roomBar.children.length ? 'block' : 'none';
}

export function applyLock(): void {
  const locked = isLocked();
  for (const el of [textInput, backspaceBtn, clearBtn, langBtn, tapKey]) el.disabled = locked;
  textInput.placeholder = locked ? '채팅이 닫혀 있어요' : LANG_INFO[settings.lang].placeholder;
  if (locked) resetKey();
  renderComposer();
}

export function applyRoomState(next: RoomState): void {
  const wasLocked = isLocked();
  state.roomState = { closed: !!next.closed, slow: next.slow | 0, notice: next.notice || '' };
  renderRoomBar();
  if (!wasLocked && isLocked()) clearDraft();
  applyLock();
}

// 로그인 · 로그아웃 후 갱신
export function refreshRoomUi(): void {
  renderRoomBar();
  applyLock();
  renderFeed();
}

export function initRoom(): void {
  roomBtn.textContent = '#' + room;
  roomBtn.onclick = e => { void copyLink(e.currentTarget as HTMLElement); };
}
