// 브라우저 저장소 + 기기 고유 ID

export const store = {
  get(key: string, fallback: string): string {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* 저장 불가 환경이면 무시 */ }
  },
};

// 기기 고유 ID
export const uid: string = (() => {
  let id = store.get('mc-uid', '');
  if (!/^[a-z0-9]{16,32}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(36).padStart(2, '0')).join('');
    store.set('mc-uid', id);
  }
  return id;
})();
