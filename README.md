# Narrative

A browser-based worship presenter: song lyrics and scripture on the projector, controlled from your laptop. No install, no server, no fancy animation. It runs in any Chromium browser (Chrome, Edge, Brave, Arc) on macOS or Windows, and installs as an app (PWA) that works offline.

**Live:** https://merrickjo.github.io/narrative/

## Sunday in four steps

1. Connect the projector and set the display to **Extend**, not Mirror.
2. Open Narrative and click **Projector** in the bottom bar. The first time, Chrome asks to *manage windows on all your displays*. Allow it, and the output window opens on the projector by itself.
3. Click the output once (or press any slide key on it) to make it fullscreen. Browsers require that one gesture on the window itself.
4. Drive from the laptop: click a slide, or use **→ / Space / PgDn** for next and **← / PgUp** for previous. **Next up** (under Live) shows exactly what the next press will put on screen, including when it rolls into the next service-order item. Press **?** for every shortcut.

## Songs

Type or paste the lyrics. A **blank line starts a new slide**. A first line like `[Chorus]`, `Verse 2:`, `Reff:`, `Bait 1` or `[V1]` starts a **section** and isn't projected. Unlabeled slides belong to the section above them. Each lyric line stays on one line on screen; the text shrinks to fit instead of wrapping mid-line. You can also import `.txt` files (one song per file, file name = title).

**Flow.** In the editor, set the order the band plays, e.g. `V1 C V2 C B C C`. Repeats are built in, so *Next* just follows the arrangement. Leave it empty to play as written. The editor flags flow codes that aren't in the lyrics.

**Section hotkeys** (for when the worship leader goes off-script):

| Key | Goes to |
|---|---|
| `C` | Chorus (the next one in the flow) |
| `V` then `2` | Verse 2 (`V` alone = next verse) |
| `P` `B` `T` `I` `E` | Pre-chorus, Bridge, Tag, Intro, Ending |
| `1` `2` `Enter` | Slide 12 |
| `.` or `Shift+B` | Black screen |
| `X` or `Esc` | Clear text, keep background |

Every keypress shows in the corner of the Live preview, and the flow strip above the slides lights up the current section in red and the next one in blue.

## Scripture

Type a reference in Indonesian or English: `Yoh 3:16`, `Yohanes 3:16-18`, `John 3.16`, `1 Kor 13:4-7`, `Mzm 23`, `Kej 1:1-2:3`, `II Tim 3:16`. Choose verses per slide (or *Auto fit*), then **Show passage**. **＋ Service order** saves it for the service.

- **ESV** is fetched live from [api.esv.org](https://api.esv.org) with *your* API key. The key is stored only in your browser and is never part of this repo. Crossway's terms apply: non-commercial use, at most 500 verses at a time, and the "(ESV)" attribution shown on every slide.
- **Other versions (e.g. TB):** this repo ships **no Bible text**, because most translations, including TB (© Lembaga Alkitab Indonesia), are copyrighted. Import a Bible you're licensed to use via *Scripture → Import a Bible (JSON)*. It stays in your browser. Accepted shapes:
  - `[ { "chapters": [["v1","v2",…], …] }, … ]`: 66 books in canonical order (or 27 for an NT-only file)
  - `{ "books": [ [["v1",…],…], … ] }`
  - `{ "verses": [ { "book": 43, "chapter": 3, "verse": 16, "text": "…" }, … ] }`

## Offline: Save session

Before the service, press **Save session**. It re-caches the app, asks the browser to keep your data, and checks that every song and passage in the service order is stored on the device. A green **Offline ready ✓** chip means the whole service runs with no internet: songs, passages already in the order, fonts and the projector window. Only *new* ESV lookups need internet. If you edit the order afterwards, the chip turns amber until you save again.

## Remote: run it from an iPad or phone

Click **Remote** on the laptop, turn on **Allow remote control**, and scan the QR code with the iPad's camera (or open `…/narrative/remote.html` and type the 10-character code). The iPad becomes a presenter view: Live and Next up previews, the service order, every slide, section buttons, and big **Prev / Black / Clear / Next** buttons. A Bluetooth clicker or keyboard paired to the iPad works too. Every tap changes the laptop and the projector, and changes made on the laptop show on the iPad. The iPad screen stays awake while it's open.

- **Any network.** The two devices don't need to share Wi-Fi: church Wi-Fi + mobile data is fine. Both just need internet. (The laptop itself still runs fully offline; only the remote link needs a connection.)
- **How.** Messages pass through a public relay ([ntfy.sh](https://ntfy.sh)), encrypted end-to-end with a key made from the pairing code (AES-GCM, HKDF). The relay sees only random topic names and ciphertext. The code lives in the link's `#fragment`, which browsers never send to any server.
- **Security.** Anyone with the code can control the screen. **New code** disconnects every paired device. You can point it at your own relay under *Remote → Privacy & relay*.
- **Speed.** Typically well under a second each way.

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
