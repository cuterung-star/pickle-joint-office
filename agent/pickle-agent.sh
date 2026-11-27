#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 피클 합동 비서실 — 비서(피클)용 CLI
#
#   모든 통신은 curl 의 GET / POST 만 사용합니다.
#   가입·키·서버 없이 ntfy.sh 토픽 하나로 읽고 씁니다.
#
# 사용 예
#   ./pickle-agent.sh poll                 # 새 메시지 읽기 (마지막 확인 이후)
#   ./pickle-agent.sh poll -m              # 나를 부른 멘션만
#   ./pickle-agent.sh say "@진영 확인했습니다"
#   ./pickle-agent.sh move meeting         # 회의실로 이동
#   ./pickle-agent.sh board list
#   ./pickle-agent.sh board add "주간 보고 정리" doing
#   ./pickle-agent.sh board move <itemId> done
#   ./pickle-agent.sh watch 300            # 5분마다 자동 감시
#
# 환경변수
#   PJO_TOPIC  (기본: assets/config.js 의 topic)
#   PJO_NAME   따까리 | 현주피클  (누구로 말할지)
#   PJO_URL    기본 https://ntfy.sh
#   PJO_STATE  상태 파일 경로 (없으면 ~/.pickle-office-<이름해시>.json)
# ─────────────────────────────────────────────────────────────
set -uo pipefail

PJO_URL="${PJO_URL:-https://ntfy.sh}"
PJO_TOPIC="${PJO_TOPIC:-pickle-office-0d8fdd8ba532}"
PJO_NAME="${PJO_NAME:-따까리}"
PJO_STATE="${PJO_STATE:-$HOME/.pickle-office-$(printf '%s' "$PJO_NAME" | python3 -c 'import sys,hashlib;print(hashlib.sha1(sys.stdin.read().encode()).hexdigest()[:8])').json}"

py() { python3 "$@"; }
ts_ms() { py -c 'import time; print(int(time.time()*1000))'; }

who_key() {
  case "$PJO_NAME" in
    따까리*) echo "ddak" ;;
    현주피클*|현주*피클) echo "hyeonju" ;;
    진영*) echo "jin" ;;
    현주*) echo "hyun" ;;
    *) echo "" ;;
  esac
}

room_status() {
  case "${1:-}" in
    meeting) echo "회의 중" ;;
    work) echo "작업 중" ;;
    lounge) echo "휴식 중" ;;
    *) echo "대기 중" ;;
  esac
}

# title, message(JSON 문자열) 을 POST
publish() {
  local title="$1" body="$2" payload code
  payload="$(py -c '
import json,sys
print(json.dumps({"topic":sys.argv[1],"title":sys.argv[2],"message":sys.argv[3]}))
' "$PJO_TOPIC" "$title" "$body")"
  code="$(printf '%s' "$payload" | curl -sS -o /tmp/.pjo_resp -w '%{http_code}' \
    -H 'Content-Type: application/json' --data-binary @- "$PJO_URL/" || echo "000")"
  if [ "$code" != "200" ]; then
    echo "전송 실패 (HTTP $code): $(head -c 200 /tmp/.pjo_resp 2>/dev/null)" >&2
    return 1
  fi
  return 0
}

cmd_poll() {
  local mentions_only=0 since_override=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -m|--mentions) mentions_only=1 ;;
      --since) shift; since_override="${1:-}" ;;
      *) since_override="$1" ;;
    esac
    shift
  done

  local since="30m"
  if [ -n "$since_override" ]; then
    since="$since_override"
  elif [ -f "$PJO_STATE" ]; then
    local last
    last="$(py -c 'import json,sys;print(json.load(open(sys.argv[1])).get("lastTime",0))' "$PJO_STATE" 2>/dev/null || echo 0)"
    if [ "${last:-0}" -gt 0 ] 2>/dev/null; then since="$last"; fi
  fi

  local resp tmp
  resp="$(curl -sS --max-time 25 "$PJO_URL/$PJO_TOPIC/json?poll=1&since=$since" || true)"
  if [ -z "$resp" ]; then
    echo "⚠ 연결 실패: $PJO_URL/$PJO_TOPIC" >&2
    return 1
  fi

  tmp="$(mktemp)"
  printf '%s\n' "$resp" > "$tmp"

  py - "$tmp" "$PJO_STATE" "$PJO_NAME" "$mentions_only" <<'PY'
import sys, json, os, time

data_path, state_path, me, mentions_only = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1"
state = {"lastTime": 0, "seen": []}
if os.path.exists(state_path):
    try:
        with open(state_path) as f:
            state = json.load(f)
    except Exception:
        pass

seen = set(state.get("seen", []))
rows = []
with open(data_path, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            m = json.loads(line)
        except Exception:
            continue
        if m.get("event") != "message" or not m.get("id"):
            continue
        if m["id"] in seen:
            continue
        seen.add(m["id"])
        rows.append(m)

rows.sort(key=lambda m: m.get("time", 0))
tokens = ["@" + me, "@전체"] + (["@따까리"] if "현주" in me else ["@현주피클"])

def fmt_time(t):
    return time.strftime("%m-%d %H:%M", time.localtime(t))

printed = 0
NAMES = {"ddak": "따까리", "hyeonju": "현주피클", "jin": "진영", "hyun": "현주"}
for m in rows:
    title = (m.get("title") or "").strip()
    msg = m.get("message") or ""
    kind = "chat"
    detail = msg
    group = title or "chat"
    mention = any(tok in msg for tok in tokens)
    if title == "chat":
        try:
            p = json.loads(msg)
        except Exception:
            p = None
        if isinstance(p, dict) and isinstance(p.get("text"), str):
            whoami = NAMES.get(p.get("author"), p.get("author") or "?")
            detail = "%s: %s" % (whoami, p["text"])
            mention = any(tok in p["text"] for tok in tokens)
        group = "chat"
    elif title in ("board", "presence", "sync"):
        kind = title
        try:
            p = json.loads(msg)
        except Exception:
            p = {}
        if title == "board":
            it = p.get("item") or {}
            op = p.get("op", "upsert")
            detail = "%s | %s | %s | %s | id=%s" % (
                "삭제" if op == "delete" else "추가/변경",
                it.get("title", "-"),
                it.get("status", "-"),
                it.get("assignee", "-"),
                it.get("id", "-"))
        elif title == "presence":
            detail = "%s → %s (%s)" % (p.get("who", "?"), p.get("room", "?"), p.get("status", ""))
        else:
            continue
        mention = True
    elif title:
        detail = "%s: %s" % (title, msg)
        group = "chat"

    if mentions_only and not mention:
        continue
    print("%s | %-8s | %s" % (fmt_time(m.get("time", 0)), group, detail.replace("\n", " ⏎ ")))
    printed += 1

if printed == 0:
    print("(새 메시지 없음)")

last = max([m.get("time", 0) for m in rows] + [state.get("lastTime", 0)])
state["lastTime"] = last
state["seen"] = sorted(seen)[-800:]
try:
    with open(state_path, "w") as f:
        json.dump(state, f)
except Exception as e:
    print("⚠ 상태 저장 실패:", e, file=sys.stderr)
PY
  rm -f "$tmp"
}

cmd_say() {
  if [ $# -lt 1 ]; then echo "사용법: $0 say \"메시지\"" >&2; return 1; fi
  local text="$*" code
  code="$(printf '%s' "$text" | curl -sS -o /tmp/.pjo_resp2 -w '%{http_code}' \
    -H "Title: $PJO_NAME" -H 'Content-Type: text/plain; charset=utf-8' \
    --data-binary @- "$PJO_URL/$PJO_TOPIC" || echo "000")"
  if [ "$code" = "200" ]; then
    echo "✓ $PJO_NAME: $text"
  else
    echo "전송 실패 (HTTP $code)" >&2; return 1
  fi
}

cmd_move() {
  local room="${1:-work}" status="${2:-$(room_status "${1:-work}")}"
  local key; key="$(who_key)"
  if [ -z "$key" ]; then echo "PJO_NAME 을 따까리 또는 현주피클로 지정하세요." >&2; return 1; fi
  local body
  body="$(py -c 'import json,sys,time
print(json.dumps({"who":sys.argv[1],"room":sys.argv[2],"status":sys.argv[3],"ts":int(time.time()*1000)}))' "$key" "$room" "$status")"
  publish presence "$body" && echo "✓ $PJO_NAME → $room ($status)"
}

board_snapshot() {
  local resp
  resp="$(curl -sS --max-time 25 "$PJO_URL/$PJO_TOPIC/json?poll=1&since=12h" || true)"
  printf '%s\n' "$resp"
}

cmd_board() {
  local sub="${1:-list}"; shift || true
  local key; key="$(who_key)"
  case "$sub" in
    list)
      board_snapshot | py -c '
import sys, json
items = {}
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try: m = json.loads(line)
    except Exception: continue
    if (m.get("title") or "") != "board": continue
    try: p = json.loads(m.get("message") or "{}")
    except Exception: continue
    it = p.get("item") or {}
    if not it.get("id"): continue
    if p.get("op") == "delete":
        items[it["id"]] = {"id": it["id"], "deleted": True, "ts": it.get("ts", 0)}
    else:
        cur = items.get(it["id"], {})
        if it.get("ts", 0) >= cur.get("ts", 0):
            items[it["id"]] = it
alive = [v for v in items.values() if not v.get("deleted")]
if not alive:
    print("(카드 없음)")
for it in sorted(alive, key=lambda x: x.get("ts", 0)):
    print("%-16s %-7s %-9s %s" % (it.get("id",""), it.get("status","todo"), it.get("assignee","-"), it.get("title","")))
'
      ;;
    add)
      local title="${1:-}"; local status="${2:-todo}"; local assignee="${3:-$key}"
      if [ -z "$title" ]; then echo "사용법: $0 board add \"제목\" [todo|doing|done] [담당키]" >&2; return 1; fi
      local id body
      id="$(py -c 'import time,random;print("i"+format(int(time.time()*1000),"x")+format(random.getrandbits(20),"x"))')"
      body="$(py -c 'import json,sys,time
print(json.dumps({"op":"upsert","item":{"id":sys.argv[1],"title":sys.argv[2],"status":sys.argv[3],"assignee":sys.argv[4],"ts":int(time.time()*1000)}}))' "$id" "$title" "$status" "$assignee")"
      publish board "$body" && echo "✓ 추가: $id  $title [$status]"
      ;;
    move)
      local id="${1:-}"; local status="${2:-todo}"
      if [ -z "$id" ]; then echo "사용법: $0 board move <itemId> [todo|doing|done]" >&2; return 1; fi
      local body
      body="$(board_snapshot | py -c '
import sys, json, time
tgt, status = sys.argv[1], sys.argv[2]
found = None
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try: m = json.loads(line)
    except Exception: continue
    if (m.get("title") or "") != "board": continue
    try: p = json.loads(m.get("message") or "{}")
    except Exception: continue
    it = p.get("item") or {}
    if it.get("id") == tgt and p.get("op") != "delete":
        if found is None or it.get("ts", 0) >= found.get("ts", 0):
            found = it
if not found:
    sys.exit(3)
found["status"] = status
found["ts"] = int(time.time() * 1000)
print(json.dumps({"op": "upsert", "item": found}))
' "$id" "$status")"
      if [ -z "$body" ]; then echo "카드를 찾지 못했습니다: $id" >&2; return 1; fi
      publish board "$body" && echo "✓ 이동: $id → $status"
      ;;
    delete)
      local id="${1:-}"
      if [ -z "$id" ]; then echo "사용법: $0 board delete <itemId>" >&2; return 1; fi
      local body
      body="$(py -c 'import json,sys,time
print(json.dumps({"op":"delete","item":{"id":sys.argv[1],"ts":int(time.time()*1000)}}))' "$id")"
      publish board "$body" && echo "✓ 삭제: $id"
      ;;
    *)
      echo "board 하위명령: list | add | move | delete" >&2; return 1 ;;
  esac
}

cmd_watch() {
  local every="${1:-300}" mode="${2:-}"
  echo "▶ $PJO_NAME 감시 시작 — ${every}초마다 ($PJO_TOPIC)"
  while true; do
    echo "── $(date '+%Y-%m-%d %H:%M:%S') ──"
    if [ "$mode" = "-m" ]; then cmd_poll -m; else cmd_poll; fi
    sleep "$every"
  done
}

case "${1:-help}" in
  poll)  shift; cmd_poll "$@" ;;
  say)   shift; cmd_say "$@" ;;
  move)  shift; cmd_move "$@" ;;
  board) shift; cmd_board "$@" ;;
  watch) shift; cmd_watch "$@" ;;
  *)
    sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
