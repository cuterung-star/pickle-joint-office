/* 피클 합동 비서실 — 실시간 동기화 계층 (OfficeStore)
 *
 * 백엔드: ntfy.sh
 *   - 읽기(폴링) : GET  {endpoint}/{topic}/json?poll=1&since=all
 *   - 실시간 구독 : GET  {endpoint}/{topic}/sse?since=<unix초>
 *   - 쓰기       : POST {endpoint}/   (JSON: {topic,title,message})
 *
 * 메시지는 "이벤트 로그"이고 클라이언트가 이를 접어서 상태를 만듭니다.
 * 모든 적용 규칙이 멱등(idempotent)이라 순서가 뒤바뀌거나 중복 수신해도 안전합니다.
 *
 *   title = "chat"     : {cid, author, text, ts}
 *   title = "board"    : {op:"upsert"|"delete", item:{id,title,status,assignee,ts,deleted?}}
 *   title = "presence" : {who, room, status, ts}
 *   title = "sync"     : {items:[...], presence:{...}, v, part?, parts?}
 *   그 밖의 title      : title을 작성자 이름으로 하는 일반 텍스트 채팅 (curl 한 줄 전송 지원)
 */
(function () {
  "use strict";

  var cfg = window.PJO_CONFIG;
  var BASE = String(cfg.endpoint || "https://ntfy.sh").replace(/\/+$/, "");
  var TOPIC = cfg.topic;
  var CACHE_KEY = "pjo.cache.v2";
  var ID_KEY = "pjo.identity.v1";
  var MAX_MESSAGES = 400;
  var MESSAGE_LIMIT = 3600; // ntfy 본문 4096바이트 제한 → 여유 있게
  var SYNC_EVERY = 6 * 60 * 60 * 1000; // 캐시(12시간) 만료 전에 상태를 다시 알린다

  function now() { return Date.now(); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function parse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  function OfficeStore() {
    this.messages = [];              // {cid, id, author, name, text, ts, time, status}
    this.items = Object.create(null); // id -> item
    this.presence = Object.create(null); // who -> {room, status, ts}
    this.seen = new Set();           // ntfy 메시지 id (중복 방지)
    this.cids = new Set();
    this.lastTime = 0;               // 마지막으로 본 서버 시각(초)
    this.lastSyncPost = 0;
    this.connState = "connecting";
    this.subs = [];
    this.sse = null;
    this.reconnectDelay = 1000;
    this.saveTimer = null;
    this.started = false;
    this.identity = localStorage.getItem(ID_KEY) || "jin";
  }

  OfficeStore.prototype.on = function (fn) { this.subs.push(fn); return this; };
  OfficeStore.prototype.emit = function (kind) {
    for (var i = 0; i < this.subs.length; i++) {
      try { this.subs[i](kind, this); } catch (e) { console.error(e); }
    }
  };

  /* ---------- 연결 상태 ---------- */
  OfficeStore.prototype.setConn = function (state) {
    if (this.connState === state) return;
    this.connState = state;
    this.emit("conn");
  };

  /* ---------- 로컬 캐시 ---------- */
  OfficeStore.prototype.loadCache = function () {
    var raw = null;
    try { raw = localStorage.getItem(CACHE_KEY); } catch (e) { return; }
    var c = parse(raw);
    if (!c) return;
    if (Array.isArray(c.messages)) {
      this.messages = c.messages.filter(function (m) { return m && typeof m.text === "string"; });
      this.messages.forEach(function (m) {
        if (m.cid) this.cids.add(m.cid);
        if (m.id) this.seen.add(m.id);
        if (m.status === "sending") m.status = "failed";
      }, this);
    }
    if (c.items && typeof c.items === "object") {
      Object.keys(c.items).forEach(function (k) { this.items[k] = c.items[k]; }, this);
    }
    if (c.presence && typeof c.presence === "object") {
      Object.keys(c.presence).forEach(function (k) { this.presence[k] = c.presence[k]; }, this);
    }
    if (typeof c.lastTime === "number") this.lastTime = c.lastTime;
    if (typeof c.lastSyncPost === "number") this.lastSyncPost = c.lastSyncPost;
  };

  OfficeStore.prototype.saveCache = function () {
    var self = this;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(function () {
      var data = {
        messages: self.messages.slice(-MAX_MESSAGES),
        items: self.items,
        presence: self.presence,
        lastTime: self.lastTime,
        lastSyncPost: self.lastSyncPost
      };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* 용량 초과 무시 */ }
    }, 300);
  };

  /* ---------- 수신 ---------- */
  OfficeStore.prototype.ingest = function (m) {
    if (!m || !m.id || this.seen.has(m.id)) return false;
    this.seen.add(m.id);
    if (typeof m.time === "number" && m.time > this.lastTime) this.lastTime = m.time;

    var title = (m.title || "").trim();
    var body = m.message || "";
    var p;

    if (title === "chat") {
      p = parse(body);
      if (p && typeof p.text === "string") this.applyChat(p, m);
      else this.applyPlainChat(title, body, m);
      return true;
    }
    if (title === "board") {
      p = parse(body);
      if (p && p.item && p.item.id) this.applyBoard(p);
      return true;
    }
    if (title === "presence") {
      p = parse(body);
      if (p && p.who) this.applyPresence(p);
      return true;
    }
    if (title === "sync") {
      p = parse(body);
      if (p) this.applySync(p);
      return true;
    }
    // 알 수 없는 형식 = 사람이/비서가 보낸 일반 텍스트 채팅
    this.applyPlainChat(title, body, m);
    return true;
  };

  OfficeStore.prototype.applyChat = function (p, m) {
    var cid = p.cid || "srv:" + m.id;
    if (this.cids.has(cid)) {
      for (var i = 0; i < this.messages.length; i++) {
        if (this.messages[i].cid === cid) {
          this.messages[i].status = "sent";
          this.messages[i].id = m.id;
          this.messages[i].time = m.time;
          if (typeof p.ts === "number") this.messages[i].ts = Math.min(this.messages[i].ts, p.ts);
          this.saveCache();
          return;
        }
      }
      return;
    }
    this.cids.add(cid);
    this.messages.push({
      cid: cid,
      id: m.id,
      author: p.author || "unknown",
      name: p.name || "",
      text: String(p.text).slice(0, 2000),
      ts: typeof p.ts === "number" ? p.ts : (m.time || 0) * 1000,
      time: m.time || 0,
      status: "sent"
    });
    this.trimMessages();
    this.saveCache();
  };

  OfficeStore.prototype.applyPlainChat = function (title, text, m) {
    if (!text) return;
    var cid = "srv:" + m.id;
    if (this.cids.has(cid)) return;
    var author = "unknown", name = title || "안내";
    var people = cfg.people || {}, agents = cfg.agents || {};
    Object.keys(agents).forEach(function (k) {
      if (agents[k].name === title || agents[k].mention === title || agents[k].mention === "@" + title) author = k;
    });
    Object.keys(people).forEach(function (k) {
      if (people[k].name === title) author = k;
    });
    this.messages.push({
      cid: cid,
      id: m.id,
      author: author,
      name: name,
      text: String(text).slice(0, 2000),
      ts: (m.time || 0) * 1000,
      time: m.time || 0,
      status: "sent"
    });
    this.cids.add(cid);
    this.trimMessages();
    this.saveCache();
  };

  OfficeStore.prototype.trimMessages = function () {
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
    }
    this.messages.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
  };

  OfficeStore.prototype.applyBoard = function (p) {
    var item = p.item;
    if (p.op === "delete") {
      var old = this.items[item.id];
      this.items[item.id] = Object.assign({}, old || {}, { id: item.id, deleted: true, ts: item.ts || old && old.ts || 0 });
    } else if (typeof item.ts === "number" && item.ts >= ((this.items[item.id] || {}).ts || 0)) {
      this.items[item.id] = item;
    } else if (!this.items[item.id]) {
      this.items[item.id] = item;
    }
    this.saveCache();
  };

  OfficeStore.prototype.applyPresence = function (p) {
    var cur = this.presence[p.who];
    if (!cur || (p.ts || 0) >= (cur.ts || 0)) {
      this.presence[p.who] = { room: p.room || "work", status: p.status || "", ts: p.ts || 0 };
      this.saveCache();
    }
  };

  OfficeStore.prototype.applySync = function (p) {
    var self = this;
    if (Array.isArray(p.items)) {
      p.items.forEach(function (it) {
        if (!it || !it.id) return;
        if (!self.items[it.id] || (it.ts || 0) >= (self.items[it.id].ts || 0)) self.items[it.id] = it;
      });
    }
    if (p.presence && typeof p.presence === "object") {
      Object.keys(p.presence).forEach(function (k) {
        var v = p.presence[k];
        if (!v) return;
        var cur = self.presence[k];
        if (!cur || (v.ts || 0) >= (cur.ts || 0)) self.presence[k] = v;
      });
    }
    if (typeof p.v === "number" && p.v > this.lastSyncPost) this.lastSyncPost = p.v;
    this.saveCache();
  };

  /* ---------- 송신 ---------- */
  OfficeStore.prototype.post = function (title, message) {
    return fetch(BASE + "/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: TOPIC, title: title, message: message })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.error) || ("HTTP " + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  };

  OfficeStore.prototype.postRetry = function (title, message, tries) {
    var self = this;
    var attempt = 0;
    var delay = 800;
    function run() {
      return self.post(title, message).catch(function (err) {
        attempt++;
        if (attempt >= (tries || 3)) throw err;
        var d = err && err.status === 429 ? 6000 : delay;
        delay = Math.min(delay * 3, 15000);
        return wait(d).then(run);
      });
    }
    return run();
  };

  OfficeStore.prototype.sendChat = function (text, author) {
    var cid = "c" + now().toString(36) + Math.random().toString(36).slice(2, 7);
    var msg = {
      cid: cid, id: null, author: author, name: "",
      text: String(text).slice(0, 2000), ts: now(), time: 0, status: "sending"
    };
    this.messages.push(msg);
    this.cids.add(cid);
    this.trimMessages();
    this.emit("chat");

    var self = this;
    return this.postRetry("chat", JSON.stringify({ cid: cid, author: author, text: msg.text, ts: msg.ts }))
      .then(function (data) {
        msg.status = "sent";
        if (data && data.id) { msg.id = data.id; msg.time = data.time; self.seen.add(data.id); }
        self.saveCache();
        self.emit("chat");
        return msg;
      })
      .catch(function (err) {
        msg.status = "failed";
        self.emit("chat");
        throw err;
      });
  };

  OfficeStore.prototype.retryMessage = function (cid) {
    var msg = null;
    for (var i = 0; i < this.messages.length; i++) if (this.messages[i].cid === cid) msg = this.messages[i];
    if (!msg) return Promise.resolve();
    var self = this;
    msg.status = "sending";
    this.emit("chat");
    return this.postRetry("chat", JSON.stringify({ cid: cid, author: msg.author, text: msg.text, ts: msg.ts }))
      .then(function (data) {
        msg.status = "sent";
        if (data && data.id) { msg.id = data.id; msg.time = data.time; self.seen.add(data.id); }
        self.saveCache();
        self.emit("chat");
      })
      .catch(function () { msg.status = "failed"; self.emit("chat"); });
  };

  OfficeStore.prototype.upsertItem = function (item) {
    item.ts = now();
    this.items[item.id] = item;
    this.saveCache();
    this.emit("board");
    var self = this;
    return this.postRetry("board", JSON.stringify({ op: "upsert", item: item }))
      .catch(function (err) { self.emit("error", err); throw err; })
      .then(function (d) { self.maybeSync(); return d; });
  };

  OfficeStore.prototype.deleteItem = function (id) {
    var it = this.items[id];
    if (!it) return Promise.resolve();
    var tomb = Object.assign({}, it, { deleted: true, ts: now() });
    this.items[id] = tomb;
    this.saveCache();
    this.emit("board");
    var self = this;
    return this.postRetry("board", JSON.stringify({ op: "delete", item: { id: id, ts: tomb.ts } }))
      .catch(function (err) { self.emit("error", err); throw err; })
      .then(function (d) { self.maybeSync(); return d; });
  };

  OfficeStore.prototype.setPresence = function (who, room, status) {
    var p = { who: who, room: room, status: status, ts: now() };
    this.presence[who] = p;
    this.saveCache();
    this.emit("presence");
    var self = this;
    return this.postRetry("presence", JSON.stringify(p))
      .catch(function (err) { self.emit("error", err); throw err; })
      .then(function (d) { self.maybeSync(); return d; });
  };

  /* 상태 스냅샷: ntfy 캐시(12시간)가 비워져도 보드/자리가 살아남도록 주기적으로 재알림 */
  OfficeStore.prototype.postSync = function () {
    var self = this;
    var cutoff = now() - 30 * 24 * 60 * 60 * 1000;
    var items = Object.keys(this.items)
      .map(function (k) { return self.items[k]; })
      .filter(function (it) { return (it.ts || 0) > cutoff; });
    var presence = this.presence;
    var v = now();

    if (!items.length && !Object.keys(presence).length) {
      this.lastSyncPost = v;
      this.saveCache();
      return Promise.resolve();
    }

    var chunks = [];
    var current = [];
    var baseLen = JSON.stringify({ items: [], presence: presence, v: v }).length;
    var size = baseLen;
    items.forEach(function (it) {
      var len = JSON.stringify(it).length + 1;
      if (current.length && size + len > MESSAGE_LIMIT) { chunks.push(current); current = []; size = baseLen; }
      current.push(it); size += len;
    });
    chunks.push(current);

    var parts = chunks.length;
    var chain = Promise.resolve();
    chunks.forEach(function (list, i) {
      var payload = { items: list, presence: i === 0 ? presence : null, v: v, part: i + 1, parts: parts };
      chain = chain.then(function () { return self.postRetry("sync", JSON.stringify(payload), 2); });
    });
    return chain.then(function () { self.lastSyncPost = v; self.saveCache(); })
      .catch(function (e) { console.warn("sync 실패", e); });
  };

  OfficeStore.prototype.maybeSync = function () {
    if (now() - this.lastSyncPost > SYNC_EVERY) return this.postSync();
    return Promise.resolve();
  };

  /* ---------- 시작 ---------- */
  OfficeStore.prototype.catchUp = function () {
    var self = this;
    return fetch(BASE + "/" + encodeURIComponent(TOPIC) + "/json?poll=1&since=all", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (text) {
        var changed = false;
        text.split("\n").forEach(function (line) {
          line = line.trim();
          if (!line) return;
          var o = parse(line);
          if (o && o.event === "message" && self.ingest(o)) changed = true;
        });
        if (changed) self.emit("data");
      })
      .catch(function (e) { console.warn("catch-up 실패", e); });
  };

  OfficeStore.prototype.connect = function () {
    var self = this;
    if (typeof EventSource === "undefined") { this.setConn("polling"); return; }
    var since = this.lastTime ? String(this.lastTime) : "all";
    var url = BASE + "/" + encodeURIComponent(TOPIC) + "/sse?since=" + since;
    var es;
    try { es = new EventSource(url); } catch (e) { this.setConn("offline"); return; }
    this.sse = es;

    es.onopen = function () {
      self.reconnectDelay = 1000;
      self.setConn("live");
      self.maybeSync();
    };
    es.onmessage = function (ev) {
      var m = parse(ev.data);
      if (m && m.event === "message" && self.ingest(m)) self.emit("data");
    };
    es.onerror = function () {
      self.setConn(navigator.onLine === false ? "offline" : "reconnecting");
      try { es.close(); } catch (e) { }
      if (self.sse === es) self.sse = null;
      var d = self.reconnectDelay;
      self.reconnectDelay = Math.min(self.reconnectDelay * 2, 20000);
      setTimeout(function () { self.connect(); }, d);
    };
  };

  OfficeStore.prototype.start = function () {
    if (this.started) return Promise.resolve();
    this.started = true;
    var self = this;
    this.loadCache();
    this.emit("data");
    return this.catchUp().then(function () {
      self.emit("data");
      self.connect();
      setInterval(function () {
        if (self.connState === "live") { self.maybeSync(); self.saveCache(); }
      }, 10 * 60 * 1000);
    });
  };

  OfficeStore.prototype.reconnect = function () {
    if (this.sse) { try { this.sse.close(); } catch (e) { } this.sse = null; }
    this.setConn("connecting");
    var self = this;
    this.catchUp().then(function () { self.emit("data"); self.connect(); });
  };

  OfficeStore.prototype.getPresence = function (who) {
    return this.presence[who] || { room: "work", status: "대기 중", ts: 0 };
  };

  OfficeStore.prototype.setIdentity = function (key) {
    this.identity = key;
    try { localStorage.setItem(ID_KEY, key); } catch (e) { }
    this.emit("identity");
  };

  OfficeStore.prototype.resetLocal = function () {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { }
    location.reload();
  };

  window.OfficeStore = OfficeStore;
})();
