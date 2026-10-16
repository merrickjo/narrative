# Narrative

A browser-based worship presenter: song lyrics and scripture on the projector, controlled from your laptop. No install, no server, no fancy animation. It runs in any Chromium browser (Chrome, Edge, Brave, Arc) on macOS or Windows, and installs as an app (PWA) that works offline.

**Live:** https://merrickjo.github.io/narrative/

## Sunday in four steps

1. Connect the projector and set the display to **Extend**, not Mirror.
2. Open Narrative and click **Projector** in the bottom bar. The first time, Chrome asks to *manage windows on all your displays*. Allow it, and the output window opens on the projector by itself.
3. Click the output once (or press any slide key on it) to make it fullscreen. Browsers require that one gesture on the window itself.
4. Drive from the laptop: click a slide, or use **→ / Space / PgDn** for next and **← / PgUp** for previous. **B** blacks the screen, **C** clears the text, **1–9** jumps to a slide. Presentation clickers work in either window. At the end of a service-order item, *Next* rolls on to the next item.

## Songs

Type or paste the lyrics. A **blank line starts a new slide**. A first line like `[Chorus]`, `Verse 2:`, `Reff:` or `Bait 1` labels the slide and isn't projected. Each lyric line stays on one line on screen; the text shrinks to fit instead of wrapping mid-line. You can also import `.txt` files (one song per file, file name = title).

## Scripture

Type a reference in Indonesian or English: `Yoh 3:16`, `Yohanes 3:16-18`, `John 3.16`, `1 Kor 13:4-7`, `Mzm 23`, `Kej 1:1-2:3`, `II Tim 3:16`. Choose verses per slide (or *Auto fit*), then **Show passage**. **＋ Service order** saves it for the service.

- **ESV** is fetched live from [api.esv.org](https://api.esv.org) with *your* API key. The key is stored only in your browser and is never part of this repo. Crossway's terms apply: non-commercial use, at most 500 verses at a time, and the "(ESV)" attribution shown on every slide.
- **Other versions (e.g. TB):** this repo ships **no Bible text**, because most translations, including TB (© Lembaga Alkitab Indonesia), are copyrighted. Import a Bible you're licensed to use via *Scripture → Import a Bible (JSON)*. It stays in your browser. Accepted shapes:
  - `[ { "chapters": [["v1","v2",…], …] }, … ]`: 66 books in canonical order (or 27 for an NT-only file)
  - `{ "books": [ [["v1",…],…], … ] }`
  - `{ "verses": [ { "book": 43, "chapter": 3, "verse": 16, "text": "…" }, … ] }`

## Your data

Songs, service order, settings and imported Bibles live in the browser's **IndexedDB** on that machine. Use **Export** for a backup JSON and **Import** to restore it or move to another computer. Backups from the earlier single-file version import too.

## Run locally

It's static files, but service workers and ES modules need `http://`, not `file://`:

```sh
python3 -m http.server 8000     # or: npx serve
# open http://localhost:8000
```

## Deploy

GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / root**. When you change files, bump `VERSION` in `sw.js` so installed copies update.

## How it works

`index.html` is the operator console. `output.html` is the projector window. They talk over a `BroadcastChannel`, so either window can reload without breaking the link. Both draw with the same `js/stage.js`, so the preview matches the projector exactly. The projector is placed with the [Window Management API](https://developer.chrome.com/docs/capabilities/web-apis/window-management) (`getScreenDetails()`), with a plain popup as the fallback.

## License

Code: MIT. Bundled fonts IBM Plex Sans and Literata: SIL Open Font License (see `fonts/`). ESV® text is © Crossway and is not distributed with this project.
