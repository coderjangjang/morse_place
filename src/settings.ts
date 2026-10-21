// 설정 적용 (테마 · 입력창 · 언어 전환)

import { clearDraft } from './composer';
import { feed, hint, inputRow, langBtn, tapKey, textInput } from './dom';
import { renderFeed } from './feed';
import { LANG_INFO } from './morse';
import { applyLock } from './room';
import { buildSheet } from './sheet';
import { saveSettings, settings } from './state';
import type { Settings } from './state';
import { renderTyping, stopTyping } from './typing';

function applyTheme(): void {
  const root = document.documentElement;
  if (settings.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', settings.theme);
  if (settings.accent === 'default') root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', settings.accent);
  root.style.setProperty('--z', settings.textScale);

  const meta = document.querySelector<HTMLMetaElement>('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || '#fafaf9';
}

export function applySettings(): void {
  applyTheme();

  langBtn.textContent = LANG_INFO[settings.lang].label;

  textInput.style.display = settings.showInput ? '' : 'none';
  inputRow.classList.toggle('no-input', !settings.showInput);
  tapKey.style.display = settings.showTapKey ? '' : 'none';
  hint.style.display = settings.showHint ? '' : 'none';
  feed.dataset.display = settings.display;

  renderFeed();
  applyLock();
  if (!settings.typing) renderTyping([]);
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings[key] = value;
  if (key === 'lang') clearDraft();
  if (key === 'typing' && !value) stopTyping();

  // 입력창과 탭 키가 둘 다 꺼지지 않게
  if (!settings.showInput && !settings.showTapKey) {
    settings[key === 'showInput' ? 'showTapKey' : 'showInput'] = 1;
    saveSettings();
    applySettings();
    buildSheet();
    return;
  }

  saveSettings();
  applySettings();
  if (key === 'autoGap' || key === 'lang') buildSheet();
}

export function initSettings(): void {
  matchMedia('(prefers-color-scheme:dark)').addEventListener?.('change', applyTheme);

  // 한/영 전환
  langBtn.onclick = () => {
    setSetting('lang', settings.lang === 'ko' ? 'en' : 'ko');
    langBtn.blur();
    if (settings.showInput) textInput.focus();
  };
}
