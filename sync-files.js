let database;
export async function syncFile(method, key, value) {
  database ||= new Promise((resolve, reject) => { const r = indexedDB.open('qibian-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', method === 'get' ? 'readonly' : 'readwrite');
    const request = method === 'put' ? tx.objectStore('files').put(value, key) : tx.objectStore('files')[method](key);
    tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(tx.error || request.error);
  });
}
