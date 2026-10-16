// Draws one live "frame" into a .stage element. Used by the operator preview and the projector window,
// so what you see in the preview is what the room sees.
//
// frame = { slide: {kind:"song", text} | {kind:"scripture", verses:[{n,t}], caption} | null,
//           black: bool, clear: bool, settings: {fg,bg,font,max,pad,bgImg} }

export const DEFAULT_SETTINGS = {
  fg: "#ffffff", bg: "#000000", font: '"IBM Plex Sans", Arial, sans-serif',
  max: 120, pad: 6, bgImg: "", align: "center",
};

export function stageHTML(){
  return `<div class="stage"><div class="txt"></div><div class="cap"></div></div>`;
}

export function paint(stage, frame){
  if (!stage) return;
  const st = { ...DEFAULT_SETTINGS, ...(frame && frame.settings) };
  const txt = stage.querySelector(".txt"), cap = stage.querySelector(".cap");
  const slide = frame && !frame.black && !frame.clear ? frame.slide : null;

  stage.style.background = (frame && frame.black) ? "#000"
    : st.bgImg ? `#000 url("${st.bgImg}") center/cover no-repeat` : st.bg;
  txt.style.color = cap.style.color = st.fg;
  txt.style.fontFamily = cap.style.fontFamily = st.font;
  txt.replaceChildren(); cap.textContent = "";

  if (!slide) return;
  if (slide.kind === "scripture"){
    txt.className = "txt prose";
    slide.verses.forEach((v, i) => {
      if (i) txt.append(" ");
      const n = document.createElement("sup"); n.textContent = v.n;
      txt.append(n, v.t);
    });
    cap.textContent = slide.caption || "";
  } else {
    txt.className = "txt lines";
    txt.textContent = slide.text;
  }
  fit(stage, txt, cap, st);
}

function fit(stage, txt, cap, st){
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!W || !H) return;
  const pad = Math.round(Math.min(W, H) * st.pad / 100);
  const scale = W / 1920;                         // "max font size" is defined for a 1920px-wide screen
  let capH = 0;
  if (cap.textContent){
    cap.style.fontSize = Math.max(10, Math.round(H * 0.045)) + "px";
    cap.style.bottom = Math.round(pad * 0.6) + "px";
    capH = cap.offsetHeight + pad * 0.6;
  }
  const maxW = W - pad * 2, maxH = H - pad * 2 - capH;
  const prose = txt.classList.contains("prose");
  txt.style.maxWidth = prose ? maxW + "px" : "none";
  txt.style.marginBottom = capH + "px";
  let lo = 8, hi = Math.max(12, Math.round(st.max * scale));
  while (lo < hi){
    const mid = Math.ceil((lo + hi) / 2);
    txt.style.fontSize = mid + "px";
    const ok = txt.scrollHeight <= maxH && (prose || txt.scrollWidth <= maxW);
    ok ? lo = mid : hi = mid - 1;
  }
  txt.style.fontSize = lo + "px";
}
