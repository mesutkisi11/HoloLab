// IndexedDB: tarayıcının içindeki küçük veritabanı. Yüklenen GLB dosyaları burada kalır,
// sayfa yenilense de silinmez. Bilgisayardaki orijinal dosyaya hiç dokunulmaz.

const DB_NAME = 'hololab';
const STORE = 'designs';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const designDb = {
  list: () => run('readonly', (s) => s.getAll()),
  get: (id) => run('readonly', (s) => s.get(id)),
  put: (design) => run('readwrite', (s) => s.put(design)),
  remove: (id) => run('readwrite', (s) => s.delete(id)),
};
