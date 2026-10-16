import { db, persist } from "./db.js";
import { paint, stageHTML, DEFAULT_SETTINGS } from "./stage.js";
import { parseRef, formatRef } from "./bible.js";
import { ESV_ID, ESV_MAX_VERSES, fetchESV, lookupLocal, versesToSlides, normalizeBible } from "./scripture.js";
import { songSlides, flowReport, parseFlow, findSection, codeName, HOTKEYS } from "./song.js";

const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const ch = new BroadcastChannel("narrative-live");

/* ───────────── state ───────────── */
let songs = [];                 // [{id,title,author,lyrics}]
let schedule = [];              // [{uid,type:"song",songId} | {uid,type:"scripture",title,version,slides}]
let settings = { ...DEFAULT_SETTINGS };
let esvKey = "";
let bibles = [];                // metadata: [{id,name,short,lang}]
const bibleCache = new Map();   // id → full bible
let view = null;                // {kind:"song",id} | {kind:"item",uid} | {kind:"scripture",title,caption,version,slides,verseCount}
let live = { key: null, idx: -1, slides: [], black: false, clear: false };
let outWin = null, outSeen = 0, outFS = false, outScreen = "";

const saveSchedule = () => db.put("kv", schedule, "schedule");
const saveSettings = () => db.put("kv", settings, "settings");
const song = id => songs.find(s => s.id === id);
const item = u => schedule.find(i => i.uid === u);

/* ───────────── lyrics → slides (sections + flow live in song.js) ───────────── */
const lyricSlides = s => songSlides(s);

/* ───────────── what the centre panel shows ───────────── */
const viewKey = v => !v ? null : v.kind === "song" ? "song:" + v.id : v.kind === "item" ? "item:" + v.uid : "scr:" + v.caption + "|" + v.slides.length;
function slidesOf(v){
  if (!v) return [];
  if (v.kind === "song") { const s = song(v.id); return s ? lyricSlides(s) : []; }
  if (v.kind === "item") {
    const it = item(v.uid); if (!it) return [];
    if (it.type === "song") { const s = song(it.songId); return s ? lyricSlides(s) : []; }
    return it.slides;
  }
  return v.slides;
}
function titleOf(v){
  if (!v) return "Nothing selected";
  if (v.kind === "song") return song(v.id)?.title || "";
  if (v.kind === "item") { const it = item(v.uid); return !it ? "" : it.type === "song" ? (song(it.songId)?.title || "(deleted song)") : it.title; }
  return v.title;
}

/* ───────────── live output ───────────── */
function frame(){
  return { slide: live.slides[live.idx] || null, black: live.black, clear: live.clear, settings };
}
const describe = s => !s ? "" : s.kind === "scripture" ? (s.caption || "Scripture") : (s.label || "Slide");

function paintAll(){
  const f = frame();
  paint($("#preview .stage"), f);
  ch.postMessage({ t: "frame", frame: f });
  $("#btnBlack").classList.toggle("on", live.black);
  $("#btnClear").classList.toggle("on", live.clear);
  const vk = viewKey(view);
  const nx = target(1);
  document.querySelectorAll(".slide").forEach(el => {
    const i = +el.dataset.i;
    el.classList.toggle("live", vk === live.key && i === live.idx);
    el.classList.toggle("next-up", !!nx && nx.sameView && i === nx.idx);
  });
  document.querySelectorAll("#schedule .item").forEach(el => el.classList.toggle("live", live.key === "item:" + el.dataset.uid));

  // Live label: what the room sees right now
  const cur = live.slides[live.idx];
  $("#liveLabel").textContent = live.black ? "BLACK" : live.clear ? "TEXT CLEARED" : describe(cur);

  // Next up: exactly what one press of Next will show (including roll-over into the next item)
  const np = $("#nextPreview .stage");
  if (nx){
    paint(np, { slide: nx.slide, black: false, clear: false, settings });
    $("#nextLabel").textContent = (nx.sameView ? "" : "Next item · " + nx.title + " · ") + describe(nx.slide);
  } else {
    paint(np, { slide: null, black: false, clear: false, settings });
    $("#nextLabel").textContent = live.key ? "End of service order" : "";
  }
  renderFlowStrip();
}

/**
 * Where Next/Prev would land, without moving: { view, idx, slide, sameView, title } or null.
 * Follows the slides shown in the centre panel; at the end of a service-order item it rolls into the neighbour.
 */
function target(dir){
  if (!view) return null;
  const slides = slidesOf(view);
  const here = live.key === viewKey(view) ? live.idx : -1;
  let idx = here === -1 ? 0 : here + dir;
  if (idx >= 0 && idx < slides.length) return { view, idx, slide: slides[idx], sameView: true, title: titleOf(view) };
  if (view.kind === "item" && here !== -1){
    const i = schedule.findIndex(x => x.uid === view.uid) + dir;
    if (i >= 0 && i < schedule.length){
      const v = { kind: "item", uid: schedule[i].uid }, s = slidesOf(v);
      if (s.length){ const j = dir > 0 ? 0 : s.length - 1; return { view: v, idx: j, slide: s[j], sameView: false, title: titleOf(v) }; }
    }
  }
  return null;
}
function goLive(idx){
  const slides = slidesOf(view);
  if (!slides.length) return;
  live = { ...live, key: viewKey(view), idx: Math.max(0, Math.min(slides.length - 1, idx)), slides, black: false, clear: false };
  paintAll();
  document.querySelector(`.slide[data-i="${live.idx}"]`)?.scrollIntoView({ block: "nearest" });
}
function step(dir){
  const t = target(dir);
  if (!t) return hud(dir > 0 ? "End of service order" : "Start", true);
  if (!t.sameView) select(t.view);
  goLive(t.idx);
}

/* ───────────── section hotkeys + HUD ───────────── */
let hudTimer;
function hud(html, miss = false, ms = 1400){
  const h = $("#hud");
  h.innerHTML = html; h.classList.toggle("miss", miss); h.classList.add("show");
  clearTimeout(hudTimer); if (ms) hudTimer = setTimeout(() => h.classList.remove("show"), ms);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" })[c]);

function jumpSection(want, keyLabel){
  const slides = slidesOf(view);
  if (!slides.length || slides[0].kind !== "song") return hud(`<span class="k">${esc(keyLabel)}</span>Sections work on songs`, true);
  const here = live.key === viewKey(view) ? live.idx : -1;
  const i = findSection(slides, want, here);
  if (i < 0) return hud(`<span class="k">${esc(keyLabel)}</span>No ${esc(codeName(want))} in this song`, true, 1800);
  goLive(i);
  hud(`<span class="k">${esc(keyLabel)}</span>${esc(slides[i].label || codeName(slides[i].code))}`);
}

function renderFlowStrip(){
  const strip = $("#flowStrip");
  const slides = slidesOf(view);
  if (!slides.length || slides[0].kind !== "song" || !slides.some(s => s.label)){ strip.hidden = true; return; }
  // One chip per section occurrence, in play order
  const here = live.key === viewKey(view) ? live.idx : -1;
  const nx = target(1);
  const chips = [];
  slides.forEach((s, i) => { if (s.sectionStart) chips.push({ i, code: s.code, name: s.label.replace(/ \(\d+\/\d+\)/, ""), occ: s.occ }); });
  strip.replaceChildren(...chips.map((c, k) => {
    const end = k + 1 < chips.length ? chips[k + 1].i : slides.length;
    const b = document.createElement("button");
    b.type = "button"; b.className = "tok"; b.title = c.name; b.tabIndex = -1;
    b.textContent = c.code.startsWith("X") ? (c.name || "·") : c.code;
    if (here >= c.i && here < end) b.classList.add("now");
    else if (here >= end) b.classList.add("past");
    if (nx && nx.sameView && nx.idx === c.i && !(here >= c.i && here < end)) b.classList.add("next");
    b.onclick = () => goLive(c.i);
    return b;
  }));
  strip.hidden = false;
}

ch.onmessage = e => {
  const m = e.data || {};
  if (m.t === "hello") { outSeen = Date.now(); paintAll(); }
  else if (m.t === "alive") { outSeen = Date.now(); outFS = m.fs; }
  else if (m.t === "bye") { outSeen = 0; }
  else if (m.t === "key") handleKey({ key: m.key, shiftKey: !!m.shift, target: document.body, preventDefault(){} });
  updateStatus();
};
function updateStatus(){
  const on = Date.now() - outSeen < 4000;
  const st = $("#status");
  st.textContent = !on ? "Projector off" : outFS ? `Live${outScreen ? " on " + outScreen : ""} · fullscreen` : `Projector open${outScreen ? " on " + outScreen : ""} · not fullscreen`;
  st.classList.toggle("ok", on && outFS);
  $("#btnProjector").textContent = on ? "Projector ✓" : "Projector";
}
setInterval(updateStatus, 1500);

/* ───────────── projector placement (Window Management API) ───────────── */
async function openProjector(){
  let target = null;
  if ("getScreenDetails" in window){
    try {
      const sd = await window.getScreenDetails();           // first time: Chrome asks "manage windows on all displays"
      const others = sd.screens.filter(s => s !== sd.currentScreen);
      target = others.find(s => !s.isPrimary) || others[0] || null;
    } catch { toast("Screen access was declined, so the output opens as a normal window. Drag it to the projector."); }
  }
  outScreen = target ? (target.label || "second screen") : "";
  const feat = target
    ? `popup,fullscreen,left=${target.availLeft},top=${target.availTop},width=${target.availWidth},height=${target.availHeight}`
    : "popup,width=960,height=540";
  const url = "output.html" + (target ? "?screen=" + encodeURIComponent(outScreen) : "");

  let w = outWin && !outWin.closed ? outWin : window.open("", "narrative-output", feat);
  if (!w){
    // Granting the permission prompt can use up the click; a second click then works.
    toast(target ? "Screen found. Click Projector once more to open it there." : "The popup was blocked. Allow popups for this site, then click Projector again.");
    return;
  }
  let blank = true;
  try { blank = w.location.href === "about:blank"; } catch {}
  if (blank) w.location.replace(url);
  else if (target){ try { w.moveTo(target.availLeft, target.availTop); w.resizeTo(target.availWidth, target.availHeight); } catch {} }
  outWin = w;
  try { w.focus(); } catch {}
  if (!target && !("getScreenDetails" in window)) toast("This browser can't place windows itself. Drag the output to the projector, then click it.");
  else if (!target) toast("Only one screen detected. Connect the projector in Extend mode, then click Projector again.");
}

/* ───────────── rendering lists ───────────── */
function renderLibrary(){
  const q = $("#search").value.trim().toLowerCase();
  const list = songs.filter(s => !q || s.title.toLowerCase().includes(q) || s.lyrics.toLowerCase().includes(q))
                    .sort((a, b) => a.title.localeCompare(b.title));
  const el = $("#library"); el.replaceChildren();
  if (!list.length){ el.innerHTML = `<div class="empty">${q ? "No matches." : "No songs yet. Press ＋ to add one."}</div>`; return; }
  for (const s of list){
    const d = row(s.title, "＋", "Add to service order", () => addSongToSchedule(s.id));
    d.classList.toggle("sel", view?.kind === "song" && view.id === s.id);
    d.onclick = () => select({ kind: "song", id: s.id });
    d.ondblclick = () => addSongToSchedule(s.id);
    el.append(d);
  }
}
function row(text, xLabel, xTitle, onX, tag){
  const d = document.createElement("div"); d.className = "item";
  const t = document.createElement("span"); t.className = "t"; t.textContent = text; d.append(t);
  if (tag){ const g = document.createElement("span"); g.className = "tag"; g.textContent = tag; d.append(g); }
  const x = document.createElement("button"); x.className = "x"; x.textContent = xLabel; x.title = xTitle;
  x.onclick = e => { e.stopPropagation(); onX(); };
  d.append(x);
  return d;
}
function renderSchedule(){
  const el = $("#schedule"); el.replaceChildren();
  if (!schedule.length){ el.innerHTML = `<div class="empty">Double-click a song or use “＋ Service order” on a passage.</div>`; return; }
  schedule.forEach((it, i) => {
    const name = it.type === "song" ? (song(it.songId)?.title || "(deleted song)") : it.title;
    const d = row(`${i + 1}. ${name}`, "✕", "Remove", () => { schedule.splice(i, 1); saveSchedule(); renderSchedule(); },
                  it.type === "scripture" ? it.version.toUpperCase() : "");
    d.dataset.uid = it.uid; d.draggable = true;
    d.classList.toggle("sel", view?.kind === "item" && view.uid === it.uid);
    d.onclick = () => select({ kind: "item", uid: it.uid });
    d.ondragstart = e => e.dataTransfer.setData("text/plain", String(i));
    d.ondragover = e => e.preventDefault();
    d.ondrop = e => { e.preventDefault(); const from = +e.dataTransfer.getData("text/plain");
      const [m] = schedule.splice(from, 1); schedule.splice(i, 0, m); saveSchedule(); renderSchedule(); };
    el.append(d);
  });
  paintAll();
  updateOfflineChip();
}
function renderSlides(){
  const el = $("#slides"); el.replaceChildren();
  $("#viewTitle").textContent = titleOf(view);
  const editable = view && (view.kind === "song" || (view.kind === "item" && item(view.uid)?.type === "song"));
  $("#btnEdit").hidden = !editable;
  $("#btnAddView").hidden = !view || view.kind === "item";
  slidesOf(view).forEach((sl, i) => {
    const d = document.createElement("div"); d.className = "slide"; d.dataset.i = i;
    const lbl = document.createElement("div"); lbl.className = "lbl";
    const a = document.createElement("span");
    if (sl.kind === "song" && sl.sectionStart && sl.code && !sl.code.startsWith("X")){
      const k = document.createElement("span"); k.className = "key"; k.textContent = sl.code; k.title = `Hotkey: ${sl.code.split("").join(" then ")}`;
      a.append(k); d.classList.add("section-start");
    }
    a.append(sl.label || "");
    const b = document.createElement("span"); b.textContent = i + 1;
    lbl.append(a, b);
    const body = document.createElement("div"); body.className = "b";
    if (sl.kind === "scripture") sl.verses.forEach((v, j) => { const n = document.createElement("sup"); n.textContent = v.n; body.append(j ? " " : "", n, v.t); });
    else body.textContent = sl.text;
    d.append(lbl, body);
    d.onclick = () => goLive(i);
    el.append(d);
  });
  paintAll();
}
function select(v){ view = v; renderLibrary(); renderSchedule(); renderSlides(); }
function addSongToSchedule(id){ schedule.push({ uid: uid(), type: "song", songId: id }); saveSchedule(); renderSchedule(); toast("Added to service order."); }

/* ───────────── scripture ───────────── */
function renderVersions(){
  const sel = $("#refVersion"), prev = sel.value;
  sel.replaceChildren(new Option("ESV (online)", ESV_ID), ...bibles.map(b => new Option(b.name, b.id)));
  sel.value = [...sel.options].some(o => o.value === prev) ? prev : (localStorageGet("narrative.version") || ESV_ID);
  if (!sel.value) sel.value = ESV_ID;
  const list = $("#bibleList"); list.replaceChildren();
  if (!bibles.length) list.innerHTML = `<div class="note">No imported versions yet.</div>`;
  for (const b of bibles){
    list.append(row(`${b.name}`, "✕", "Remove this version", async () => {
      if (!confirm(`Remove ${b.name} from this browser?`)) return;
      await db.del("bibles", b.id); bibleCache.delete(b.id); bibles = bibles.filter(x => x.id !== b.id); renderVersions();
    }, b.lang === "id" ? "ID" : "EN"));
  }
}
const localStorageGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const localStorageSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

async function showPassage(e){
  e.preventDefault();
  const msg = $("#refMsg"); msg.className = "msg"; msg.textContent = "";
  const q = $("#refInput").value.trim(); if (!q) return;
  const version = $("#refVersion").value, per = +$("#refPer").value;
  localStorageSet("narrative.version", version);
  try {
    const ref = parseRef(q);
    let res;
    if (version === ESV_ID){ msg.textContent = "Fetching from ESV…"; res = await fetchESV(ref, esvKey); }
    else {
      let b = bibleCache.get(version);
      if (!b){ b = await db.get("bibles", version); bibleCache.set(version, b); }
      res = lookupLocal(b, ref);
    }
    const slides = versesToSlides(res.verses, per, ref, res.lang, res.label);
    select({ kind: "scripture", title: res.caption, caption: res.caption, version, slides, verseCount: res.verses.length,
             lang: version === ESV_ID ? "en" : bibles.find(b => b.id === version)?.lang, ref });
    msg.textContent = `${res.verses.length} verse${res.verses.length === 1 ? "" : "s"} · ${slides.length} slide${slides.length === 1 ? "" : "s"}. Click a slide to go live.`;
  } catch (err){ msg.className = "msg err"; msg.textContent = err.message; }
}

function addViewToSchedule(){
  if (!view) return;
  if (view.kind === "song") return addSongToSchedule(view.id);
  if (view.kind !== "scripture") return;
  if (view.version === ESV_ID){
    const held = schedule.filter(i => i.type === "scripture" && i.version === ESV_ID)
                         .reduce((n, i) => n + i.slides.reduce((m, s) => m + s.verses.length, 0), 0);
    if (held + view.verseCount > ESV_MAX_VERSES)
      return toast(`The service order would hold ${held + view.verseCount} ESV verses; Crossway's terms allow ${ESV_MAX_VERSES} stored.`);
  }
  schedule.push({ uid: uid(), type: "scripture", title: view.caption, version: view.version, slides: view.slides });
  saveSchedule(); renderSchedule(); toast("Added to service order.");
}

async function importBible(file){
  const msg = $("#refMsg"); msg.className = "msg"; msg.textContent = `Reading ${file.name}…`;
  try {
    const parsed = normalizeBible(JSON.parse(await file.text()));
    const guess = file.name.replace(/\.json$/i, "");
    const name = (prompt("Name for this version (shown on slides):", guess) || guess).trim();
    const lang = confirm(`Use Indonesian book names for ${name} (e.g. “Yohanes 3:16”)?\n\nOK = Indonesian · Cancel = English`) ? "id" : "en";
    const b = { id: "b-" + uid(), name, short: name, lang, books: parsed.books };
    await db.put("bibles", b);
    bibleCache.set(b.id, b); bibles.push({ id: b.id, name, short: name, lang });
    renderVersions(); $("#refVersion").value = b.id;
    msg.textContent = `Imported ${name}.`;
  } catch (err){ msg.className = "msg err"; msg.textContent = "Couldn't import: " + err.message; }
}

/* ───────────── song editor ───────────── */
let editingId = null;
function openEditor(id){
  editingId = id; const s = id ? song(id) : null;
  $("#edTitle").value = s?.title || ""; $("#edAuthor").value = s?.author || ""; $("#edLyrics").value = s?.lyrics || "";
  $("#edFlow").value = s?.flow || "";
  $("#edDelete").hidden = !s; updateFlowReport(); $("#editor").showModal(); $("#edTitle").focus();
}
function updateFlowReport(){
  const r = flowReport({ lyrics: $("#edLyrics").value, flow: $("#edFlow").value });
  const el = $("#edFlowReport");
  const probs = [];
  if (r.unknown.length) probs.push(`not a section: ${r.unknown.join(", ")}`);
  if (r.missing.length) probs.push(`not in the lyrics: ${r.missing.join(", ")}`);
  el.className = "note" + (probs.length ? " err" : "");
  el.textContent = (r.sections.length ? `Sections: ${r.sections.join(" · ")}` : "No sections yet.") + (probs.length ? `. Flow ${probs.join("; ")}` : "");
}
$("#edLyrics").addEventListener("input", updateFlowReport);
$("#edFlow").addEventListener("input", updateFlowReport);
$("#editor").addEventListener("close", async () => {
  if ($("#editor").returnValue !== "save") return;
  const data = { title: $("#edTitle").value.trim(), author: $("#edAuthor").value.trim(), lyrics: $("#edLyrics").value,
                 flow: parseFlow($("#edFlow").value).codes.join(" ") };
  if (!data.title) return;
  let s = editingId && song(editingId);
  if (s) Object.assign(s, data); else { s = { id: uid(), ...data }; songs.push(s); }
  await db.put("songs", s);
  if (live.key && live.key === viewKey(view)){                                 // keep live text in sync after an edit
    live.slides = slidesOf(view); live.idx = Math.min(live.idx, live.slides.length - 1);
  }
  select(view && view.kind === "item" ? view : { kind: "song", id: s.id });
});
$("#edDelete").onclick = async () => {
  if (!confirm("Delete this song?")) return;
  await db.del("songs", editingId);
  songs = songs.filter(s => s.id !== editingId);
  schedule = schedule.filter(i => !(i.type === "song" && i.songId === editingId)); saveSchedule();
  $("#editor").close("cancel"); select(null);
};
function editCurrent(){
  if (view?.kind === "song") openEditor(view.id);
  else if (view?.kind === "item") { const it = item(view.uid); if (it?.type === "song") openEditor(it.songId); }
}

/* ───────────── import / export ───────────── */
$("#btnExport").onclick = () => downloadBackup();
function downloadBackup(){
  const data = { app: "narrative", version: 2, exported: new Date().toISOString(), songs, schedule, settings };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "narrative-backup-" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("#btnImport").onclick = () => $("#fileImport").click();
$("#fileImport").onchange = async e => {
  let added = 0;
  for (const f of e.target.files){
    const text = await f.text();
    if (/\.json$/i.test(f.name)){
      try {
        const data = JSON.parse(text);
        if (!Array.isArray(data.songs)) throw 0;
        const idMap = {};
        for (const s of data.songs){
          if (!s || !s.title || typeof s.lyrics !== "string") continue;
          const dup = songs.find(x => x.title === s.title && x.lyrics === s.lyrics);
          if (dup){ idMap[s.id] = dup.id; continue; }
          const n = { id: uid(), title: s.title, author: s.author || "", lyrics: s.lyrics, flow: typeof s.flow === "string" ? s.flow : "" };
          idMap[s.id] = n.id; songs.push(n); await db.put("songs", n); added++;
        }
        if (Array.isArray(data.schedule) && data.schedule.length && confirm("This backup includes a service order. Replace the current one?")){
          schedule = data.schedule.map(i => i.type === "song" ? { ...i, uid: uid(), songId: idMap[i.songId] || i.songId } : { ...i, uid: uid() })
                                  .filter(i => i.type !== "song" || song(i.songId));
          saveSchedule();
        }
      } catch { toast(f.name + " isn't a Narrative backup."); }
    } else {
      const n = { id: uid(), title: f.name.replace(/\.txt$/i, ""), author: "", lyrics: text };
      songs.push(n); await db.put("songs", n); added++;
    }
  }
  e.target.value = ""; select(view);
  toast(`Imported ${added} song${added === 1 ? "" : "s"}.`);
};

/* ───────────── display settings ───────────── */
function bindSettings(){
  const map = { setFg: "fg", setBg: "bg", setFont: "font", setMax: "max", setPad: "pad" };
  for (const [elId, k] of Object.entries(map)){
    const el = $("#" + elId); el.value = settings[k];
    el.oninput = () => { settings[k] = el.type === "number" ? +el.value : el.value; saveSettings(); paintAll(); };
  }
  $("#setBgImg").onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"), k = Math.min(1, 1920 / img.width);
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      settings.bgImg = c.toDataURL("image/jpeg", 0.85); saveSettings(); paintAll(); URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  };
  $("#btnBgImgClear").onclick = () => { settings.bgImg = ""; $("#setBgImg").value = ""; saveSettings(); paintAll(); };
}

/* ───────────── save session (offline readiness) ───────────── */
// Everything in the service order already lives in IndexedDB, and passages store their text when added.
// This makes that explicit: re-cache the app, ask for persistent storage, and verify every item resolves locally.
let sessionSaved = null;   // { at, sig }
const sessionSig = () => JSON.stringify(schedule.map(i => i.type === "song"
  ? [i.uid, song(i.songId)?.lyrics || null, song(i.songId)?.flow || ""] : [i.uid, i.slides.length]));

function updateOfflineChip(){
  const chip = $("#offlineChip");
  if (!sessionSaved || !schedule.length){ chip.hidden = true; return; }
  const fresh = sessionSaved.sig === sessionSig();
  chip.hidden = false;
  chip.className = "chip " + (fresh ? "ok" : "warn");
  chip.textContent = fresh ? `Offline ready ✓ ${new Date(sessionSaved.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Changed since save. Save session again";
}

function askSW(msg, ms = 15000){
  return new Promise(async resolve => {
    const timer = setTimeout(() => resolve(null), ms);
    try {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 4000))]);
      if (!reg || !reg.active) { clearTimeout(timer); return resolve(null); }
      const mc = new MessageChannel();
      mc.port1.onmessage = e => { clearTimeout(timer); resolve(e.data); };
      reg.active.postMessage(msg, [mc.port2]);
    } catch { clearTimeout(timer); resolve(null); }
  });
}

async function saveSession(){
  const list = $("#sessionChecks"); list.replaceChildren();
  const add = (state, text, detail = "") => {
    const li = document.createElement("li"); li.className = state;
    li.innerHTML = `<span class="i">${state === "ok" ? "✓" : state === "warn" ? "!" : "✕"}</span><span></span>`;
    li.lastChild.textContent = text;
    if (detail){ const s = document.createElement("small"); s.textContent = detail; li.lastChild.append(s); }
    list.append(li); return state;
  };
  $("#session").showModal();
  const results = [];

  // 1. App files (pages, scripts, fonts, icons) in the offline cache
  const sw = "serviceWorker" in navigator ? await askSW({ t: "precache" }) : null;
  if (!sw) results.push(add("bad", "App files could not be cached for offline use.",
    location.protocol === "file:" ? "Open Narrative from its web address (not a file) so it can work offline." : "Reload the page once while online, then try again."));
  else if (sw.missing.length) results.push(add("bad", `${sw.missing.length} app file${sw.missing.length === 1 ? " is" : "s are"} missing from the offline cache.`, "Connect to the internet and press Save session again."));
  else results.push(add("ok", `App works offline (${sw.total} files cached${sw.refreshed ? ", just refreshed" : ""}).`));

  // 2. Persistent storage
  let persisted = false;
  try { persisted = (await navigator.storage?.persisted?.()) || (await persist()); } catch {}
  results.push(persisted ? add("ok", "Browser storage is marked persistent.")
    : add("warn", "The browser may clear storage if the disk gets full.", "Installing Narrative as an app (Install app button) usually fixes this. Keep a backup file too."));

  // 3. Every service-order item is stored locally
  if (!schedule.length) results.push(add("warn", "The service order is empty.", "Add songs and passages first, then save the session."));
  else {
    const broken = [], flowWarn = [];
    let songsN = 0, passN = 0, esvVerses = 0;
    for (const it of schedule){
      if (it.type === "song"){
        const s = song(it.songId);
        if (!s || !songSlides(s).length){ broken.push(s ? s.title + " (no slides)" : "a deleted song"); continue; }
        songsN++;
        const r = flowReport(s); if (r.missing.length) flowWarn.push(`${s.title}: ${r.missing.join(", ")}`);
      } else {
        if (!it.slides?.length){ broken.push(it.title); continue; }
        passN++;
        if (it.version === ESV_ID) esvVerses += it.slides.reduce((n, sl) => n + sl.verses.length, 0);
      }
    }
    results.push(broken.length ? add("bad", `${broken.length} item${broken.length === 1 ? "" : "s"} can't be shown.`, broken.join(", "))
      : add("ok", `All ${schedule.length} items are stored on this device: ${songsN} song${songsN === 1 ? "" : "s"}, ${passN} passage${passN === 1 ? "" : "s"}.`,
            passN ? "Passage text was saved when you added it; no internet needed to show it." : ""));
    if (esvVerses) results.push(add(esvVerses <= ESV_MAX_VERSES ? "ok" : "bad", `ESV verses stored: ${esvVerses} of ${ESV_MAX_VERSES} allowed.`));
    if (flowWarn.length) results.push(add("warn", "Some song flows name sections that aren't in the lyrics.", flowWarn.join(" · ")));
  }
  if (view?.kind === "scripture" && !schedule.some(i => i.type === "scripture" && i.title === view.caption))
    results.push(add("warn", `"${view.caption}" is on screen but not in the service order.`, "Add it with ＋ Service order so it's saved."));
  add(navigator.onLine ? "ok" : "warn", navigator.onLine ? "You're online, so the cache was refreshed with the latest version." : "You're offline right now. Checked what's already cached.");

  if (!results.includes("bad") && schedule.length){
    sessionSaved = { at: Date.now(), sig: sessionSig() };
    await db.put("kv", sessionSaved, "sessionSaved");
  }
  updateOfflineChip();
}

/* ───────────── keys, buttons, misc ───────────── */
// Two-key inputs ("V" then "2", or "1" "2" Enter) use a short buffer that's always visible in the HUD.
let pending = null;   // { kind: "V" | "num", buf: "", timer }
function clearPending(){ if (pending){ clearTimeout(pending.timer); $("#hud").classList.remove("show"); } pending = null; }
function commitPending(){
  const p = pending; clearPending();
  if (!p) return;
  if (p.kind === "V") return jumpSection(p.buf ? "V" + p.buf : "V", "V" + p.buf);
  const n = +p.buf, total = slidesOf(view).length;
  if (n >= 1 && n <= total){ goLive(n - 1); hud(`<span class="k">${n}</span>${esc(describe(slidesOf(view)[n - 1]) || "Slide " + n)}`); }
  else hud(`<span class="k">${esc(p.buf)}</span>No slide ${esc(p.buf)}`, true);
}
function toggleBlack(){ live.black = !live.black; paintAll(); hud(live.black ? `<span class="k">.</span>Black screen` : "Screen back", false); }
function toggleClear(){ live.clear = !live.clear; paintAll(); hud(live.clear ? `<span class="k">X</span>Text cleared` : "Text back", false); }

function handleKey(e){
  const tag = e.target?.tagName || "";
  if (/INPUT|TEXTAREA|SELECT/.test(tag) || document.querySelector("dialog[open]")) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key, lower = k.length === 1 ? k.toLowerCase() : k;

  if (/^[0-9]$/.test(k)){
    e.preventDefault();
    if (pending?.kind === "V" && !pending.buf){ pending.buf = k; return commitPending(); }
    if (pending?.kind !== "num"){ if (k === "0") return; clearPending(); pending = { kind: "num", buf: "" }; }
    pending.buf += k; clearTimeout(pending.timer);
    const total = slidesOf(view).length;
    if (+pending.buf * 10 > total) return commitPending();          // no longer number possible → jump now
    hud(`<span class="k">${esc(pending.buf)}_</span>Enter to jump`, false, 0);
    pending.timer = setTimeout(commitPending, 1100);
    return;
  }
  if (k === "Enter" && pending){ e.preventDefault(); return commitPending(); }
  if (k === "Backspace" && pending){ clearPending(); return hud("Cancelled"); }
  if (pending) clearPending();                                      // any other key cancels a half-typed jump

  if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(k)){ e.preventDefault(); step(1); }
  else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(k)){ e.preventDefault(); step(-1); }
  else if (k === "." || (lower === "b" && e.shiftKey)) toggleBlack();
  else if (lower === "x" || k === "Escape") toggleClear();
  else if (k === "?") $("#shortcuts").showModal();
  else if (lower === "v"){
    pending = { kind: "V", buf: "" };
    hud(`<span class="k">V_</span>Verse number? (or wait = next verse)`, false, 0);
    pending.timer = setTimeout(commitPending, 900);
  }
  else if (HOTKEYS[lower]) jumpSection(HOTKEYS[lower], HOTKEYS[lower]);
}
document.addEventListener("keydown", handleKey);

let toastTimer;
function toast(text){
  const t = $("#toast"); t.textContent = text; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 4200);
}

document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("active", x === b));
  $("#tab-songs").hidden = b.dataset.tab !== "songs";
  $("#tab-scripture").hidden = b.dataset.tab !== "scripture";
  if (b.dataset.tab === "scripture") $("#refInput").focus();
});
$("#btnProjector").onclick = openProjector;
$("#btnPrev").onclick = () => step(-1);
$("#btnNext").onclick = () => step(1);
$("#btnBlack").onclick = toggleBlack;
$("#btnClear").onclick = toggleClear;
$("#btnSession").onclick = saveSession;
$("#btnSessionBackup").onclick = () => downloadBackup();
$("#btnNew").onclick = () => openEditor(null);
$("#btnEdit").onclick = editCurrent;
$("#btnAddView").onclick = addViewToSchedule;
$("#btnAbout").onclick = () => $("#about").showModal();
$("#btnClearSched").onclick = () => { if (schedule.length && confirm("Clear the service order?")){ schedule = []; saveSchedule(); renderSchedule(); } };
$("#search").oninput = renderLibrary;
$("#refForm").onsubmit = showPassage;
$("#btnImportBible").onclick = () => $("#fileBible").click();
$("#fileBible").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) importBible(f); };
$("#btnEsvSave").onclick = async () => { esvKey = $("#esvKey").value.trim(); await db.put("kv", esvKey, "esvKey"); toast(esvKey ? "ESV key saved in this browser." : "ESV key removed."); };
addEventListener("resize", () => paint($("#preview .stage"), frame()));

// Install prompt (Chromium)
let installEvt = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; $("#btnInstall").hidden = false; });
$("#btnInstall").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("#btnInstall").hidden = true; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

/* ───────────── boot ───────────── */
const SAMPLE = { id: uid(), title: "Sample Song (edit me)", author: "",
  lyrics: "[Verse 1]\nThis is the first slide\nType your lyrics here\n\n[Chorus]\nA blank line makes a new slide\nLabels in brackets stay hidden\n\n[Verse 2]\nEdit or delete this song\nThen add your own" };

async function boot(){
  $("#preview").innerHTML = stageHTML();
  $("#nextPreview").innerHTML = stageHTML();
  sessionSaved = (await db.get("kv", "sessionSaved")) || null;
  songs = await db.all("songs");
  schedule = (await db.get("kv", "schedule")) || [];
  settings = { ...DEFAULT_SETTINGS, ...((await db.get("kv", "settings")) || {}) };
  esvKey = (await db.get("kv", "esvKey")) || "";
  bibles = (await db.all("bibles")).map(({ id, name, short, lang }) => ({ id, name, short, lang }));

  if (!(await db.get("kv", "initialized"))){
    // One-time migration from the single-file v1 (localStorage "ezworship.v1").
    let old = null; try { old = JSON.parse(localStorage.getItem("ezworship.v1")); } catch {}
    if (old && Array.isArray(old.songs)){
      for (const s of old.songs){ const n = { id: s.id || uid(), title: s.title, author: s.author || "", lyrics: s.lyrics || "" }; songs.push(n); await db.put("songs", n); }
      schedule = (old.schedule || []).filter(id => songs.some(s => s.id === id)).map(id => ({ uid: uid(), type: "song", songId: id }));
      if (old.settings) settings = { ...settings, ...old.settings };
      await saveSchedule(); await saveSettings();
      setTimeout(() => toast(`Moved ${old.songs.length} song${old.songs.length === 1 ? "" : "s"} over from the earlier version.`), 400);
    } else if (!songs.length){ songs.push(SAMPLE); await db.put("songs", SAMPLE); }
    await db.put("kv", true, "initialized");
  }
  persist();

  $("#esvKey").value = esvKey;
  bindSettings(); renderVersions(); select(null);
  document.fonts?.ready.then(paintAll);
}
boot();
