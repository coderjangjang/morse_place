// 진입점: 각 모듈의 이벤트 연결 → 첫 화면 그리기 → 폴링 시작

import { setupAudio } from './audio';
import { restoreBlock } from './block';
import { initComposer } from './composer';
import { initFeed } from './feed';
import { initPolling, poll, schedulePoll, setConnection } from './poll';
import { initRoom, renderRoomBar } from './room';
import { initSend } from './send';
import { initSettings, applySettings } from './settings';
import { initSheet } from './sheet';
import { initTapKey } from './tapkey';

initRoom();
initSettings();
initSheet();
initComposer();
initTapKey();
initFeed();
initSend();
initPolling();
setupAudio();

restoreBlock();
if (location.protocol === 'file:') setConnection('local');

applySettings();
renderRoomBar();
void poll();
schedulePoll();
