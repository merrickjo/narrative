// Scripture sources: the ESV API (key stays on this device) and Bibles the user imports.
// Nothing copyrighted ships in this repo.
import { BOOKS, formatRef } from "./bible.js";

export const ESV_ID = "esv";
export const ESV_MAX_VERSES = 500;   // Crossway terms: ≤500 verses per query / stored / shown

/** Fetch from api.esv.org → { verses:[{c,v,t}], caption } */
export async function fetchESV(ref, key){
  if (!key) throw new Error("Add your ESV API key first (Scripture → ESV key).");
  const q = formatRef(ref, "en");
  const p = new URLSearchParams({
    q, "include-passage-references":"false", "include-verse-numbers":"true",
    "include-first-verse-numbers":"true", "include-footnotes":"false", "include-footnote-body":"false",
    "include-headings":"false", "include-short-copyright":"false", "include-copyright":"false",
    "include-selahs":"true", "indent-paragraphs":"0", "indent-poetry":"false",
    "indent-declares":"0", "indent-psalm-doxology":"0", "line-length":"0",
  });
  let res;
  try { res = await fetch("https://api.esv.org/v3/passage/text/?" + p, { headers: { Authorization: "Token " + key.trim() } }); }
  catch { throw new Error(navigator.onLine === false
    ? "You're offline. New ESV lookups need internet; passages already in the service order still work."
    : "Couldn't reach api.esv.org. Check the internet connection."); }
  if (res.status === 401 || res.status === 403) throw new Error("The ESV API rejected the key.");
  if (res.status === 429) throw new Error("ESV API rate limit hit — wait a minute and try again.");
  if (!res.ok) throw new Error("ESV API error " + res.status + ".");
  const data = await res.json();
  const text = (data.passages || []).join(" ");
  if (!text.trim()) throw new Error(`ESV has no text for "${q}".`);
  // Chapter boundaries come from data.parsed (BBCCCVVV ids); verse numbers from "[n]" markers.
  const startC = data.parsed && data.parsed[0] ? Math.floor(data.parsed[0][0] / 1000) % 1000 : ref.c1;
  const verses = []; let c = startC, last = 0;
  const parts = text.split(/\[(\d+(?::\d+)?)\]/);
  for (let i = 1; i < parts.length; i += 2){
    let v, t = clean(parts[i+1] || "");
    if (parts[i].includes(":")) { const [cc, vv] = parts[i].split(":"); c = +cc; v = +vv; }   // "[4:1]" style
    else { v = +parts[i]; if (v < last) c++; }   // verse numbers restarted → next chapter
    last = v;
    if (t) verses.push({ c, v, t });
  }
  if (verses.length > ESV_MAX_VERSES) throw new Error(`That's ${verses.length} verses; the ESV terms allow ${ESV_MAX_VERSES} at a time.`);
  return { verses, caption: (data.canonical || q).replace(/–/g, "-") + " (ESV)", lang: "en", label: "ESV" };
}

/** Look up a passage in an imported Bible → { verses, caption } */
export function lookupLocal(bible, ref){
  const book = bible.books[ref.book];
  if (!book || !book.length) throw new Error(`${bible.name} has no ${BOOKS[ref.book][bible.lang === "id" ? 1 : 0]}.`);
  const verses = [];
  for (let c = ref.c1; c <= ref.c2; c++){
    const ch = book[c-1];
    if (!ch) { if (c === ref.c1) throw new Error(`${formatRef({ ...ref, v1:null, c2:ref.c1, v2:null }, bible.lang)} doesn't exist.`); break; }
    const from = (c === ref.c1 && ref.v1 != null) ? ref.v1 : 1;
    const to   = (c === ref.c2 && ref.v2 != null) ? ref.v2 : ch.length;
    for (let v = from; v <= Math.min(to, ch.length); v++) if (ch[v-1]) verses.push({ c, v, t: clean(ch[v-1]) });
  }
  if (!verses.length) throw new Error("No verses found for that reference.");
  return { verses, caption: `${formatRef(ref, bible.lang)} (${bible.short || bible.name})`, lang: bible.lang, label: bible.short || bible.name };
}

const clean = s => String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** Group verses into slides. per: 0 = auto (pack to ~260 chars, never split a verse).
 *  Each slide's caption names exactly the verses on it, e.g. "Yohanes 3:16-17 (TB)". */
export function versesToSlides(verses, per = 0, ref = null, lang = "en", version = ""){
  const groups = []; let cur = [], len = 0;
  for (const vs of verses){
    const full = per ? cur.length >= per : (cur.length && len + vs.t.length > 260);
    if (full){ groups.push(cur); cur = []; len = 0; }
    cur.push(vs); len += vs.t.length;
  }
  if (cur.length) groups.push(cur);
  const multiChapter = verses.length && verses[0].c !== verses[verses.length-1].c;
  return groups.map(g => ({
    kind: "scripture",
    label: (multiChapter ? g[0].c + ":" : "") + g[0].v + (g.length > 1 ? "–" + g[g.length-1].v : ""),
    verses: g.map(x => ({ n: (multiChapter && x.v === 1 ? x.c + ":" : "") + x.v, t: x.t })),
    caption: ref ? formatRef({ book: ref.book, c1: g[0].c, v1: g[0].v, c2: g[g.length-1].c, v2: g[g.length-1].v }, lang)
                   + (version ? ` (${version})` : "") : "",
  }));
}

/**
 * Accepts common JSON Bible shapes and returns { books: [[ [verse,...] /*chapter*\/ ] /*book*\/ ] }
 *  A) [ { chapters: [[ "v1", "v2" ], ...] }, ... ]               (66 books, canonical order)
 *  B) { books: [ { chapters: [[...]] } | [[...]] ] }
 *  C) { verses: [ { book: 1..66, chapter, verse, text } ] }       (flat list)
 */
export function normalizeBible(json){
  let books;
  const arr = Array.isArray(json) ? json : json.books;
  if (Array.isArray(arr)) books = arr.map(b => Array.isArray(b) ? b : (b.chapters || []));
  else if (Array.isArray(json.verses)){
    books = Array.from({ length: 66 }, () => []);
    for (const r of json.verses){
      const b = (r.book || r.book_id || r.b) - 1, c = (r.chapter || r.c) - 1, v = (r.verse || r.v) - 1;
      if (b < 0 || b > 65 || c < 0 || v < 0) continue;
      (books[b][c] ||= [])[v] = r.text || r.t || "";
    }
  }
  if (!books || books.length < 27) throw new Error("Unrecognized Bible JSON (expected 66 books, or 27 for a New Testament).");
  if (books.length === 27) books = Array(39).fill([]).concat(books);   // NT-only file
  const ok = books.every(b => Array.isArray(b) && b.every(ch => Array.isArray(ch)));
  if (!ok) throw new Error("Bible JSON chapters must be arrays of verse strings.");
  return { books: books.map(b => b.map(ch => ch.map(v => typeof v === "string" ? v : (v && v.text) || ""))) };
}
