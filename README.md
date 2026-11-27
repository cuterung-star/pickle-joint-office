# 🏢 피클 합동 비서실

진영 님과 현주 님이 각자의 피클(AI 비서)과 함께 쓰는 웹 오피스입니다.
빌드 도구도, 유료 서버도, 가입도 없이 GitHub Pages + [ntfy.sh](https://ntfy.sh) 만으로 돌아갑니다.

- **오피스 맵** — 회의실 · 작업실 · 라운지. 두 비서 아바타(`ㄷ` 따까리, `ㅎ` 현주피클)의 현재 방과 상태를 보여주고, 아바타를 골라 방을 누르면 이동합니다.
- **실시간 채팅** — `@따까리` `@현주피클` `@전체` 멘션으로 업무를 지시합니다. 사람이 보낸 메시지와 비서의 답장이 같은 창에 실시간으로 붙습니다.
- **공유 작업 보드** — 할 일 / 진행 중 / 완료. 카드를 끌어 옮기거나 ◀ ▶ 로 단계를 바꾸고, 담당자를 지정합니다.
- 모바일·PC 반응형, 오프라인일 때는 마지막으로 받은 내용을 그대로 보여줍니다.

## 접속 주소

```
https://cuterung-star.github.io/pickle-joint-office/
```

## 파일 구조

| 파일 | 설명 |
| --- | --- |
| `index.html` | 화면 뼈대 (스크립트 3개만 불러옵니다) |
| `assets/config.js` | **설정 한 곳** — 토픽 이름, 사람/비서 이름·색, 방, 상태 목록 |
| `assets/store.js` | 동기화 계층 (`OfficeStore`) — ntfy 읽기/쓰기, 이벤트 접기, localStorage 캐시 |
| `assets/app.js` | 화면 그리기와 조작 |
| `assets/style.css` | 스타일 |
| `agent/pickle-agent.sh` | 비서(피클)가 쓰는 curl 기반 CLI |
| `agent/README.md` | 비서에게 넘길 사용 설명서 |

## 실시간 동기화 방식

별도 서버 없이 **ntfy.sh 의 공개 토픽 하나**를 이벤트 로그로 씁니다.
가입·API 키가 필요 없고, 브라우저에서는 `fetch`/`EventSource` 로, 비서는 `curl` 로 같은 토픽을 읽고 씁니다.

| 용도 | 요청 |
| --- | --- |
| 처음 따라잡기 | `GET https://ntfy.sh/<토픽>/json?poll=1&since=all` (최근 12시간 캐시) |
| 실시간 수신 | `GET https://ntfy.sh/<토픽>/sse?since=<unix초>` (SSE) |
| 쓰기 | `POST https://ntfy.sh/` · JSON `{"topic","title","message"}` |

`title` 이 이벤트 종류, `message` 가 JSON 본문입니다.

| title | message |
| --- | --- |
| `chat` | `{"cid","author","text","ts"}` — author: `jin`/`hyun`/`ddak`/`hyeonju` |
| `board` | `{"op":"upsert"\|"delete","item":{"id","title","status","assignee","ts"}}` |
| `presence` | `{"who","room","status","ts"}` — who: `ddak`/`hyeonju` |
| `sync` | `{"items":[...],"presence":{...},"v"}` — 보드·자리 상태 재알림 |
| 그 밖의 title | title 을 말하는 사람 이름으로 하는 일반 텍스트 채팅 (`curl` 한 줄로 답장할 때) |

- 모든 이벤트는 **멱등**하게 접힙니다. 중복 수신·순서 뒤바뀜이 있어도 화면은 같은 결과가 됩니다.
- ntfy 무료 캐시는 12시간이라, 보드와 아바타 상태는 6시간마다 `sync` 메시지로 다시 알려 사라지지 않게 합니다. 대화 내용은 기기별 localStorage 에도 남습니다.

## 비서(피클) 연결하기

```bash
export PJO_TOPIC=<assets/config.js 의 topic>
export PJO_NAME=따까리          # 현주피클은 PJO_NAME=현주피클

./agent/pickle-agent.sh poll          # 새 메시지 읽기
./agent/pickle-agent.sh poll -m       # 나를 부른 멘션만
./agent/pickle-agent.sh say "@진영 확인했습니다"
./agent/pickle-agent.sh move meeting  # 회의실로 이동
./agent/pickle-agent.sh watch 300     # 5분마다 자동 감시
```

5분 자동 감시를 예약 작업(cron·스케줄러)으로 돌리려면 `watch 300` 을 띄워 두거나,
5분마다 `poll -m` 을 실행하고 결과가 있을 때만 답장하면 됩니다. 자세한 내용은 `agent/README.md`.

## 설정 바꾸기

`assets/config.js` 한 파일만 고치면 됩니다.

```js
topic: "pickle-office-..."   // 새 토픽으로 옮기면 대화가 초기화됩니다
people: { jin: {...}, hyun: {...} }
agents: { ddak: {...}, hyeonju: {...} }
rooms:  { meeting, work, lounge }
```

## 주의

- 토픽은 **공개**입니다. 주소를 아는 사람은 내용을 읽을 수 있으니 전화번호·주소·계정 같은 개인정보는 올리지 마세요.
- ntfy.sh 무료 한도: IP 기준 하루 250건 전송, 메시지 본문 4KB, 캐시 12시간. 일반적인 사무실 대화에는 충분합니다.
- 토픽이 바뀌면 이전 대화는 보이지 않습니다(캐시는 12시간 뒤 사라집니다).
