// 요소 · DOM 공통 도구 (모듈은 문서가 다 읽힌 뒤 실행되니 바로 찾아도 돼요)

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} 요소를 찾을 수 없어요`);
  return el as T;
}

export function makeEl<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string | null,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

export const roomBtn = byId<HTMLButtonElement>('roomBtn');
export const statusDot = byId('statusDot');
export const settingsBtn = byId<HTMLButtonElement>('settingsBtn');
export const notice = byId('notice');
export const roomBar = byId('roomBar');
export const onlineEl = byId('online');
export const feed = byId('feed');
export const newBtn = byId<HTMLButtonElement>('newBtn');
export const typingLine = byId('typingLine');
export const previewBox = byId('previewBox');
export const previewMorse = byId('previewMorse');
export const previewText = byId('previewText');
export const charWarn = byId('charWarn');
export const blockMsg = byId('blockMsg');
export const cmdResult = byId('cmdResult');
export const inputRow = byId('inputRow');
export const langBtn = byId<HTMLButtonElement>('langBtn');
export const textInput = byId<HTMLInputElement>('textInput');
export const backspaceBtn = byId<HTMLButtonElement>('backspaceBtn');
export const clearBtn = byId<HTMLButtonElement>('clearBtn');
export const sendBtn = byId<HTMLButtonElement>('sendBtn');
export const tapKey = byId<HTMLButtonElement>('tapKey');
export const hint = byId('hint');
export const sheet = byId('sheet');
export const sheetBody = byId('sheetBody');
export const sheetClose = byId<HTMLButtonElement>('sheetClose');
