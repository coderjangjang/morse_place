// 메시지 목록 · 말풍선(재생/삭제) · 새 메시지 알림

import { postJson, readJson } from './api';
import { showCmdResult } from './admin';
import { playMorse } from './audio';
import { feed, makeEl, newBtn } from './dom';
import { decode } from './morse';
import { poll } from './poll';
import { messages, room, settings, state } from './state';
import type { LocalMessage } from './state';
import { uid } from './storage';

const formatTime = (t: number) => {
  const d = new Date(t);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};

function buildMessage(msg: LocalMessage): HTMLElement {
  const mine = !!msg.mine;
  const canDelete = mine || !!state.adminKey;
  const wrap = makeEl('div', 'msg' + (mine ? ' mine' : '') + (msg.admin ? ' admin' : '') +
    (msg.pending ? ' pending' : '') + (canDelete ? ' deletable' : ''));
  wrap.dataset.cid = msg.cid;

  const meta: string[] = [];
  if (settings.showName && !mine) meta.push(msg.name);
  if (settings.showTime) meta.push(formatTime(msg.t));

  if (meta.length || msg.failed || msg.admin) {
    const head = makeEl('div', 'meta');
    if (msg.admin) head.append(makeEl('span', 'badge-admin', '관리자'));
    head.append(document.createTextNode(meta.join(' · ')));
    if (msg.failed) head.append(makeEl('span', 'error', (meta.length ? ' · ' : '') + '통신 오류'));
    wrap.append(head);
  }

  const bubble = makeEl('div', 'bubble');
  if (settings.display !== 'text') {
    const morseEl = makeEl('div', 'morse');
    for (const ch of msg.morse) morseEl.append(makeEl('span', '', ch));   // 강조용 span
    bubble.append(morseEl);
  }
  if (settings.display !== 'morse') bubble.append(makeEl('div', 'text', decode(msg.morse, msg.lang)));
  attachBubbleActions(bubble, msg, canDelete);
  wrap.append(bubble);
  return wrap;
}

// 짧게 = 재생, 꾹 = 삭제
const LONG_PRESS_MS = 600;

function attachBubbleActions(bubble: HTMLElement, msg: LocalMessage, deletable: boolean): void {
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressed = false;
  const cancel = () => clearTimeout(pressTimer);

  bubble.addEventListener('pointerdown', () => {
    longPressed = false;
    if (!deletable || msg.pending) return;
    pressTimer = setTimeout(() => { longPressed = true; void deleteMessage(msg); }, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) bubble.addEventListener(type, cancel);

  bubble.addEventListener('click', () => { if (!longPressed) playMorse(msg.morse, msg.cid); });
  bubble.addEventListener('contextmenu', e => { if (deletable) e.preventDefault(); });
}

async function deleteMessage(msg: LocalMessage): Promise<void> {
  if (!confirm('이 메시지를 삭제할까요?')) return;

  // 서버에 없는 메시지는 이 기기에서만 삭제
  if (msg.failed || msg.id == null || state.connection === 'local') {
    messages.delete(msg.cid);
    renderFeed();
    return;
  }

  try {
    const res = await postJson({ action: 'del', room, cid: msg.cid, uid, key: state.adminKey });
    const data = await readJson(res);
    if (res.ok || res.status === 404) {   // 404 = 이미 삭제됨
      messages.delete(msg.cid);
      renderFeed();
      void poll();
      return;
    }
    showCmdResult(res.status === 403 ? '내 메시지만 삭제할 수 있어요.' : `삭제 실패 (${data.error || res.status})`, true);
  } catch {
    showCmdResult('통신 오류', true);
  }
}

export const atBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;

// 다시 그리기 (맨 아래에 붙였으면 true)
export function renderFeed(): boolean {
  const list = [...messages.values()].sort((a, b) => a.t - b.t).slice(-100);
  if (!list.length) {
    feed.innerHTML = '<div class="empty">텍스트를 입력하거나 키를 눌러<br>모스부호로 대화해 보세요.</div>';
    return false;
  }

  const stick = atBottom() || !!feed.querySelector('.empty');
  const prevTop = feed.scrollTop;
  feed.textContent = '';
  for (const msg of list) feed.append(buildMessage(msg));
  feed.scrollTop = stick ? feed.scrollHeight : prevTop;
  return stick;
}


// 새 메시지 알림
let unread = 0;

function updateUnread(): void {
  document.title = unread ? `(${unread}) Morse` : 'Morse';
  newBtn.style.display = unread && !atBottom() ? 'block' : 'none';
}

export function addUnread(count: number): void {
  unread += count;
  updateUnread();
}

// 탭으로 돌아왔을 때
export function syncUnread(): void {
  if (atBottom()) unread = 0;
  updateUnread();
}

export function initFeed(): void {
  feed.addEventListener('scroll', () => {
    if (atBottom() && !document.hidden) unread = 0;
    updateUnread();
  }, { passive: true });

  newBtn.onclick = () => {
    feed.scrollTop = feed.scrollHeight;
    unread = 0;
    updateUnread();
  };
}
