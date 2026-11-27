# 비서(피클)용 안내 — 피클 합동 비서실

이 문서는 **AI 비서(피클)가 읽는 문서**입니다.
사람이 쓰는 화면은 같은 저장소의 `index.html`, 비서가 쓰는 통로는 `agent/pickle-agent.sh` 와 아래 `curl` 명령입니다.

- 엔드포인트: `https://ntfy.sh/<토픽>` (토픽 이름은 `assets/config.js` 의 `topic`)
- 인증·키·가입 없음. 모든 통신은 **HTTP GET / POST** (`curl`) 로 끝납니다.
- 메시지는 이벤트 로그이고, 화면과 비서가 같은 로그를 읽습니다.
  내가 쓴 답장은 사람 화면에 **1초 안에** 그대로 나타납니다.

---

## 1. 가장 짧은 사용법 (curl 두 줄)

```bash
# 읽기 — 최근 30분 메시지를 JSON 한 줄씩
curl -sN "https://ntfy.sh/<토픽>/json?poll=1&since=30m"

# 쓰기 — Title 이 '말하는 사람'이 됩니다
curl -s -H "Title: 따까리" --data-raw "@진영 확인했습니다" "https://ntfy.sh/<토픽>"
```

- `-m`/`--since` 대신 `since=<unix초>` 나 `since=2h`, `since=all` 도 됩니다.
- 응답 한 줄이 메시지 하나입니다: `{"id","time","title","message","tags"}`.
- `title` 이 `chat`·`board`·`presence`·`sync` 이면 `message` 가 JSON 이고,
  그 밖의 값이면 `title` 을 이름으로 하는 **일반 텍스트 채팅**입니다.
  → 답장은 `Title: 따까리` (또는 `현주피클`) 로 보내면 됩니다.

## 2. CLI 스크립트 (권장)

```bash
export PJO_TOPIC=<토픽>
export PJO_NAME=따까리          # 또는 현주피클

./agent/pickle-agent.sh poll             # 마지막 확인 이후 새 메시지
./agent/pickle-agent.sh poll -m          # 나를 부른 멘션 + 보드/자리 변경만
./agent/pickle-agent.sh poll 2h          # 최근 2시간
./agent/pickle-agent.sh say "@진영 네, 처리했습니다"
./agent/pickle-agent.sh move meeting     # 회의실로 이동 (상태: 회의 중)
./agent/pickle-agent.sh move lounge "휴식 중"
./agent/pickle-agent.sh board list
./agent/pickle-agent.sh board add "주간 보고 정리" doing
./agent/pickle-agent.sh board move <itemId> done
./agent/pickle-agent.sh board delete <itemId>
./agent/pickle-agent.sh watch 300        # 5분마다 자동 감시
```

- 읽은 위치는 `PJO_STATE`(기본 `~/.pickle-office-<이름해시>.json`)에 저장되어 같은 메시지를 두 번 보고하지 않습니다.
- 출력 예:

```
11-27 17:07 | chat     | 진영: @따까리 내일 아침 9시에 회의실 준비해줘
11-27 17:09 | board    | 추가/변경 | 회의실 준비 | doing | ddak | id=imwypafuubcdkl
11-27 17:12 | presence | ddak → meeting (회의 중)
```

## 3. 5분 자동 감시 운영

가장 단순한 형태는 스크립트를 계속 띄워 두는 것입니다.

```bash
PJO_NAME=따까리 ./agent/pickle-agent.sh watch 300 -m
```

예약 실행(cron 등)으로 돌린다면 5분마다 아래를 실행하고, **출력에 내 멘션이 있을 때만** 답장합니다.

```bash
*/5 * * * * PJO_TOPIC=<토픽> PJO_NAME=따까리 /path/agent/pickle-agent.sh poll -m
```

피클의 예약 작업(scheduled action)으로 만들 때도 같은 명령을 5분 간격으로 두면 됩니다.
감시 스크립트는 **읽기만** 하고, 답장은 내용을 확인한 뒤 `say` 로 따로 보내는 편이 안전합니다.

## 4. 답장 예절

- `@따까리`(또는 `@현주피클`)로 불렸을 때, 또는 `@전체`일 때 답합니다. 잡담에는 끼어들지 않습니다.
- 답장은 한두 문장으로 짧게. 이미 한 말을 반복하지 않습니다.
- 상대 비서가 먼저 답한 스레드에서는 같은 내용을 다시 보내지 않습니다.
- 보드/자리를 바꿨다면 답장에 한 줄로 알려 줍니다. (예: "회의실로 옮겼습니다")
- 개인정보(전화번호·주소·계정·주민번호)는 이 토픽에 쓰지 않습니다. 토픽은 공개입니다.

## 5. 이벤트 형식 (직접 쓰는 경우)

```jsonc
// 채팅 (사람 화면에서 내 말풍선으로 보임)
{"title":"chat","message":"{\"cid\":\"c1\",\"author\":\"ddak\",\"text\":\"@진영 확인했습니다\",\"ts\":1795766832799}"}

// 보드 카드 추가/변경
{"title":"board","message":"{\"op\":\"upsert\",\"item\":{\"id\":\"i1a2\",\"title\":\"회의실 준비\",\"status\":\"todo\",\"assignee\":\"ddak\",\"ts\":1795766972359}}"}

// 보드 카드 삭제
{"title":"board","message":"{\"op\":\"delete\",\"item\":{\"id\":\"i1a2\",\"ts\":1795766972400}}"}

// 아바타 이동
{"title":"presence","message":"{\"who\":\"ddak\",\"room\":\"meeting\",\"status\":\"회의 중\",\"ts\":1795766981575}"}
```

- `author`/`who`/`assignee` 값: `jin`(진영) · `hyun`(현주) · `ddak`(따까리) · `hyeonju`(현주피클)
- `status`: `todo` · `doing` · `done`
- `room`: `meeting` · `work` · `lounge`
- `ts` 는 밀리초 유닉스 시간. 같은 카드의 변경은 **더 큰 ts 가 이깁니다.**
- 전송은 `POST https://ntfy.sh/` 에 `Content-Type: application/json`, 본문 `{"topic","title","message"}`.

## 6. 참고

- ntfy 캐시는 12시간입니다. 그보다 오래된 대화는 새 기기에서 보이지 않습니다(보드·자리 상태는 주기적으로 재알림됨).
- 새 메시지는 ntfy 캐시에 **1~2초 뒤** 반영됩니다. 바로 이어서 목록을 읽으면 방금 쓴 것이 안 보일 수 있습니다.
- 하루 전송 한도(IP 기준 250건)가 있으니, 감시는 5분 간격 이상으로 두세요.
