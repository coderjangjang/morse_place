// 오디오 (모스부호 재생 · 탭 키 소리) + 재생 중인 부호 강조

import { feed } from './dom';
import { dotMs, settings } from './state';

const TONE_HZ = 880;
const TONE_GAIN = 0.07;

let audioCtx: AudioContext | undefined;
let playbackEndsAt = 0;
let keyOsc: OscillatorNode | null = null;

export function initAudio(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state !== 'running') void audioCtx.resume();
  } catch { /* 오디오를 못 쓰는 환경이면 무시 */ }
}

// 처음 누르는 순간 오디오를 켬 (브라우저 자동 재생 정책)
export const setupAudio = () => addEventListener('pointerdown', initAudio, { passive: true });

function beep(ctx: AudioContext, start: number, duration: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const fade = 0.004;
  osc.type = 'square';
  osc.frequency.value = TONE_HZ;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(TONE_GAIN, start + fade);
  gain.gain.setValueAtTime(TONE_GAIN, start + duration - fade);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  osc.start(start);
  osc.stop(start + duration + 0.01);
}

// 재생 중인 부호 강조
function setLit(cid: string, index: number, on: boolean): void {
  const el = feed.querySelector(`.msg[data-cid="${cid}"] .morse`)?.children[index];
  if (el) el.classList.toggle('lit', on);
}

function flash(ctx: AudioContext, cid: string | undefined, index: number, start: number, duration: number): void {
  if (!cid || !settings.highlight) return;
  const now = ctx.currentTime;
  setTimeout(() => setLit(cid, index, true), Math.max(0, (start - now) * 1000));
  setTimeout(() => setLit(cid, index, false), Math.max(0, (start + duration - now) * 1000));
}

// 점 1단위, 선 3단위, 부호 사이 1단위
export function playMorse(code: string, cid?: string): void {
  try {
    initAudio();
    const ctx = audioCtx;
    if (!ctx) return;
    const unit = dotMs() / 1000;
    let t = Math.max(ctx.currentTime + 0.05, playbackEndsAt);
    [...code].forEach((ch, i) => {
      if (ch === '.')      { beep(ctx, t, unit);     flash(ctx, cid, i, t, unit);     t += 2 * unit; }
      else if (ch === '-') { beep(ctx, t, 3 * unit); flash(ctx, cid, i, t, 3 * unit); t += 4 * unit; }
      else if (ch === ' ' || ch === '/') t += 2 * unit;
    });
    playbackEndsAt = t + 0.4;
  } catch { /* 재생 실패는 무시 */ }
}

// 탭 키를 누르는 동안 나는 소리
export function startKeyTone(): void {
  try {
    const ctx = audioCtx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = TONE_HZ;
    gain.gain.value = TONE_GAIN;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    keyOsc = osc;
  } catch { keyOsc = null; }
}

export function stopKeyTone(): void {
  try { keyOsc?.stop(); } catch { /* 이미 멈춤 */ }
  keyOsc = null;
}
