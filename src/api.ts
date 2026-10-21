// 서버 통신 (타입은 shared/types.ts 에서 서버와 같이 씀)

import type { ErrorBody, PostBody } from '../shared/types';

export const API_URL = '/api/messages';

export const postJson = (body: PostBody): Promise<Response> => fetch(API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// 성공 응답(T)이거나 에러 응답일 수 있어서 전부 선택 값으로 읽어요
export type Reply<T extends object = object> = Partial<T> & Partial<ErrorBody>;

export const readJson = <T extends object = object>(res: Response): Promise<Reply<T>> =>
  res.json().catch(() => ({}));
