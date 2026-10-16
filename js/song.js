// Song model: lyrics → sections → (optional) flow → the slide sequence the operator steps through.
//
// Lyrics: a blank line starts a new slide. A first line like "[Verse 1]", "Chorus:", "Reff", "Bait 2", "[C]"
// labels the slide and starts a section; unlabeled slides that follow belong to that same section.
// Flow: "V1 C V2 C B C C" plays sections in that order, repeats included. Empty flow = written order.

export const SECTION_NAMES = { V: "Verse", C: "Chorus", P: "Pre-Chorus", B: "Bridge", T: "Tag", I: "Intro", E: "Ending", N: "Interlude" };
export const HOTKEYS = { v: "V", c: "C", p: "P", b: "B", t: "T", i: "I", e: "E" };   // key → section letter

const LABEL_LINE = /^\s*(?:\[(.+)\]|((?:verse|chorus|bridge|pre-?chorus|pre-?reff?|intro|outro|tag|ending|reff?|refrain|interlude|bait|ayat|jembatan|coda)\s*\d*)\s*:?)\s*$/i;

/** "Verse 2" | "Bait 2" | "V2" | "Reff" | "C" | "Bridge" → "V2" | "C" | "B" ... ; unknown → null */
export function toCode(label){
  const s = String(label || "").trim().toLowerCase().replace(/[\s:._-]+/g, " ").trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(?:pre ?(?:chorus|reff?|refrain)|prechorus|pc|p)\s*(\d*)$/))) return "P" + (m[1] && m[1] !== "1" ? m[1] : "");
  if ((m = s.match(/^(?:verse|bait|ayat|v)\s*(\d*)$/))) return "V" + (m[1] || "1");
  if ((m = s.match(/^(?:chorus|reff?|refrain|c)\s*(\d*)$/))) return "C" + (m[1] && m[1] !== "1" ? m[1] : "");
  if ((m = s.match(/^(?:bridge|jembatan|b)\s*(\d*)$/))) return "B" + (m[1] && m[1] !== "1" ? m[1] : "");
  if ((m = s.match(/^(?:tag|t)\s*(\d*)$/))) return "T" + (m[1] && m[1] !== "1" ? m[1] : "");
  if (/^(?:intro|i)$/.test(s)) return "I";
  if (/^(?:outro|ending|coda|e)$/.test(s)) return "E";
  if ((m = s.match(/^(?:interlude|n)\s*(\d*)$/))) return "N" + (m[1] && m[1] !== "1" ? m[1] : "");
  return null;
}
export function codeName(code){
  if (!code) return "";
  const n = code.slice(1);
  return (SECTION_NAMES[code[0]] || code) + (n ? " " + n : "");
}

/** → [{ code, name, slides: [text, ...] }] in written order */
export function parseSections(lyrics){
  const sections = [];
  let cur = null, anon = 0;
  for (const block of String(lyrics).replace(/\r/g, "").split(/\n\s*\n/)){
    let lines = block.split("\n").filter(l => l.trim());
    if (!lines.length) continue;
    let label = null;
    const m = lines[0].match(LABEL_LINE);
    if (m){ label = (m[1] || m[2]).trim(); lines = lines.slice(1); }
    if (label !== null){
      const code = toCode(label);
      cur = { code: code || "X" + (++anon), name: code ? codeName(code) : label, slides: [] };
      sections.push(cur);
    } else if (!cur){
      cur = { code: "X" + (++anon), name: "", slides: [] };
      sections.push(cur);
    }
    if (lines.length) cur.slides.push(lines.join("\n"));
  }
  return sections.filter(s => s.slides.length);
}

/** "V1 C V2, C B C C" → { codes: ["V1","C",...], unknown: ["Q"] } */
export function parseFlow(flow){
  const codes = [], unknown = [];
  for (const tok of String(flow || "").split(/[\s,;>→|]+/).filter(Boolean)){
    const c = toCode(tok);
    c ? codes.push(c) : unknown.push(tok);
  }
  return { codes, unknown };
}

/** The slide sequence for the operator. Each slide: { kind:"song", text, label, code, occ, sectionStart } */
export function songSlides(song){
  const sections = parseSections(song.lyrics || "");
  const byCode = new Map(sections.map(s => [s.code, s]));
  const { codes } = parseFlow(song.flow);
  const order = codes.length ? codes.map(c => byCode.get(c)).filter(Boolean) : sections;
  const seen = {}, out = [];
  for (const sec of order){
    const occ = seen[sec.code] = (seen[sec.code] || 0) + 1;
    sec.slides.forEach((text, i) => out.push({
      kind: "song", text, code: sec.code, occ, sectionStart: i === 0,
      label: !sec.name ? "" : sec.name + (sec.slides.length > 1 ? ` (${i + 1}/${sec.slides.length})` : "") + (occ > 1 ? ` ×${occ}` : ""),
    }));
  }
  return out;
}

/** Flow problems worth showing in the editor. */
export function flowReport(song){
  const sections = parseSections(song.lyrics || "");
  const have = new Set(sections.map(s => s.code));
  const { codes, unknown } = parseFlow(song.flow);
  const missing = [...new Set(codes.filter(c => !have.has(c)))];
  return { sections: sections.map(s => s.code.startsWith("X") ? (s.name || "untitled") : s.code), unknown, missing };
}

/**
 * Where a section hotkey should land. letter: "C", or a full code "V2".
 * Picks the next occurrence after the current slide (so "chorus again" goes forward), else the first one.
 */
export function findSection(slides, want, fromIdx){
  const match = s => s.sectionStart && (want.length > 1 ? s.code === want : s.code[0] === want);
  for (let i = fromIdx + 1; i < slides.length; i++) if (match(slides[i])) return i;
  for (let i = 0; i < slides.length; i++) if (match(slides[i])) return i;
  return -1;
}
