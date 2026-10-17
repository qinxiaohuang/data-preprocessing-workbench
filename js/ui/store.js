/* =========================================================
 * ui/store.js — IndexedDB 持久化（挂 global.DPStore）
 * 库名 dp-workbench，store 'kv'，key 'workspace'
 * 全部 Promise 化；失败（如无痕模式）reject 中文错误
 * ======================================================= */
(function (global) {
  'use strict';

  const DB_NAME = 'dp-workbench';
  const DB_VERSION = 1;
  const STORE = 'kv';
  const WS_KEY = 'workspace';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('当前浏览器不支持本地存储（IndexedDB）'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () {
        reject(new Error('无法打开本地存储，请勿使用无痕模式：' + (req.error && req.error.message || '未知错误')));
      };
      req.onblocked = function () {
        reject(new Error('本地存储被其他页面占用，请关闭本工具的其他标签页后重试'));
      };
    });
    // 打开失败后允许重试
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }

  function tx(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        fn(store, resolve, reject);
        t.onerror = function () {
          reject(new Error('本地存储读写失败：' + (t.error && t.error.message || '未知错误')));
        };
      });
    });
  }

  // 保存工作区（JSON 字符串）
  function saveWorkspace(jsonString) {
    return tx('readwrite', function (store, resolve) {
      const req = store.put(jsonString, WS_KEY);
      req.onsuccess = function () { resolve(); };
    });
  }

  // 读取工作区 → string | null
  function loadWorkspace() {
    return tx('readonly', function (store, resolve) {
      const req = store.get(WS_KEY);
      req.onsuccess = function () {
        resolve(req.result === undefined || req.result === null ? null : String(req.result));
      };
    });
  }

  // 清空工作区
  function clearWorkspace() {
    return tx('readwrite', function (store, resolve) {
      const req = store.delete(WS_KEY);
      req.onsuccess = function () { resolve(); };
    });
  }

  /* ---------- 导出 ---------- */
  const api = {
    DB_NAME: DB_NAME,
    openDB: openDB,
    saveWorkspace: saveWorkspace,
    loadWorkspace: loadWorkspace,
    clearWorkspace: clearWorkspace
  };
  global.DPStore = Object.assign(global.DPStore || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
