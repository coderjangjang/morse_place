// 서버(api/messages.ts)와 프론트(src/)가 같이 쓰는 타입
// 타입만 들어 있어서 `import type`으로 가져오면 번들에 들어가지 않아요.

export type Lang = 'en' | 'ko';

export interface RoomState {
  closed: boolean;
  slow: number;      // 슬로우 모드 초 (0 = 꺼짐)
  notice: string;    // 공지 (빈 문자열 = 없음)
}

/** 서버가 클라이언트에 내려주는 메시지 */
export interface Message {
  id: number;
  cid: string;       // 보낸 기기가 만든 메시지 ID
  name: string;
  morse: string;
  lang: Lang;
  t: number;
  admin?: true;
  mine: boolean;     // 내 메시지인지 (서버가 계산)
}

/** Redis에 저장되는 형태: 보낸 사람 확인용 해시(h)가 붙고 mine은 없음 */
export interface StoredMessage extends Omit<Message, 'mine'> {
  h: string;
}


// 에러
export type ErrorCode =
  | 'bad-room' | 'bad-request' | 'not-found' | 'forbidden'
  | 'banned' | 'timeout' | 'rate' | 'slow' | 'closed' | 'full'
  | 'no-admin' | 'no-storage' | 'wrong' | 'method' | 'server';

export interface ErrorBody {
  error: ErrorCode;
  retryAfter?: number;
  msg?: string;
}


// GET /api/messages?room=&since=&rev=&uid=
export interface GetResponse {
  msgs: Message[];
  rev: number;         // 삭제 횟수
  state: RoomState;
  typing: string[];    // 입력 중인 사람 이름 (나는 제외)
  online: number;
  cids?: string[];     // rev가 다를 때만: 남아 있는 메시지 cid 목록
  from?: number;       //                  목록에서 가장 오래된 id
}


// POST /api/messages (action 값으로 구분)
export interface SendBody {
  action?: undefined;
  room: string;
  name: string;
  morse: string;
  lang: Lang;
  cid: string;
  uid: string;
  key?: string;        // 관리자 토큰
}
export interface DeleteBody { action: 'del'; room: string; cid: string; uid: string; key?: string }
export interface AuthBody { action: 'auth'; key: string }                 // key = 비밀번호
export interface LogoutBody { action: 'logout'; key: string }             // key = 토큰
export interface CommandBody { action: 'cmd'; room: string; key: string; text: string }
export interface TypingBody { action: 'typing'; room: string; uid: string; name: string; on: boolean; key?: string }

export type PostBody = SendBody | DeleteBody | AuthBody | LogoutBody | CommandBody | TypingBody;

// POST 응답
export interface SendResult { ok: true; id: number }
export interface AuthResult { ok: true; token: string }
export interface CommandResult { ok: boolean; msg: string }
export interface OkResult { ok: true }
