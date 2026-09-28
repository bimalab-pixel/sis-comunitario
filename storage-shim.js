/* storage-shim.js — Reemplaza localStorage por IndexedDB sin tocar el resto del código.
   - Las apps siguen usando localStorage.getItem/setItem/removeItem (síncrono).
   - Los datos viven en memoria y se guardan en IndexedDB (sin el límite de 5 MB).
   - Migra automáticamente lo que ya existe en el localStorage real (no borra nada).
   - Difiere los <script type="text/x-deferred"> hasta que los datos estén cargados. */
(function () {
  'use strict';
  if (window.__lsShim) return;

  var DB_NAME = 'sis_comunitario_kv', STORE = 'kv', FLAG = '__migrado_v1';
  var realLS = null;
  try { realLS = window.localStorage; } catch (e) {}

  var mem = new Map(), dirty = new Set(), removed = new Set();
  var db = null, timer = null, flushing = null, active = false, gaveUp = false;

  function hidden(k) { return k.indexOf('__') === 0; }
  function visibleKeys() {
    var out = []; mem.forEach(function (_, k) { if (!hidden(k)) out.push(k); }); return out;
  }

  /* ---------- IndexedDB ---------- */
  function openDB() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('sin IndexedDB'));
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.onblocked = function () { rej(new Error('bloqueada')); };
    });
  }
  function loadAll() {
    return new Promise(function (res, rej) {
      var tx = db.transaction(STORE, 'readonly'), c = tx.objectStore(STORE).openCursor();
      c.onsuccess = function () {
        var cur = c.result;
        if (cur) { mem.set(String(cur.key), cur.value); cur.continue(); } else res();
      };
      c.onerror = function () { rej(c.error); };
    });
  }
  function flush() {
    if (!db) return Promise.resolve();
    if (flushing) return flushing.then(flush);
    if (!dirty.size && !removed.size) return Promise.resolve();
    var w = Array.from(dirty), d = Array.from(removed);
    dirty.clear(); removed.clear();
    flushing = new Promise(function (res) {
      try {
        var tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
        w.forEach(function (k) { if (mem.has(k)) st.put(mem.get(k), k); });
        d.forEach(function (k) { st.delete(k); });
        tx.oncomplete = function () { flushing = null; res(); };
        tx.onerror = tx.onabort = function () {
          console.error('[storage-shim] error al guardar', tx.error);
          w.forEach(function (k) { dirty.add(k); }); d.forEach(function (k) { removed.add(k); });
          flushing = null; res();
        };
      } catch (e) {
        console.error('[storage-shim]', e);
        w.forEach(function (k) { dirty.add(k); }); d.forEach(function (k) { removed.add(k); });
        flushing = null; res();
      }
    });
    return flushing;
  }
  function schedule() { if (!timer) timer = setTimeout(function () { timer = null; flush(); }, 0); }

  /* ---------- API tipo Storage (síncrona, sobre memoria) ---------- */
  var methods = {};
  function def(n, f) { Object.defineProperty(methods, n, { value: f, enumerable: false }); }
  def('getItem', function (k) { k = String(k); return mem.has(k) ? mem.get(k) : null; });
  def('setItem', function (k, v) { k = String(k); mem.set(k, String(v)); dirty.add(k); removed.delete(k); schedule(); });
  def('removeItem', function (k) { k = String(k); if (mem.delete(k)) { dirty.delete(k); removed.add(k); schedule(); } });
  def('clear', function () { visibleKeys().forEach(function (k) { methods.removeItem(k); }); });
  def('key', function (i) { var ks = visibleKeys(); return i < ks.length ? ks[i] : null; });

  var proxy = new Proxy(Object.create(methods), {
    get: function (t, p, r) {
      if (p === 'length') return visibleKeys().length;
      if (typeof p === 'string') {
        if (p in methods) return methods[p];
        return mem.has(p) && !hidden(p) ? mem.get(p) : undefined;
      }
      return Reflect.get(t, p, r);
    },
    set: function (t, p, v) { methods.setItem(p, v); return true; },
    deleteProperty: function (t, p) { methods.removeItem(p); return true; },
    has: function (t, p) { return (typeof p === 'string' && mem.has(p) && !hidden(p)) || p in methods; },
    ownKeys: function () { return visibleKeys(); },
    getOwnPropertyDescriptor: function (t, p) {
      if (typeof p === 'string' && mem.has(p) && !hidden(p))
        return { value: mem.get(p), writable: true, enumerable: true, configurable: true };
      return undefined;
    }
  });

  /* ---------- Arranque ---------- */
  function migrate() {
    if (mem.has(FLAG) || !realLS) return flush();
    try {
      for (var i = 0; i < realLS.length; i++) {
        var k = realLS.key(i);
        if (!mem.has(k)) { mem.set(k, realLS.getItem(k)); dirty.add(k); }
      }
    } catch (e) { console.warn('[storage-shim] migración parcial', e); }
    mem.set(FLAG, '1'); dirty.add(FLAG);
    return flush();
  }

  var ready = new Promise(function (resolve) {
    var t = setTimeout(function () { gaveUp = true; console.warn('[storage-shim] IndexedDB no respondió; se usa localStorage'); resolve(false); }, 8000);
    openDB().then(function (d) { db = d; return loadAll(); }).then(migrate).then(function () {
      if (gaveUp) return;
      clearTimeout(t);
      Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return proxy; } });
      active = true; resolve(true);
    }).catch(function (e) {
      console.warn('[storage-shim] se usa localStorage normal:', e); clearTimeout(t); resolve(false);
    });
  });

  // Pide al sistema que NO borre los datos si falta espacio
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });

  window.__lsShim = {
    ready: ready, flush: flush,
    activo: function () { return active; },
    uso: function () { return navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve({}); },
    // Borra la copia vieja del localStorage real (hacerlo solo cuando confirmes que todo está bien)
    limpiarRespaldo: function () { if (active && realLS) { var n = realLS.length; realLS.clear(); return n; } return 0; }
  };

  /* ---------- Ejecutar los scripts diferidos cuando todo esté listo ---------- */
  var late = [], capturedOnload = null;
  function boot() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('script[type="text/x-deferred"]'));
    var oDoc = document.addEventListener, oWin = window.addEventListener;
    function wrap(orig, isWin) {
      return function (type, fn, opt) {
        if (typeof fn === 'function' && (type === 'DOMContentLoaded' || (type === 'load' && isWin && document.readyState === 'complete'))) {
          late.push([fn, isWin ? window : document, type]); return;
        }
        return orig.call(this, type, fn, opt);
      };
    }
    document.addEventListener = wrap(oDoc, false);
    window.addEventListener = wrap(oWin, true);
    var hookOnload = document.readyState === 'complete';
    if (hookOnload) Object.defineProperty(window, 'onload', { configurable: true, get: function () { return capturedOnload; }, set: function (f) { capturedOnload = f; } });

    function finish() {
      document.addEventListener = oDoc; window.addEventListener = oWin;
      if (hookOnload) delete window.onload;
      setTimeout(function () {
        late.forEach(function (x) { try { x[0].call(x[1], new Event(x[2])); } catch (e) { console.error(e); } });
        if (typeof capturedOnload === 'function') { try { capturedOnload.call(window, new Event('load')); } catch (e) { console.error(e); } }
      }, 0);
    }
    (function next(i) {
      if (i >= nodes.length) return finish();
      var old = nodes[i], s = document.createElement('script');
      Array.prototype.forEach.call(old.attributes, function (a) {
        if (a.name !== 'type' && a.name !== 'data-orig-type') s.setAttribute(a.name, a.value);
      });
      var ot = old.getAttribute('data-orig-type'); if (ot) s.type = ot;
      var src = old.getAttribute('src');
      if (src) { s.onload = s.onerror = function () { next(i + 1); }; s.src = src; old.parentNode.replaceChild(s, old); }
      else { s.text = old.text; old.parentNode.replaceChild(s, old); next(i + 1); }
    })(0);
  }
  var parsed = new Promise(function (r) {
    if (document.readyState !== 'loading') r(); else document.addEventListener('DOMContentLoaded', function () { r(); });
  });
  Promise.all([ready, parsed]).then(boot);
})();
