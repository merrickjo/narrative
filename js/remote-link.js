// Remote link: lets a second device (e.g. an iPad on a different network) control the operator laptop.
//
// Both devices only need internet. Messages travel through a public pub/sub relay (ntfy.sh by default,
// configurable), but everything is end-to-end encrypted: the relay only ever sees random topic names and ciphertext.
//
//   pairing code (10 chars, ~50 bits)  ──HKDF──►  AES-GCM key  +  two topic names (host→remote, remote→host)
//   wire format:  base64url( iv[12] | AES-GCM( deflate( JSON ) ) )        ≤ 4096 bytes per relay message

export const DEFAULT_RELAY = "https://ntfy.sh";
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";       // no 0/O, 1/I/L
const enc = new TextEncoder(), dec = new TextDecoder();

export function newCode(){
  const r = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(r, b => ALPHABET[b % ALPHABET.length]).join("");   // tiny modulo bias, irrelevant at 50 bits
}
export const formatCode = c => c.replace(/(.{4})(.{4})(.{2})/, "$1-$2-$3");
export const cleanCode = s => String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
export const validCode = c => c.length === 10 && [...c].every(ch => ALPHABET.includes(ch));

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");

/** code → { key: CryptoKey, up: topic remote→host, down: topic host→remote } */
export async function deriveLink(code){
  const base = await crypto.subtle.importKey("raw", enc.encode("narrative-remote:" + code), "HKDF", false, ["deriveKey", "deriveBits"]);
  const salt = enc.encode("narrative/v1");
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("aes-gcm key") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("topic") }, base, 192);
  const t = "nrv-" + hex(bits);                   // unguessable topic name; reveals nothing about the code
  return { key, down: t + "-h", up: t + "-r" };
}

async function pipe(bytes, stream){
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const canCompress = typeof CompressionStream === "function";

export async function seal(key, obj){
  let body = enc.encode(JSON.stringify(obj));
  let flag = 0;
  if (canCompress){ body = await pipe(body, new CompressionStream("deflate-raw")); flag = 1; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array([flag, ...body])));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64u(out);
}
export async function open(key, text){
  const raw = unb64u(text);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12)));
  const body = pt[0] === 1 ? await pipe(pt.slice(1), new DecompressionStream("deflate-raw")) : pt.slice(1);
  return JSON.parse(dec.decode(body));
}

/**
 * A two-way encrypted channel.
 *   role "host": sends on `down`, listens on `up`.   role "remote": the reverse.
 *   send(obj, {cache}) coalesces bursts: only the newest pending "state" survives; commands always go out in order.
 */
export class Link {
  constructor({ code, role, relay = DEFAULT_RELAY, onMessage, onStatus }){
    Object.assign(this, { code, role, relay: relay.replace(/\/+$/, ""), onMessage, onStatus });
    this.queue = []; this.sending = false; this.backoffUntil = 0; this.es = null; this.closed = false;
    this.lastRx = 0; this.status = "connecting";
  }
  async start(){
    const l = await deriveLink(this.code);
    this.key = l.key;
    this.outTopic = this.role === "host" ? l.down : l.up;
    this.inTopic  = this.role === "host" ? l.up : l.down;
    this.listen();
    return this;
  }
  setStatus(s, detail = ""){ this.status = s; this.onStatus && this.onStatus(s, detail); }
  listen(){
    if (this.closed) return;
    const es = this.es = new EventSource(`${this.relay}/${this.inTopic}/sse`);
    es.addEventListener("open", () => this.setStatus("online"));
    es.onmessage = async e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.event !== "message" || !m.message) return;
      try { const obj = await open(this.key, m.message); this.lastRx = Date.now(); this.onMessage && this.onMessage(obj); }
      catch { /* not for us / tampered: ignore */ }
    };
    es.onerror = () => this.setStatus(navigator.onLine === false ? "offline" : "reconnecting");   // EventSource retries by itself
  }
  /** Latest cached message on our inbound topic (e.g. the remote catching up on state instantly). */
  async fetchLatest(){
    try {
      const r = await fetch(`${this.relay}/${this.inTopic}/json?poll=1&since=latest`);
      const line = (await r.text()).trim().split("\n").filter(Boolean).pop();
      if (!line) return null;
      const m = JSON.parse(line);
      return m.message ? await open(this.key, m.message) : null;
    } catch { return null; }
  }
  send(obj, { cache = false, replaceable = false } = {}){
    if (replaceable) this.queue = this.queue.filter(q => !q.replaceable);   // keep only the newest state
    this.queue.push({ obj, cache, replaceable });
    this.pump();
  }
  async pump(){
    if (this.sending || this.closed) return;
    this.sending = true;
    try {
      while (this.queue.length){
        const wait = this.backoffUntil - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        const q = this.queue.shift();
        const body = await seal(this.key, q.obj);
        if (body.length > 4000){ console.warn("Narrative remote: message too large, dropped", body.length); continue; }
        let res;
        try {
          res = await fetch(`${this.relay}/${this.outTopic}`, { method: "POST", body, headers: q.cache ? {} : { Cache: "no" } });
        } catch {
          this.setStatus("offline"); this.queue.unshift(q); this.backoffUntil = Date.now() + 3000; continue;
        }
        if (res.status === 429){ this.queue.unshift(q); this.backoffUntil = Date.now() + 5000; this.setStatus("throttled"); continue; }
        if (!res.ok){ this.setStatus("error", "relay " + res.status); continue; }
        if (this.status !== "online") this.setStatus("online");
      }
    } finally { this.sending = false; }
  }
  close(){ this.closed = true; this.queue = []; if (this.es) this.es.close(); this.setStatus("closed"); }
}
