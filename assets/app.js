/* 피클 합동 비서실 — 화면(UI) */
(function () {
  "use strict";

  var cfg = window.PJO_CONFIG;
  var store = new window.OfficeStore();

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var ROOM_BOX = {
    meeting: { x: 25, y: 33 },
    work: { x: 75, y: 33 },
    lounge: { x: 50, y: 79 }
  };
  var SLOT = { ddak: -9, hyeonju: 9 };

  var selectedWho = null;
  var htmlEscape = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  function who(key) {
    return (cfg.agents && cfg.agents[key]) || (cfg.people && cfg.people[key]) || null;
  }
  function whoName(key, fallback) {
    var w = who(key);
    return w ? w.name : (fallback || "안내");
  }
  function whoColor(key) {
    var w = who(key);
    return w ? w.color : "#94A3B8";
  }
  function whoGlyph(key) {
    var w = who(key);
    return w ? w.glyph : "·";
  }
  function timeText(ts) {
    try {
      return new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch (e) { return ""; }
  }
  function dayText(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일 " +
      ["일", "월", "화", "수", "목", "금", "토"][d.getDay()] + "요일";
  }
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function uid() {
    return "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------------- 연결 상태 ---------------- */
  function renderConn() {
    var pill = $("#conn");
    var text = $("#conn-text");
    var map = {
      live: ["실시간 연결됨", "live"],
      connecting: ["연결 중…", "wait"],
      reconnecting: ["다시 연결 중…", "wait"],
      offline: ["오프라인 · 저장된 내용 표시", "off"],
      polling: ["주기적 확인 중", "wait"]
    };
    var v = map[store.connState] || map.connecting;
    text.textContent = v[0];
    pill.className = "conn " + v[1];
    pill.title = "눌러서 새로 연결";
  }

  /* ---------------- 오피스 맵 ---------------- */
  function renderAvatars() {
    var wrap = $("#avatars");
    Object.keys(cfg.agents).forEach(function (key) {
      var agent = cfg.agents[key];
      var p = store.getPresence(key);
      var box = ROOM_BOX[p.room] || ROOM_BOX.work;
      var el = $('.avatar[data-who="' + key + '"]', wrap);
      if (!el) {
        el = document.createElement("button");
        el.type = "button";
        el.className = "avatar";
        el.dataset.who = key;
        el.innerHTML =
          '<span class="av-glyph"></span>' +
          '<span class="av-name"></span>' +
          '<span class="av-status"></span>';
        el.addEventListener("click", function () {
          selectedWho = selectedWho === key ? null : key;
          renderAvatars();
          renderRooms();
        });
        wrap.appendChild(el);
      }
      el.style.left = (box.x + (SLOT[key] || 0)) + "%";
      el.style.top = box.y + "%";
      el.style.setProperty("--c", agent.color);
      el.style.setProperty("--ink", agent.ink || "#1F2937");
      $(".av-glyph", el).textContent = agent.glyph;
      $(".av-name", el).textContent = agent.name;
      $(".av-status", el).textContent = p.status || "대기 중";
      el.classList.toggle("selected", selectedWho === key);
      el.setAttribute("aria-label", agent.name + " · " + (cfg.rooms[p.room] || {}).name + " · " + (p.status || ""));
      el.setAttribute("aria-pressed", selectedWho === key ? "true" : "false");
    });
  }

  function renderRooms() {
    $$(".room").forEach(function (roomEl) {
      var key = roomEl.dataset.room;
      var occupants = Object.keys(cfg.agents).filter(function (k) {
        return store.getPresence(k).room === key;
      }).map(function (k) { return cfg.agents[k].name; });
      roomEl.classList.toggle("armed", !!selectedWho);
      if (selectedWho) {
        roomEl.setAttribute("aria-label", cfg.rooms[key].name + "으로 " + cfg.agents[selectedWho].name + " 이동");
      } else {
        roomEl.setAttribute("aria-label", cfg.rooms[key].name + (occupants.length ? " · " + occupants.join(" · ") : ""));
      }
    });
    var hint = $("#map-hint");
    if (hint) {
      hint.textContent = selectedWho
        ? cfg.agents[selectedWho].name + "을(를) 옮길 방을 누르세요"
        : "방을 누르면 내 비서 이동 · 아바타 선택 시 지정 이동";
      hint.classList.toggle("active", !!selectedWho);
    }
  }

  function moveAgent(key, room) {
    var roomCfg = cfg.rooms[room];
    if (!roomCfg) return;
    var current = store.getPresence(key);
    var status = roomCfg.status || current.status || "대기 중";
    store.setPresence(key, room, status).catch(function () { toast("이동을 저장하지 못했어요. 연결을 확인해 주세요."); });
    selectedWho = null;
    renderAvatars();
    renderRooms();
  }

  function renderAvatarControls() {
    var wrap = $("#avatar-controls");
    if (!wrap.dataset.built) {
      wrap.dataset.built = "1";
      Object.keys(cfg.agents).forEach(function (key) {
        var agent = cfg.agents[key];
        var row = document.createElement("div");
        row.className = "ctrl";
        row.dataset.owner = key;
        row.style.setProperty("--c", agent.color);
        row.innerHTML =
          '<span class="ctrl-glyph"></span>' +
          '<span class="ctrl-name"><b></b><small></small></span>' +
          '<label class="ctrl-field"><span>방</span><select class="ctrl-room"></select></label>' +
          '<label class="ctrl-field"><span>상태</span><select class="ctrl-status"></select></label>';
        $(".ctrl-glyph", row).textContent = agent.glyph;
        $("b", row).textContent = agent.name;
        $("small", row).textContent = agent.note;
        var roomSel = $(".ctrl-room", row);
        Object.keys(cfg.rooms).forEach(function (r) {
          var o = document.createElement("option");
          o.value = r; o.textContent = cfg.rooms[r].emoji + " " + cfg.rooms[r].name;
          roomSel.appendChild(o);
        });
        roomSel.addEventListener("change", function () { moveAgent(key, roomSel.value); });
        var stSel = $(".ctrl-status", row);
        cfg.statuses.forEach(function (s) {
          var o = document.createElement("option");
          o.value = s; o.textContent = s;
          stSel.appendChild(o);
        });
        stSel.addEventListener("change", function () {
          var p = store.getPresence(key);
          store.setPresence(key, p.room, stSel.value).catch(function () { toast("상태를 저장하지 못했어요."); });
        });
        wrap.appendChild(row);
      });
    }
    Object.keys(cfg.agents).forEach(function (key) {
      var row = $('.ctrl[data-owner="' + key + '"]', wrap);
      if (!row) return;
      var p = store.getPresence(key);
      $(".ctrl-room", row).value = p.room;
      $(".ctrl-status", row).value = cfg.statuses.indexOf(p.status) >= 0 ? p.status : "대기 중";
    });
  }

  /* ---------------- 채팅 ---------------- */
  function renderChat() {
    var log = $("#chat-log");
    var nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
    var frag = document.createDocumentFragment();
    var msgs = store.messages;
    var lastDay = "";

    if (!msgs.length) {
      var empty = document.createElement("div");
      empty.className = "chat-empty";
      empty.innerHTML =
        '<div class="empty-mark">🏢</div>' +
        '<p class="empty-title">합동 비서실에 오신 것을 환영합니다</p>' +
        '<p class="empty-body">아래에 <b>@따까리</b> 나 <b>@현주피클</b> 을 붙여 업무를 지시해 보세요.<br>' +
        '비서가 답장하면 이 창에 바로 나타납니다.</p>';
      frag.appendChild(empty);
    }

    msgs.forEach(function (m) {
      var dk = dayKey(m.ts);
      if (dk !== lastDay) {
        lastDay = dk;
        var day = document.createElement("div");
        day.className = "day";
        var span = document.createElement("span");
        span.textContent = dayText(m.ts);
        day.appendChild(span);
        frag.appendChild(day);
      }
      frag.appendChild(buildMessage(m));
    });

    log.replaceChildren(frag);
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }

  function buildMessage(m) {
    var row = document.createElement("div");
    row.className = "msg";
    var isAgent = !!(cfg.agents && cfg.agents[m.author]);
    var isMine = m.author === store.identity;
    row.classList.toggle("agent", isAgent);
    row.classList.toggle("mine", isMine);
    row.style.setProperty("--c", whoColor(m.author));

    var av = document.createElement("span");
    av.className = "msg-av";
    av.textContent = whoGlyph(m.author);
    row.appendChild(av);

    var body = document.createElement("div");
    body.className = "msg-body";

    var meta = document.createElement("div");
    meta.className = "msg-meta";
    var name = document.createElement("span");
    name.className = "msg-who";
    name.textContent = whoName(m.author, m.name);
    meta.appendChild(name);
    var t = document.createElement("time");
    t.className = "msg-time";
    t.textContent = timeText(m.ts);
    meta.appendChild(t);
    if (m.status === "sending") {
      var s = document.createElement("span"); s.className = "msg-state"; s.textContent = "전송 중";
      meta.appendChild(s);
    } else if (m.status === "failed") {
      var f = document.createElement("button");
      f.type = "button"; f.className = "msg-state fail"; f.textContent = "전송 실패 · 다시 보내기";
      f.addEventListener("click", function () { store.retryMessage(m.cid); });
      meta.appendChild(f);
    }
    body.appendChild(meta);

    var bubble = document.createElement("div");
    bubble.className = "msg-text";
    appendRich(bubble, m.text);
    body.appendChild(bubble);

    row.appendChild(body);
    return row;
  }

  var MENTION_TOKENS = { "@따까리": 1, "@현주피클": 1, "@전체": 1, "@진영": 1, "@현주": 1 };

  function appendRich(el, text) {
    var parts = String(text).split(/(@따까리|@현주피클|@전체|@진영|@현주)/g);
    parts.forEach(function (part) {
      if (!part) return;
      if (MENTION_TOKENS[part]) {
        var mark = document.createElement("mark");
        mark.className = "mention";
        mark.textContent = part;
        el.appendChild(mark);
      } else {
        var lines = part.split("\n");
        lines.forEach(function (line, i) {
          if (i) el.appendChild(document.createElement("br"));
          if (line) el.appendChild(document.createTextNode(line));
        });
      }
    });
  }

  function sendCurrent() {
    var input = $("#chat-input");
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    autoSize(input);
    store.sendChat(text, store.identity).catch(function () {
      toast("메시지를 보내지 못했어요. 연결을 확인해 주세요.");
    });
    $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
  }

  function autoSize(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
  }

  function insertMention(token) {
    var input = $("#chat-input");
    var start = input.selectionStart || 0;
    var end = input.selectionEnd || 0;
    var v = input.value;
    var before = v.slice(0, start);
    var needSpace = before && !/\s$/.test(before);
    var insert = (needSpace ? " " : "") + token + " ";
    input.value = before + insert + v.slice(end);
    var pos = start + insert.length;
    input.focus();
    input.setSelectionRange(pos, pos);
    autoSize(input);
  }

  /* ---------------- 작업 보드 ---------------- */
  function boardItems() {
    return Object.keys(store.items)
      .map(function (k) { return store.items[k]; })
      .filter(function (it) { return it && !it.deleted && it.title; })
      .sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
  }

  function renderBoard() {
    var all = boardItems();
    Object.keys(cfg.board).forEach(function (status) {
      var body = $('.col-body[data-status="' + status + '"]');
      if (!body) return;
      var list = all.filter(function (it) { return (it.status || "todo") === status; });
      var count = $('.col[data-status="' + status + '"] .count');
      if (count) count.textContent = list.length ? list.length : "";
      body.replaceChildren.apply(body, list.map(buildCard));
      if (!list.length) {
        var ph = document.createElement("p");
        ph.className = "col-empty";
        ph.textContent = status === "todo" ? "할 일을 추가해 보세요" : "—";
        body.appendChild(ph);
      }
    });
  }

  function buildCard(it) {
    var el = document.createElement("article");
    el.className = "task";
    el.dataset.id = it.id;
    el.draggable = true;
    el.style.setProperty("--c", it.assignee && who(it.assignee) ? who(it.assignee).color : "#CBD5E1");

    var title = document.createElement("div");
    title.className = "task-title";
    title.textContent = it.title;
    el.appendChild(title);

    var foot = document.createElement("div");
    foot.className = "task-foot";
    var chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = it.assignee && who(it.assignee) ? who(it.assignee).name : "담당 없음";
    foot.appendChild(chip);

    var actions = document.createElement("div");
    actions.className = "task-actions";
    var order = Object.keys(cfg.board);
    var idx = order.indexOf(it.status || "todo");
    if (idx > 0) actions.appendChild(iconBtn("◀", "이전 단계로", function () { setStatus(it, order[idx - 1]); }));
    if (idx < order.length - 1) actions.appendChild(iconBtn("▶", "다음 단계로", function () { setStatus(it, order[idx + 1]); }));
    actions.appendChild(iconBtn("✕", "삭제", function () { store.deleteItem(it.id); }, "danger"));
    foot.appendChild(actions);
    el.appendChild(foot);

    el.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData("text/plain", it.id);
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", function () { el.classList.remove("dragging"); });
    return el;
  }

  function iconBtn(label, title, fn, kind) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn" + (kind ? " " + kind : "");
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
    return b;
  }

  function setStatus(it, status) {
    store.upsertItem(Object.assign({}, it, { status: status })).catch(function () {
      toast("보드를 저장하지 못했어요.");
    });
  }

  function addTask(e) {
    e.preventDefault();
    var input = $("#board-title");
    var assignee = $("#board-assignee").value;
    var title = input.value.trim();
    if (!title) { input.focus(); return; }
    var item = {
      id: uid(), title: title.slice(0, 120), status: "todo",
      assignee: assignee || "", ts: Date.now()
    };
    input.value = "";
    store.upsertItem(item).catch(function () { toast("보드를 저장하지 못했어요."); });
    input.focus();
  }

  /* ---------------- 토스트 ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3500);
  }

  /* ---------------- 이벤트 연결 ---------------- */
  function wire() {
    $$(".room").forEach(function (roomEl) {
      roomEl.addEventListener("click", function () {
        var target = selectedWho || (store.identity === "hyeonju" ? "hyeonju" : "ddak");
        moveAgent(target, roomEl.dataset.room);
      });
    });

    $("#conn").addEventListener("click", function () { store.reconnect(); });

    var form = $("#chat-form");
    form.addEventListener("submit", function (e) { e.preventDefault(); sendCurrent(); });

    var input = $("#chat-input");
    input.addEventListener("input", function () { autoSize(input); });
    input.addEventListener("keydown", function (e) {
      var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !coarse) {
        e.preventDefault();
        sendCurrent();
      }
    });

    $$("#chat-quick [data-mention]").forEach(function (b) {
      b.addEventListener("click", function () { insertMention(b.dataset.mention); });
    });

    $("#board-add").addEventListener("submit", addTask);

    $$(".col").forEach(function (col) {
      col.addEventListener("dragover", function (e) { e.preventDefault(); col.classList.add("over"); });
      col.addEventListener("dragleave", function () { col.classList.remove("over"); });
      col.addEventListener("drop", function (e) {
        e.preventDefault();
        col.classList.remove("over");
        var id = e.dataTransfer.getData("text/plain");
        var it = store.items[id];
        if (it && (it.status || "todo") !== col.dataset.status) setStatus(it, col.dataset.status);
      });
    });

    var idSel = $("#identity-select");
    idSel.value = store.identity;
    idSel.addEventListener("change", function () {
      store.setIdentity(idSel.value);
      renderChat();
    });

    $("#reset-local").addEventListener("click", function () {
      if (confirm("이 브라우저에 저장된 대화·보드 캐시를 지우고 새로 불러옵니다. 계속할까요?")) store.resetLocal();
    });
  }

  /* ---------------- 시작 ---------------- */
  function init() {
    // 보드 담당자 선택지
    var sel = $("#board-assignee");
    [["", "담당 없음"]].concat(
      Object.keys(cfg.agents).map(function (k) { return [k, cfg.agents[k].name]; }),
      Object.keys(cfg.people).map(function (k) { return [k, cfg.people[k].name]; })
    ).forEach(function (pair) {
      var o = document.createElement("option");
      o.value = pair[0]; o.textContent = pair[1];
      sel.appendChild(o);
    });

    wire();
    var endpoint = String(cfg.endpoint || "https://ntfy.sh").replace(/\/+$/, "");
    $$(".ep").forEach(function (el) { el.textContent = endpoint + "/" + cfg.topic; });
    renderConn();
    renderAvatars();
    renderRooms();
    renderAvatarControls();
    renderChat();
    renderBoard();
    autoSize($("#chat-input"));

    store.on(function (kind, s) {
      if (kind === "conn") renderConn();
      else if (kind === "chat") renderChat();
      else if (kind === "board") renderBoard();
      else if (kind === "presence") { renderAvatars(); renderRooms(); renderAvatarControls(); }
      else if (kind === "identity") { /* 헤더 선택은 이벤트로 직접 갱신 */ }
      else if (kind === "data") {
        renderChat(); renderBoard(); renderAvatars(); renderRooms(); renderAvatarControls();
      } else if (kind === "error") {
        renderConn();
      }
    });

    window.addEventListener("beforeunload", function () { store.saveCache(); });
    window.addEventListener("online", function () { store.reconnect(); });
    window.addEventListener("offline", function () { store.setConn("offline"); });

    store.start().then(function () {
      renderChat(); renderBoard(); renderAvatars(); renderRooms(); renderAvatarControls(); renderConn();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
