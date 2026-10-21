// 모스부호 표 · 한글 분해/조합 · 인코딩/디코딩 (DOM을 쓰지 않는 순수 로직)

import type { Lang } from '../shared/types';

type Table = Record<string, string>;


// 모스부호 표
export const MORSE_EN: Table = {
  A: '.-',   B: '-...', C: '-.-.', D: '-..',  E: '.',    F: '..-.',
  G: '--.',  H: '....', I: '..',   J: '.---', K: '-.-',  L: '.-..',
  M: '--',   N: '-.',   O: '---',  P: '.--.', Q: '--.-', R: '.-.',
  S: '...',  T: '-',    U: '..-',  V: '...-', W: '.--',  X: '-..-',
  Y: '-.--', Z: '--..',
};

export const MORSE_KO: Table = {
  // 자음
  'ㄱ': '.-..', 'ㄴ': '..-.', 'ㄷ': '-...', 'ㄹ': '...-', 'ㅁ': '--',   'ㅂ': '.--',  'ㅅ': '--.',
  'ㅇ': '-.-',  'ㅈ': '.--.', 'ㅊ': '-.-.', 'ㅋ': '-..-', 'ㅌ': '--..', 'ㅍ': '---',  'ㅎ': '.---',
  // 모음
  'ㅏ': '.',    'ㅑ': '..',   'ㅓ': '-',    'ㅕ': '...',  'ㅗ': '.-',   'ㅛ': '-.',
  'ㅜ': '....', 'ㅠ': '.-.',  'ㅡ': '-..',  'ㅣ': '..-',  'ㅐ': '--.-', 'ㅔ': '-.--',
};

// 공통 (숫자, 기호)
export const MORSE_COMMON: Table = {
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--',
  '/': '-..-.',  '-': '-....-', '@': '.--.-.', ':': '---...',
};

const invert = (obj: Table): Table => Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k]));

export const CODE_TABLE: Record<Lang, Table> = {
  en: { ...MORSE_EN, ...MORSE_COMMON },
  ko: { ...MORSE_KO, ...MORSE_COMMON },
};
const CHAR_TABLE: Record<Lang, Table> = {
  en: invert(CODE_TABLE.en),
  ko: invert(CODE_TABLE.ko),
};

export const LANG_INFO: Record<Lang, { label: string; placeholder: string; allowed: string }> = {
  en: { label: 'EN', placeholder: '메시지 입력 (영문·숫자)', allowed: '영문·숫자·.,?!/-@:' },
  ko: { label: '한',  placeholder: '메시지 입력 (한글·숫자)', allowed: '한글·숫자·.,?!/-@:' },
};


// 한글 분해 · 조합
const HANGUL_START = 0xAC00;
const HANGUL_END = 0xD7A3;
const INITIALS = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const VOWELS = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const FINALS = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

const BASE_CONSONANTS = [...'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'];
const BASE_VOWELS = [...'ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣㅐㅔ'];
export const isConsonant = (ch: string) => BASE_CONSONANTS.includes(ch);
export const isVowel = (ch: string) => BASE_VOWELS.includes(ch);

// 부호표에 없는 자모는 기본 자모로 풀어서 표현
const SPLIT: Table = {
  'ㄲ': 'ㄱㄱ', 'ㄸ': 'ㄷㄷ', 'ㅃ': 'ㅂㅂ', 'ㅆ': 'ㅅㅅ', 'ㅉ': 'ㅈㅈ',
  'ㄳ': 'ㄱㅅ', 'ㄵ': 'ㄴㅈ', 'ㄶ': 'ㄴㅎ', 'ㄺ': 'ㄹㄱ', 'ㄻ': 'ㄹㅁ',
  'ㄼ': 'ㄹㅂ', 'ㄽ': 'ㄹㅅ', 'ㄾ': 'ㄹㅌ', 'ㄿ': 'ㄹㅍ', 'ㅀ': 'ㄹㅎ', 'ㅄ': 'ㅂㅅ',
  'ㅒ': 'ㅑㅣ', 'ㅖ': 'ㅕㅣ', 'ㅘ': 'ㅗㅏ', 'ㅙ': 'ㅗㅐ', 'ㅚ': 'ㅗㅣ',
  'ㅝ': 'ㅜㅓ', 'ㅞ': 'ㅜㅔ', 'ㅟ': 'ㅜㅣ', 'ㅢ': 'ㅡㅣ',
};
const JOIN = invert(SPLIT);

// "한" → ['ㅎ', 'ㅏ', 'ㄴ']
export function toJamo(text: string): string[] {
  const units: string[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    let parts = [ch];
    if (code >= HANGUL_START && code <= HANGUL_END) {
      const i = code - HANGUL_START;
      parts = [INITIALS[Math.floor(i / 588)], VOWELS[Math.floor((i % 588) / 28)], FINALS[i % 28]];
    }
    for (const part of parts.filter(Boolean)) units.push(...(SPLIT[part] || part));
  }
  return units;
}

// ['ㅎ', 'ㅏ', 'ㄴ'] → "한"
export function assembleHangul(units: string[]): string {
  let out = '';
  let i = 0;

  while (i < units.length) {
    let initial = units[i++];

    if (!isConsonant(initial)) { out += initial; continue; }

    // 쌍자음 초성
    const doubled = JOIN[initial + units[i]];
    if (doubled && INITIALS.includes(doubled) && isVowel(units[i + 1])) {
      initial = doubled;
      i++;
    }

    // 모음이 없으면 자음만
    if (!isVowel(units[i])) { out += initial; continue; }

    // 복합모음
    let vowel = units[i++];
    const joinedVowel = JOIN[vowel + units[i]];
    if (joinedVowel && VOWELS.includes(joinedVowel)) {
      vowel = joinedVowel;
      i++;
    }

    // 받침 (뒤에 모음이 오면 다음 글자 초성으로)
    let final = '';
    const [c1, c2, c3, c4] = [units[i], units[i + 1], units[i + 2], units[i + 3]];
    if (isConsonant(c1) && !isVowel(c2)) {
      const pair = JOIN[c1 + c2];
      const nextIsDoubledInitial = isConsonant(c2) && isConsonant(c3) && isVowel(c4) && INITIALS.includes(JOIN[c2 + c3]);
      if (pair && FINALS.includes(pair) && !isVowel(c3) && !nextIsDoubledInitial) {
        final = pair;
        i += 2;
      } else {
        final = c1;
        i += 1;
      }
    }

    const index = (INITIALS.indexOf(initial) * 21 + VOWELS.indexOf(vowel)) * 28 + FINALS.indexOf(final);
    out += String.fromCharCode(HANGUL_START + index);
  }
  return out;
}


// 인코딩 · 디코딩 (글자는 ' ', 단어는 ' / ')
export const encode = (text: string, lang: Lang): string =>
  text.toUpperCase().split(/\s+/).filter(Boolean)
    .map(word => (lang === 'ko' ? toJamo(word) : [...word])
      .map(ch => CODE_TABLE[lang][ch])
      .filter(Boolean)
      .join(' '))
    .filter(Boolean)
    .join(' / ');

export function decode(morse: string, lang: Lang = 'en'): string {
  const table = CHAR_TABLE[lang] || CHAR_TABLE.en;   // 서버에서 이상한 lang이 와도 영문으로
  return morse.split(' / ').map(word => {
    const chars = word.split(' ').filter(Boolean).map(code => table[code] || '·');
    return lang === 'ko' ? assembleHangul(chars) : chars.join('');
  }).join(' ');
}

// 제외될 글자 수
export function countUnsupported(text: string, lang: Lang): number {
  const chars = lang === 'ko' ? toJamo(text.toUpperCase()) : [...text.toUpperCase()];
  return chars.filter(ch => ch.trim() && !CODE_TABLE[lang][ch]).length;
}

export const sanitizeMorse = (s: string): string => s.replace(/[^.\-\/ ]/g, '').replace(/[ /]+$/, '').trim().slice(0, 400);
