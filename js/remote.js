// Remote presenter view (iPad / phone). Renders the laptop's state and sends commands back.
// The laptop is the source of truth: every tap here becomes a command, and the screen updates
// when the laptop's new state arrives (usually well under a second).
import { paint, stageHTML } from "./stage.js";
import { Link, cleanCode, validCode, DEFAULT_RELAY } from "./remote-link.js";

const $ = s => document.querySelector(s);
const KEY = "narrative.remote";
let link = null, state = null, lastState = 0, pendingIdx = null;

/* ───────── pairing ───────── */
function readPairing(){
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("c")){
    const p = { code: cleanCode(h.get("c")), relay: h.get("r") || DEFAULT_RELAY };
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
    history.replaceState(null, "", location.pathname);          // keep the code out of the visible URL/history
    return p;
  }
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
function showPair(msg = ""){
  $("#app").hidden = true; $("#pair").hidden = false;
  $("#pairMsg").textContent = msg; $("#pairMsg").className = "msg" + (msg ? " err" : "");
  setTimeout(() => $("#pairCode").focus(), 50);
}
$("#pairCode").addEventListener("input", e => {
  const c = cleanCode(e.target.value).slice(0, 10);
  e.target.value = [c.slice(0, 4), c.slice(4, 8), c.slice(8)].filter(Boolean).join("-");
});
$("#pairForm").onsubmit = e => {
  e.preventDefault();
  const code = cleanCode($("#pairCode").value);
  if (!validCode(code)) return showPair("That code doesn't look right. It's 10 letters and numbers.");
  const p = { code, relay: DEFAULT_RELAY };
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
  connect(p);
};
$("#btnUnpair").onclick = () => {
  if (!confirm("Disconnect this device from the laptop?")) return;
  try { localStorage.removeItem(KEY); } catch {}
  if (link) link.close(); link = null; state = null;
  showPair();
};

/* ───────── connection ───────── */
const device = (() => {
  const ua = navigator.userAgent;
  if (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  return "Browser";
})();

async function connect(p){
  $("#pair").hidden = true; $("#app").hidden = false;
  if (link) link.close();
  link = new Link({ code: p.code, role: "remote", relay: p.relay || DEFAULT_RELAY, onMessage, onStatus: renderConn });
  await link.start();
  const cached = await link.fetchLatest();                       // last known state, so the screen isn't empty
  if (cached && !state) onMessage(cached, true);
  send("hello");
  keepAwake();
}
let cmdN = 0;
function send(c, extra = {}){
  if (!link) return;
  link.send({ t: "cmd", c, id: Date.now().toString(36) + "-" + (++cmdN), dev: device, ...extra });
  $("#conn").textContent = "Sending…";
}
setInterval(() => { if (link && !document.hidden) send("ping"); }, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && link){ send("hello"); keepAwake(); } });

function renderConn(){
  const el = $("#conn");
  if (!link) return;
  const age = Date.now() - lastState;
  if (link.status === "offline"){ el.className = "chip bad"; el.textContent = "This device is offline"; return; }
  if (link.status !== "online"){ el.className = "chip warn"; el.textContent = "Reconnecting…"; return; }
  if (!lastState || age > 60000){ el.className = "chip warn"; el.textContent = lastState ? "Laptop not responding" : "Waiting for laptop…"; return; }
  el.className = "chip ok"; el.textContent = "Connected to laptop";
}
setInterval(renderConn, 2000);

// Keep the iPad screen on during the service.
let wakeLock = null;
async function keepAwake(){ try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => wakeLock = null); } } catch {} }

/* ───────── rendering ───────── */
["#live", "#next"].forEach(s => $(s).innerHTML = stageHTML());
const toSlide = p => !p ? null : p.k === "p" ? { kind: "scripture", verses: p.v || [{ n: "", t: p.t || "" }], caption: p.cap || "" } : { kind: "song", text: p.t || "" };

function onMessage(m, fromCache = false){
  if (!m || m.t !== "state") return;
  if (state && m.ts && state.ts && m.ts < state.ts) return;       // ignore out-of-order old snapshots
  state = m; pendingIdx = null;
  if (!fromCache) lastState = Date.now();
  render(); renderConn();
}

function render(){
  const s = state; if (!s) return;
  const settings = { ...s.st, bgImg: "" };
  const L = s.live || {};
  paint($("#live .stage"), { slide: toSlide(L.sl), black: L.b, clear: L.c, settings });
  $("#liveLabel").textContent = L.b ? "BLACK" : L.c ? "TEXT CLEARED" : (L.l || "");
  paint($("#next .stage"), { slide: toSlide(s.next?.sl), black: false, clear: false, settings });
  $("#nextLabel").textContent = s.next ? (s.next.same ? "" : "Next item · " + s.next.n + " · ") + (s.next.l || "") : (L.key ? "End of service order" : "");
  $("#bBlack").classList.toggle("on", !!L.b);
  $("#bClear").classList.toggle("on", !!L.c);

  // service order
  const items = $("#items"); items.replaceChildren();
  if (!s.items.length) items.innerHTML = `<p class="fine" style="padding:0 10px;color:var(--mute)">The service order on the laptop is empty.</p>`;
  for (const it of s.items){
    const b = document.createElement("button");
    b.innerHTML = `<span class="n"></span><span class="k">${it.k === "p" ? "Bible" : "Song"}</span>`;
    b.querySelector(".n").textContent = it.n;
    b.classList.toggle("sel", s.view?.u === it.u);
    b.classList.toggle("live", L.key === "item:" + it.u);
    b.onclick = () => send("item", { u: it.u });
    b.ondblclick = () => send("item", { u: it.u, go: 1 });
    items.append(b);
  }

  // slides of the selected item
  const v = s.view;
  $("#viewTitle").textContent = v ? v.n : "Nothing selected";
  const sl = $("#slides"); sl.replaceChildren();
  const isLiveView = v && L.key === v.key;
  const nextIdx = s.next && s.next.same && v ? (isLiveView ? L.i + 1 : 0) : -1;
  (v?.s || []).forEach((x, i) => {
    const d = document.createElement("button"); d.className = "slide";
    const lbl = document.createElement("div"); lbl.className = "lbl";
    const a = document.createElement("span");
    if (x.st && x.c && !x.c.startsWith("X")){ const k = document.createElement("span"); k.className = "key"; k.textContent = x.c; a.append(k); }
    a.append(x.l || "");
    const n = document.createElement("span"); n.textContent = i + 1;
    lbl.append(a, n);
    const body = document.createElement("div");
    if (x.k === "p" && x.v) x.v.forEach((vv, j) => { const sup = document.createElement("sup"); sup.textContent = vv.n; body.append(j ? " " : "", sup, vv.t); });
    else body.textContent = x.t || "";
    d.append(lbl, body);
    d.classList.toggle("live", isLiveView && i === L.i);
    d.classList.toggle("next-up", i === nextIdx);
    d.classList.toggle("pending", pendingIdx === i);
    d.onclick = () => { pendingIdx = i; d.classList.add("pending"); send("live", { key: v.key, i }); };
    sl.append(d);
  });
  sl.querySelector(".slide.live")?.scrollIntoView({ block: "nearest", behavior: "smooth" });

  // section buttons (songs): one per section in play order, like the laptop's flow strip
  const secs = $("#sections"); secs.replaceChildren();
  if (v && v.s.length && v.s[0].k === "s"){
    const starts = v.s.map((x, i) => ({ ...x, i })).filter(x => x.st && x.c && !x.c.startsWith("X"));
    const codes = [...new Set(starts.map(x => x.c))];
    const curCode = isLiveView ? [...starts].reverse().find(x => x.i <= L.i)?.c : null;
    for (const c of codes){
      const b = document.createElement("button");
      b.textContent = c; b.title = "Jump to " + c;
      b.classList.toggle("now", c === curCode);
      b.onclick = () => send("sec", { w: c });
      secs.append(b);
    }
  }
}

/* ───────── controls ───────── */
$("#bNext").onclick = () => send("step", { d: 1 });
$("#bPrev").onclick = () => send("step", { d: -1 });
$("#bBlack").onclick = () => send("black");
$("#bClear").onclick = () => send("clear");
// Keyboard or a Bluetooth clicker paired to the iPad
addEventListener("keydown", e => {
  if ($("#app").hidden || e.target.tagName === "INPUT") return;
  const k = e.key;
  if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(k)){ e.preventDefault(); send("step", { d: 1 }); }
  else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(k)){ e.preventDefault(); send("step", { d: -1 }); }
  else if (k === "." || (k.toLowerCase() === "b" && e.shiftKey)) send("black");
  else if (k.toLowerCase() === "x") send("clear");
  else if (/^[cpbtie]$/i.test(k)) send("sec", { w: k.toUpperCase() });
});

/* ───────── boot ───────── */
const p = readPairing();
p && validCode(p.code) ? connect(p) : showPair();
if ("serviceWorker" in navigator){
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  // The remote holds no state of its own (it re-syncs in ~0.1 s), so it can always reload on update.
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) location.reload(); });
}
