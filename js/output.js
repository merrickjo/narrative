import { paint, stageHTML } from "./stage.js";

const ch = new BroadcastChannel("narrative-live");
const screenEl = document.getElementById("screen");
screenEl.innerHTML = stageHTML();
const stage = screenEl.querySelector(".stage");
let frame = null;

const draw = () => paint(stage, frame);
ch.onmessage = e => { if (e.data && e.data.t === "frame") { frame = e.data.frame; draw(); } };
ch.postMessage({ t: "hello" });

// Heartbeat so the operator can show "connected / fullscreen".
const beat = () => ch.postMessage({ t: "alive", fs: !!document.fullscreenElement });
setInterval(beat, 1500);
addEventListener("pagehide", () => ch.postMessage({ t: "bye" }));

// Fullscreen: the popup may already open fullscreen (Chrome's fullscreen-popup feature, where available).
// Otherwise one click or key here does it — browsers require a gesture in this window.
const goFS = () => {
  if (document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
};
const syncFS = () => { document.body.classList.toggle("fs", !!document.fullscreenElement); beat(); };
document.addEventListener("fullscreenchange", () => { syncFS(); setTimeout(draw, 50); });
document.getElementById("gate").addEventListener("click", goFS);
setTimeout(syncFS, 300);

const params = new URLSearchParams(location.search);
if (params.get("screen")) document.getElementById("where").textContent = `Placed on: ${params.get("screen")}`;
else document.getElementById("where").textContent = "Drag this window onto the projector first, then click.";

// Keys: F toggles fullscreen locally; slide keys are forwarded to the operator.
addEventListener("keydown", e => {
  if (e.key === "f" || e.key === "F"){
    document.fullscreenElement ? document.exitFullscreen() : goFS();
    return;
  }
  if (["ArrowRight","ArrowLeft","ArrowUp","ArrowDown","PageUp","PageDown"," ","b","B","c","C","."].includes(e.key) || /^[1-9]$/.test(e.key)){
    e.preventDefault();
    goFS();                                   // a clicker press on this window also takes it fullscreen
    ch.postMessage({ t: "key", key: e.key });
  }
});

addEventListener("resize", draw);
document.fonts && document.fonts.ready.then(draw);
