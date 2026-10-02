/* eslint-env browser */
(function () {
  const DATABASE_NAME = 'nmdwsm-history';
  const MAX_RECORDS = 20;
  const STORES = new Set(['valuations', 'marketSearches']);
  let databasePromise;

  function openDatabase() {
    if (!window.indexedDB) return Promise.reject(new Error('此瀏覽器不支援本機歷史紀錄。'));
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
          for (const name of STORES) {
            if (!request.result.objectStoreNames.contains(name)) {
              request.result.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
            }
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('歷史紀錄資料庫正在被其他分頁使用。'));
      }).catch(error => {
        databasePromise = null;
        throw error;
      });
    }
    return databasePromise;
  }

  async function run(storeName, mode, work) {
    if (!STORES.has(storeName)) throw new Error('不支援的歷史紀錄類別。');
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      let value;
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('歷史紀錄操作失敗。'));
      work(transaction.objectStore(storeName), result => { value = result; });
    });
  }

  function add(storeName, record) {
    return run(storeName, 'readwrite', (store, setValue) => {
      const request = store.add({ ...record, createdAt: new Date().toISOString() });
      request.onsuccess = () => {
        setValue(request.result);
        const keysRequest = store.getAllKeys();
        keysRequest.onsuccess = () => {
          const excess = keysRequest.result.length - MAX_RECORDS;
          if (excess > 0) keysRequest.result.slice(0, excess).forEach(key => store.delete(key));
        };
      };
    });
  }

  function list(storeName) {
    return run(storeName, 'readonly', (store, setValue) => {
      const request = store.getAll();
      request.onsuccess = () => setValue(request.result.reverse());
    });
  }

  function remove(storeName, id) {
    return run(storeName, 'readwrite', store => store.delete(id));
  }

  function clear(storeName) {
    return run(storeName, 'readwrite', store => store.clear());
  }

  window.NMDHistory = { add, list, remove, clear };
})();
