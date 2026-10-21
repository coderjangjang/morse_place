// 서버 연결 · 폴링 (기본 1.5초, 활동이 없으면 최대 6초까지 늘어남)

import type { GetResponse, Message } from '../shared/types';
import { API_URL, readJson } from './api';
import { notice, onlineEl, statusDot } from './dom';
import { addUnread, renderFeed, syncUnread } from './feed';
import { playMorse } from './audio';
import { applyRoomState } from './room';
import { messages, room, settings, state } from './state';
import type { Connection } from './state';
import { uid } from './storage';
import { renderTyping } from './typing';

let lastId = 0;
let firstLoad = true;
let polling = false;
let deleteRev = '';   // 서버 삭제 횟수

export function setConnection(next: Connection): void {
  state.connection = next;
  statusDot.className = 'dot' + (next === 'on' ? ' on' : next === 'off' ? ' off' : '');
  notice.style.display = (next === 'local' || next === 'off') ? 'block' : 'none';
  notice.textContent =
    next === 'local' ? '공유 서버가 연결되지 않아 이 기기에서만 보여요.' :
    next === 'off'   ? '연결이 불안정해요. 다시 시도하는 중…' : '';
  if (next !== 'on') onlineEl.textContent = '';
}

function ingest(list: Message[]): void {
  let fresh = 0;
  for (const msg of list) {
    if (msg.id > lastId) lastId = msg.id;
    const isNew = !messages.has(msg.cid);
    messages.set(msg.cid, msg);
    if (isNew && !firstLoad && !msg.mine) {
      fresh++;
      if (settings.autoPlay) playMorse(msg.morse, msg.cid);
    }
  }
  firstLoad = false;
  if (!list.length) return;

  const stuck = renderFeed();
  if (fresh && (!stuck || document.hidden)) addUnread(fresh);
}

// 서버에 없는 메시지 정리 (from = 서버 목록의 가장 오래된 id)
function pruneDeleted(cids: string[], from: number): void {
  const alive = new Set(cids);
  let changed = false;
  for (const [cid, msg] of messages) {
    if (msg.id != null && msg.id >= from && !alive.has(cid)) {
      messages.delete(cid);
      changed = true;
    }
  }
  if (changed) renderFeed();
}

export async function poll(): Promise<void> {
  if (polling || state.connection === 'local') return;
  polling = true;
  try {
    const res = await fetch(`${API_URL}?room=${room}&since=${lastId}&rev=${deleteRev}&uid=${uid}`, { cache: 'no-store' });
    if (res.status === 404) return setConnection('local');
    if (res.status === 503) {
      const data = await readJson(res);
      if (data.error !== 'full') setConnection('local');
      return;
    }
    if (!res.ok) throw new Error('poll failed');

    const data: GetResponse = await res.json();
    setConnection('on');
    if (data.cids) pruneDeleted(data.cids, data.from || 0);
    deleteRev = String(data.rev ?? '');
    if (data.state) applyRoomState(data.state);
    renderTyping(data.typing || []);
    onlineEl.textContent = data.online ? `${data.online}명 접속` : '';
    if (data.msgs?.length || data.typing?.length) wake();
    ingest(data.msgs || []);
  } catch {
    setConnection(location.protocol === 'file:' ? 'local' : 'off');
  } finally {
    polling = false;
  }
}

// 폴링 간격 (1.5초 → 3초 → 6초, 백그라운드 탭은 최소 5초)
let idleSince = Date.now();
let pollTimer: ReturnType<typeof setTimeout> | undefined;
export const wake = () => { idleSince = Date.now(); };

function pollDelay(): number {
  const idle = Date.now() - idleSince;
  const base = idle > 300000 ? 6000 : idle > 60000 ? 3000 : 1500;
  return document.hidden ? Math.max(base, 5000) : base;
}

export function schedulePoll(): void {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => { await poll(); schedulePoll(); }, pollDelay());
}

export function initPolling(): void {
  for (const type of ['pointerdown', 'keydown'] as const) addEventListener(type, wake, { passive: true });

  document.addEventListener('visibilitychange', () => {
    wake();
    if (!document.hidden) syncUnread();
    void poll();
    schedulePoll();
  });
}
