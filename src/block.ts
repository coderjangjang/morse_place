// 전송 제한 (도배 · 슬로우 · 타임아웃 · 차단 · 용량) 안내와 대기

import { blockMsg, sendBtn } from './dom';
import { renderComposer } from './composer';
import { state } from './state';
import { store } from './storage';

export type BlockReason = 'ban' | 'full' | 'timeout' | 'slow' | 'rate';

let blockTimer: ReturnType<typeof setInterval> | undefined;
let blockReason: BlockReason | '' = '';

const BLOCK_PREFIX: Partial<Record<BlockReason, string>> = {
  full: '서버 저장 공간이 가득 찼어요. ',
  timeout: '관리자에 의해 타임아웃 중이에요. ',
  slow: '슬로우 모드 중이에요. ',
};

export function startBlock(seconds: number, reason: BlockReason): void {
  state.blockedUntil = Date.now() + Math.max(1, seconds) * 1000;
  blockReason = reason;

  // 새로고침해도 유지 (차단은 저장 안 함)
  store.set('mc-block', reason === 'ban' ? '' : JSON.stringify({ until: state.blockedUntil, reason }));
  clearInterval(blockTimer);
  tickBlock();
  blockTimer = setInterval(tickBlock, 250);
}

function tickBlock(): void {
  if (blockReason === 'ban') {
    blockMsg.textContent = '관리자에 의해 차단되어 메시지를 보낼 수 없어요.';
    sendBtn.disabled = true;
    return;
  }

  const left = Math.ceil((state.blockedUntil - Date.now()) / 1000);
  if (left <= 0) {
    clearInterval(blockTimer);
    store.set('mc-block', '');
    blockMsg.textContent = '';
    renderComposer();
    return;
  }

  const time = left >= 60 ? `${Math.floor(left / 60)}분 ${left % 60}초` : `${left}초`;
  const prefix = (blockReason && BLOCK_PREFIX[blockReason]) || '메시지를 너무 많이 보냈어요. ';
  blockMsg.textContent = `${prefix}${time} 후에 다시 보낼 수 있어요.`;
  sendBtn.disabled = true;
}

// 새로고침 전에 걸려 있던 제한 이어가기
export function restoreBlock(): void {
  try {
    const saved = JSON.parse(store.get('mc-block', 'null')) as { until: number; reason: BlockReason } | null;
    if (saved && saved.until > Date.now()) startBlock((saved.until - Date.now()) / 1000, saved.reason);
  } catch { /* 저장된 값이 깨졌으면 무시 */ }
}
