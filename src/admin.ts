// 관리자 명령어 실행 · 결과 표시

import type { CommandResult } from '../shared/types';
import { postJson, readJson } from './api';
import { clearDraft } from './composer';
import { cmdResult } from './dom';
import { poll } from './poll';
import { refreshRoomUi } from './room';
import { room, setAdminKey, state } from './state';

let cmdResultTimer: ReturnType<typeof setTimeout> | undefined;

export function showCmdResult(text: string, isError = false): void {
  cmdResult.textContent = text;
  cmdResult.style.color = isError ? 'var(--bad)' : 'var(--mute)';
  clearTimeout(cmdResultTimer);
  cmdResultTimer = setTimeout(() => { cmdResult.textContent = ''; }, Math.min(20000, Math.max(7000, text.length * 60)));
}

export async function runAdminCommand(text: string): Promise<void> {
  clearDraft();
  try {
    const res = await postJson({ action: 'cmd', room, key: state.adminKey, text });
    const data = await readJson<CommandResult>(res);
    if (res.status === 401) {   // 토큰 만료
      setAdminKey('');
      refreshRoomUi();
    }
    showCmdResult(data.msg || (res.ok ? '완료' : `명령 실패 (${data.error || res.status})`), !res.ok);
    if (res.ok) void poll();
  } catch {
    showCmdResult('통신 오류', true);
  }
}
