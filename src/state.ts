// 여러 모듈이 같이 쓰는 상태 (설정 · 방 · 관리자 토큰 · 메시지 목록)

import type { Lang, Message, RoomState } from '../shared/types';
import { CODE_TABLE } from './morse';
import { store } from './storage';


// 설정
export type Flag = 0 | 1;

export interface Settings {
  name: string;
  lang: Lang;
  // 표시
  display: 'both' | 'text' | 'morse';
  preview: 'both' | 'text' | 'morse' | 'off';
  showName: Flag; showTime: Flag; showHint: Flag;
  textScale: string;
  typing: Flag; highlight: Flag;
  // 입력
  showInput: Flag; showTapKey: Flag; enterToSend: Flag; spaceToTap: Flag;
  // 탭 키
  dashMs: number; autoGap: Flag; letterMs: number; wordMs: number; keySound: Flag;
  // 소리
  wpm: number; autoPlay: Flag;
  // 테마
  theme: 'system' | 'light' | 'dark' | 'terminal' | 'sepia';
  accent: 'default' | 'blue' | 'green' | 'amber' | 'rose' | 'purple';
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  lang: 'en',
  display: 'both', preview: 'both', showName: 1, showTime: 1, showHint: 1, textScale: '1',
  typing: 1, highlight: 1,
  showInput: 1, showTapKey: 1, enterToSend: 1, spaceToTap: 1,
  dashMs: 220, autoGap: 1, letterMs: 650, wordMs: 1700, keySound: 1,
  wpm: 15, autoPlay: 1,
  theme: 'system', accent: 'default',
};

// 예전 설정 이름 → 현재 이름
const LEGACY_KEYS: Record<string, string> = {
  disp: 'display', prev: 'preview', who: 'showName', time: 'showTime', hint: 'showHint',
  size: 'textScale', showInp: 'showInput', showKey: 'showTapKey', enter: 'enterToSend',
  space: 'spaceToTap', keySnd: 'keySound', auto: 'autoPlay',
};

// 설정 초기화 때도 같은 객체를 쓰도록 const로 두고 내용만 바꿔요
export const settings: Settings = { ...DEFAULT_SETTINGS };
try {
  const saved: unknown = JSON.parse(store.get('mc-set', '{}'));
  if (saved && typeof saved === 'object') {
    const target = settings as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(saved)) target[LEGACY_KEYS[key] || key] = value;
  }
} catch { /* 저장된 값이 깨졌으면 기본값 */ }

if (!CODE_TABLE[settings.lang]) settings.lang = 'en';
if (!settings.name) settings.name = store.get('mc-name', '') || 'OP-' + Math.floor(100 + Math.random() * 900);

export const saveSettings = () => store.set('mc-set', JSON.stringify(settings));
export const dotMs = () => 1200 / settings.wpm;   // 15 WPM = 80ms
saveSettings();


// 방
export const cleanRoom = (s: string | null): string => (s || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
export const room = cleanRoom(new URLSearchParams(location.search).get('r')) || 'lobby';


// 화면에 보이는 메시지 (서버 메시지 + 아직 서버에 없는 내 메시지)
export interface LocalMessage extends Omit<Message, 'id'> {
  id?: number;          // 서버에 올라가기 전에는 없음
  pending?: boolean;    // 전송 중
  failed?: boolean;     // 전송 실패
}
export const messages = new Map<string, LocalMessage>();   // cid → 메시지


// 앱 상태
export type Connection = 'init' | 'on' | 'off' | 'local';

export const state = {
  adminKey: '',                                                    // 관리자 토큰
  roomState: { closed: false, slow: 0, notice: '' } as RoomState,  // 폴링 때마다 서버가 알려줌
  connection: 'init' as Connection,
  morse: '',                                                       // 작성 중인 모스부호
  blockedUntil: 0,                                                 // 전송 제한이 풀리는 시각
};

// 관리자 토큰 (예전 평문 비밀번호는 지움)
if (/^[a-f0-9]{48}$/.test(store.get('mc-key', ''))) state.adminKey = store.get('mc-key', '');
else store.set('mc-key', '');

export function setAdminKey(key: string): void {
  state.adminKey = key;
  store.set('mc-key', key);
}

export const isLocked = () => state.roomState.closed && !state.adminKey;
export const isBlocked = () => Date.now() < state.blockedUntil;
