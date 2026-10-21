// 설정 화면 (계정 · 관리자 · 설정 항목 · 모스부호 표)

import type { AuthResult } from '../shared/types';
import { postJson, readJson } from './api';
import type { Reply } from './api';
import { playMorse } from './audio';
import { makeEl, settingsBtn, sheet, sheetBody, sheetClose } from './dom';
import { isConsonant, isVowel, MORSE_COMMON, MORSE_EN, MORSE_KO } from './morse';
import { copyLink, refreshRoomUi } from './room';
import { applySettings, setSetting } from './settings';
import { cleanRoom, DEFAULT_SETTINGS, room, saveSettings, setAdminKey, settings, state } from './state';
import type { Settings } from './state';


// 설정 항목 정의
type FlagKey =
  | 'showName' | 'showTime' | 'showHint' | 'typing' | 'highlight'
  | 'showInput' | 'showTapKey' | 'enterToSend' | 'spaceToTap'
  | 'autoGap' | 'keySound' | 'autoPlay';
type RangeKey = 'dashMs' | 'letterMs' | 'wordMs' | 'wpm';
type ChoiceKey = 'display' | 'preview' | 'textScale' | 'lang' | 'theme';

type SchemaItem =
  | { type: 'switch'; key: FlagKey; label: string }
  | { type: 'segmented'; key: ChoiceKey; label: string; options: [value: string, label: string][] }
  | { type: 'range'; key: RangeKey; label: string; min: number; max: number; step: number; unit: string }
  | { type: 'swatch'; key: 'accent'; label: string; options: [value: Settings['accent'], label: string, color: string][] };

const SETTINGS_SCHEMA: { title: string; items: SchemaItem[] }[] = [
  { title: '표시', items: [
    { key: 'display', type: 'segmented', label: '메시지 보기',
      options: [['both', '둘 다'], ['text', '텍스트만'], ['morse', '모스부호만']] },
    { key: 'preview', type: 'segmented', label: '입력 미리보기',
      options: [['both', '둘 다'], ['text', '텍스트'], ['morse', '모스'], ['off', '끄기']] },
    { key: 'showName', type: 'switch', label: '보낸 사람 이름 표시' },
    { key: 'showTime', type: 'switch', label: '시간 표시' },
    { key: 'showHint', type: 'switch', label: '하단 안내 문구' },
    { key: 'typing', type: 'switch', label: '입력 중 표시 (내 상태도 공유)' },
    { key: 'textScale', type: 'segmented', label: '메시지 글자 크기',
      options: [['.9', '작게'], ['1', '보통'], ['1.15', '크게'], ['1.3', '아주 크게']] },
  ]},
  { title: '입력 방식', items: [
    { key: 'lang', type: 'segmented', label: '입력 언어',
      options: [['en', '영문'], ['ko', '한글']] },
    { key: 'showInput', type: 'switch', label: '텍스트 입력창' },
    { key: 'showTapKey', type: 'switch', label: '탭 키 버튼' },
    { key: 'enterToSend', type: 'switch', label: 'Enter로 전송' },
    { key: 'spaceToTap', type: 'switch', label: '스페이스바를 탭 키로 사용' },
  ]},
  { title: '탭 키', items: [
    { key: 'dashMs', type: 'range', label: '길게 누름 기준 (이보다 짧으면 점)', min: 100, max: 500, step: 10, unit: ' ms' },
    { key: 'autoGap', type: 'switch', label: '글자·단어 자동 띄우기' },
    { key: 'letterMs', type: 'range', label: '글자 구분 대기 시간', min: 300, max: 1500, step: 50, unit: ' ms' },
    { key: 'wordMs', type: 'range', label: '단어 구분 대기 시간', min: 800, max: 3500, step: 100, unit: ' ms' },
    { key: 'keySound', type: 'switch', label: '누르는 동안 소리' },
  ]},
  { title: '소리', items: [
    { key: 'wpm', type: 'range', label: '재생 속도', min: 5, max: 30, step: 1, unit: ' WPM' },
    { key: 'autoPlay', type: 'switch', label: '새 메시지 자동 재생' },
    { key: 'highlight', type: 'switch', label: '재생 중 부호 강조' },
  ]},
  { title: '테마', items: [
    { key: 'theme', type: 'segmented', label: '화면 모드',
      options: [['system', '시스템'], ['light', '라이트'], ['dark', '다크'], ['terminal', '터미널'], ['sepia', '세피아']] },
    { key: 'accent', type: 'swatch', label: '강조 색',
      options: [
        ['default', '기본', 'linear-gradient(135deg,#171717 50%,#f1f1ee 50%)'],
        ['blue', '파랑', '#2563eb'], ['green', '초록', '#16a34a'], ['amber', '주황', '#d97706'],
        ['rose', '빨강', '#e11d48'], ['purple', '보라', '#7c3aed'],
      ] },
  ]},
];

function buildRow(item: SchemaItem): HTMLElement {
  const row = makeEl('div', 'item');

  if (item.type === 'switch') {
    const key = item.key;
    const btn = makeEl('button', 'switch' + (settings[key] ? ' on' : ''));
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(!!settings[key]));
    btn.onclick = () => {
      setSetting(key, settings[key] ? 0 : 1);
      btn.classList.toggle('on', !!settings[key]);
      btn.setAttribute('aria-checked', String(!!settings[key]));
    };
    row.append(makeEl('span', '', item.label), btn);
  }

  else if (item.type === 'segmented') {
    const key = item.key;
    const group = makeEl('div', 'segmented');
    if (item.options.length > 3) row.classList.add('col');
    for (const [value, label] of item.options) {
      const btn = makeEl('button', String(settings[key]) === value ? 'on' : '', label);
      btn.onclick = () => {
        setSetting(key, value);
        [...group.children].forEach(b => b.classList.toggle('on', b === btn));
      };
      group.append(btn);
    }
    row.append(makeEl('span', '', item.label), group);
  }

  else if (item.type === 'range') {
    const key = item.key;
    row.classList.add('col');
    const valueLabel = makeEl('span', '', settings[key] + item.unit);
    const top = makeEl('div', 'item-top');
    top.append(makeEl('span', '', item.label), valueLabel);

    const slider = makeEl('input');
    slider.type = 'range';
    slider.min = String(item.min);
    slider.max = String(item.max);
    slider.step = String(item.step);
    slider.value = String(settings[key]);
    slider.oninput = () => {
      valueLabel.textContent = slider.value + item.unit;
      setSetting(key, +slider.value);
    };
    row.append(top, slider);

    // 자동 띄우기가 꺼져 있으면 비활성
    if ((key === 'letterMs' || key === 'wordMs') && !settings.autoGap) {
      row.style.opacity = '.4';
      slider.disabled = true;
    }
  }

  else if (item.type === 'swatch') {
    const key = item.key;
    row.classList.add('col');
    const group = makeEl('div', 'swatches');
    for (const [value, label, color] of item.options) {
      const btn = makeEl('button', 'swatch' + (settings[key] === value ? ' on' : ''));
      btn.style.background = color;
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.onclick = () => {
        setSetting(key, value);
        [...group.children].forEach(b => b.classList.toggle('on', b === btn));
      };
      group.append(btn);
    }
    row.append(makeEl('span', '', item.label), group);
  }

  return row;
}


// 계정 · 방
function buildAccountRows(): HTMLElement[] {
  const title = makeEl('div', 'section-title', '계정 · 방');

  // 이름
  const nameRow = makeEl('div', 'item');
  const nameInput = makeEl('input');
  nameInput.type = 'text';
  nameInput.maxLength = 12;
  nameInput.value = settings.name;
  nameInput.autocomplete = 'off';
  nameInput.onchange = () => {
    const name = nameInput.value.trim().slice(0, 12);
    if (!name) { nameInput.value = settings.name; return; }
    settings.name = name;
    saveSettings();
    applySettings();
  };
  nameRow.append(makeEl('span', '', '이름'), nameInput);

  // 방 이동
  const roomRow = makeEl('div', 'item');
  const roomInput = makeEl('input');
  roomInput.type = 'text';
  roomInput.maxLength = 32;
  roomInput.value = room;
  roomInput.placeholder = '영문·숫자·-';
  roomInput.autocomplete = 'off';
  const goBtn = makeEl('button', 'small', '이동');
  const goToRoom = () => {
    const next = cleanRoom(roomInput.value);
    if (next && next !== room) location.search = '?r=' + next;
  };
  goBtn.onclick = goToRoom;
  roomInput.onkeydown = e => { if (e.key === 'Enter') goToRoom(); };
  roomRow.append(makeEl('span', '', '방'), roomInput, goBtn);

  // 초대 링크
  const linkRow = makeEl('div', 'item');
  const copyBtn = makeEl('button', 'small', '복사');
  copyBtn.onclick = () => { void copyLink(copyBtn); };
  linkRow.append(makeEl('span', '', '초대 링크'), copyBtn);

  return [title, nameRow, roomRow, linkRow];
}


// 관리자
function authErrorText(res: Response, data: Reply<AuthResult>): string {
  if (res.status === 401) return '비밀번호가 달라요.';
  if (res.status === 429) return `실패가 너무 많아요. ${data.retryAfter || 600}초 뒤에 다시 시도하세요.`;
  if (res.status === 501) return '서버에 ADMIN_PASSWORD가 설정되지 않았어요.';
  return '확인하지 못했어요. 잠시 후 다시 시도하세요.';
}

function buildAdminRows(): HTMLElement[] {
  const title = makeEl('div', 'section-title', '관리자');
  const row = makeEl('div', 'item');

  // 로그인 상태
  if (state.adminKey) {
    const logoutBtn = makeEl('button', 'small', '로그아웃');
    logoutBtn.onclick = () => {
      postJson({ action: 'logout', key: state.adminKey }).catch(() => {});
      setAdminKey('');
      buildSheet();
      refreshRoomUi();
    };
    row.append(makeEl('span', '', '관리자 모드 켜짐'), logoutBtn);
    return [title, row];
  }

  // 로그인 폼
  const keyInput = makeEl('input');
  keyInput.type = 'password';
  keyInput.placeholder = '관리자 비밀번호';
  keyInput.autocomplete = 'off';
  keyInput.style.textAlign = 'right';
  const loginBtn = makeEl('button', 'small', '로그인');
  const errorMsg = makeEl('div', 'warn');

  const login = async () => {
    const key = keyInput.value;
    if (!key) return;
    loginBtn.disabled = true;
    errorMsg.textContent = '';
    try {
      const res = await postJson({ action: 'auth', key });
      const data = await readJson<AuthResult>(res);
      if (res.ok && data.token) {
        setAdminKey(data.token);   // 토큰만 저장
        buildSheet();
        refreshRoomUi();
        return;
      }
      errorMsg.textContent = authErrorText(res, data);
    } catch {
      errorMsg.textContent = '통신 오류';
    }
    loginBtn.disabled = false;
  };
  loginBtn.onclick = login;
  keyInput.onkeydown = e => { if (e.key === 'Enter') void login(); };

  row.append(keyInput, loginBtn);
  return [title, row, errorMsg];
}


// 모스부호 표 (영문 · 한글 함께, 누르면 소리)
let chartOpen = false;

const pick = (table: Record<string, string>, test: (ch: string) => boolean) =>
  Object.fromEntries(Object.entries(table).filter(([ch]) => test(ch)));

function buildChartRows(): HTMLElement[] {
  const title = makeEl('div', 'section-title', '모스부호 표');
  const details = makeEl('details', 'chart');
  details.open = chartOpen;
  details.addEventListener('toggle', () => { chartOpen = details.open; });
  details.append(makeEl('summary', '', '영문 · 한글 부호 보기 (누르면 소리)'));

  const groups: [string, Record<string, string>][] = [
    ['영문', MORSE_EN],
    ['한글 자음', pick(MORSE_KO, isConsonant)],
    ['한글 모음', pick(MORSE_KO, isVowel)],
    ['숫자 · 기호 (영문·한글 공통)', MORSE_COMMON],
  ];

  for (const [label, table] of groups) {
    details.append(makeEl('div', 'chart-sub', label));
    const grid = makeEl('div', 'chart-grid');
    for (const [ch, code] of Object.entries(table)) {
      const btn = makeEl('button', 'chart-cell');
      btn.append(makeEl('b', '', ch), makeEl('span', '', code));
      btn.onclick = () => playMorse(code);
      grid.append(btn);
    }
    details.append(grid);
  }

  details.append(makeEl('div', 'chart-note', '한글의 쌍자음·겹받침·복합모음은 기본 자모를 이어서 표현해요.'));
  return [title, details];
}


export function buildSheet(): void {
  const panel = document.querySelector<HTMLElement>('.panel');
  if (!panel) return;
  const scrollTop = panel.scrollTop;

  sheetBody.textContent = '';
  sheetBody.append(...buildAccountRows(), ...buildAdminRows());
  for (const section of SETTINGS_SCHEMA) {
    sheetBody.append(makeEl('div', 'section-title', section.title), ...section.items.map(buildRow));
  }
  sheetBody.append(...buildChartRows());

  const resetBtn = makeEl('button', 'reset', '설정 초기화');
  resetBtn.onclick = () => {
    if (!confirm('모든 설정을 기본값으로 되돌릴까요? (이름은 유지)')) return;
    Object.assign(settings, { ...DEFAULT_SETTINGS, name: settings.name });
    saveSettings();
    applySettings();
    buildSheet();
  };
  sheetBody.append(resetBtn);

  panel.scrollTop = scrollTop;
}

const openSheet = () => { buildSheet(); sheet.classList.add('open'); };
const closeSheet = () => sheet.classList.remove('open');

export function initSheet(): void {
  settingsBtn.onclick = openSheet;
  sheetClose.onclick = closeSheet;
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
}
