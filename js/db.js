// Tiny IndexedDB wrapper. Stores: songs (id), bibles (id), kv (string key → any).
const NAME = "narrative", VERSION = 1;
let dbp;

function open(){
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("songs"))  db.createObjectStore("songs",  { keyPath: "id" });
      if (!db.objectStoreNames.contains("bibles")) db.createObjectStore("bibles", { keyPath: "id" });
      if (!db.objectStoreNames.contains("kv"))     db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function run(store, mode, fn){
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode), s = tx.objectStore(store);
    const req = fn(s);
    tx.oncomplete = () => resolve(req && "result" in req ? req.result : undefined);
    tx.onerror = tx.onabort = () => reject(tx.error);
  }));
}

export const db = {
  all:  store        => run(store, "readonly",  s => s.getAll()),
  get:  (store, key) => run(store, "readonly",  s => s.get(key)),
  put:  (store, val, key) => run(store, "readwrite", s => key === undefined ? s.put(val) : s.put(val, key)),
  del:  (store, key) => run(store, "readwrite", s => s.delete(key)),
  // light listing of bibles without loading their full text into memory twice
  keys: store        => run(store, "readonly",  s => s.getAllKeys()),
};

// Ask the browser not to evict our data under storage pressure (best effort).
export async function persist(){
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
  catch { return false; }
}
