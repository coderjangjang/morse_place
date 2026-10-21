// 메시지 전송

import type { SendResult } from '../shared/types';
import { postJson, readJson } from './api';
import { runAdminCommand, showCmdResult } from './admin';
import { startBlock } from './block';
import { clearDraft } from './composer';
import { sendBtn, textInput } from './dom';
import { renderFeed } from './feed';
import { sanitizeMorse } from './morse';
import { poll, setConnection, wake } from './poll';
import { applyRoomState } from './room';
import { isBlocked, isLocked, messages, room, setAdminKey, settings, state } from './state';
import type { LocalMessage } from './state';
import { uid } from './storage';

const newClientId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

async function sendMessage(): Promise<void> {
  if (isBlocked() || isLocked()) return;

  const raw = textInput.value.trim();
  if (state.adminKey && raw[0] === '/') return runAdminCommand(raw);

  const code = sanitizeMorse(state.morse);
  if (!code) return;

  // 흐리게 먼저 보여주고 응답 오면 확정
  const msg: LocalMessage = {
    cid: newClientId(), name: settings.name, morse: code, lang: settings.lang,
    t: Date.now(), pending: true, mine: true,
  };
  clearDraft();
  messages.set(msg.cid, msg);
  wake();
  renderFeed();

  if (state.connection === 'local') { msg.pending = false; renderFeed(); return; }

  try {
    const res = await postJson({ room, name: msg.name, morse: code, lang: msg.lang, cid: msg.cid, uid, key: state.adminKey });
    const data = await readJson<SendResult>(res);

    if (res.status === 404 || (res.status === 503 && data.error !== 'full')) {
      setConnection('local');
      msg.pending = false;
      renderFeed();
      return;
    }
    if (!res.ok) {
      // 닫힌 방 (관리자 토큰이 만료됐어도 여기로 옴)
      if (data.error === 'closed') {
        const wasAdmin = !!state.adminKey;
        if (wasAdmin) setAdminKey('');
        applyRoomState({ ...state.roomState, closed: true });
        if (wasAdmin) { renderFeed(); showCmdResult('관리자 인증이 만료됐어요. 설정에서 다시 로그인하세요.', true); }
        messages.delete(msg.cid);
        renderFeed();
        return;
      }

      // 막힘: 보내던 메시지는 오류 표시 없이 바로 지움
      const reason = data.error;
      if (reason === 'banned' || reason === 'rate' || reason === 'full' || reason === 'timeout' || reason === 'slow') {
        if (reason === 'banned') startBlock(Infinity, 'ban');
        else startBlock(data.retryAfter || Number(res.headers.get('Retry-After')) || 60, reason);
        messages.delete(msg.cid);
        renderFeed();
        return;
      }
      throw new Error('send failed');
    }

    msg.pending = false;
    // 슬로우 모드는 미리 대기
    if (state.roomState.slow && !state.adminKey) startBlock(state.roomState.slow, 'slow');
    void poll();
  } catch {
    msg.pending = false;
    msg.failed = true;
    renderFeed();
  }
}

export function initSend(): void {
  sendBtn.onclick = () => { void sendMessage(); };
  textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing && settings.enterToSend) void sendMessage();
  });
}
