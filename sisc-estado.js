/* sisc-estado.js — Recuerda dónde te quedaste en cada app del SIS Comunitario.
   Si Android minimiza o cierra la app y al volver se recarga, esto devuelve:
     · la pantalla (o pestaña/sección) donde estabas,
     · el registro que estabas editando (mef, visita domiciliar, registro diario),
     · lo que ya habías escrito en el formulario (borrador),
     · la posición del scroll.
   Y si el APK vuelve a abrir el menú (index.html), te manda a la última app que usabas.
   Va justo después de storage-shim.js:  <script src="sisc-estado.js"></script>
   Guarda en el localStorage REAL (síncrono, aguanta aunque el sistema mate la app),
   con llaves que empiezan en "__sisc_" (no se mezclan con tus datos ni se sincronizan). */
(function () {
  'use strict';
  if (window.__siscEstado) return;
  try { if (window.top !== window.self) return; } catch (e) { return; }   // no actuar dentro del iframe de sincronización

  var MAX_MS = 10 * 3600 * 1000;   // pasadas 10 h ya no se restaura
  var RELOAD_MS = 120000;          // recarga programada (ej. guardar perfil): se restaura si fue hace < 2 min
  var MIN_BG_MS = 2500;            // para distinguir "me fui a otra app" de "navegué a propósito"
  var P = '__sisc_est:', ULT = '__sisc_ult';

  var RLS = null;
  try { RLS = window.localStorage; } catch (e) {}   // aún es el real: el shim lo reemplaza más tarde
  if (!RLS) return;

  function rd(k) { try { return JSON.parse(RLS.getItem(k) || 'null'); } catch (e) { return null; } }
  function wr(k, v) { try { RLS.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function safe(f) { try { return f(); } catch (e) { return null; } }

  var file = 'index.html';
  try { file = decodeURIComponent(location.pathname.split('/').pop() || 'index.html'); } catch (e) {}

  function navType() {
    try {
      var n = performance.getEntriesByType('navigation')[0];
      if (n && n.type) return n.type;
      var t = performance.navigation && performance.navigation.type;
      return t === 2 ? 'back_forward' : t === 1 ? 'reload' : 'navigate';
    } catch (e) { return 'navigate'; }
  }

  /* ---------- Cómo moverse en cada app ---------- */
  var A = {
    'mef.html': {
      sel: '.screen.active', home: 'screen-home', form: 'screen-form', hist: true,
      fb: { 'screen-month-view': 'screen-home' },
      ok: function () { return typeof goTo === 'function' && !!document.querySelector('.screen.active'); },
      go: function (id) { goTo(id, id === 'screen-form' ? 'new' : undefined); },
      edit: function () { return typeof editingId !== 'undefined' ? editingId : null; },
      open: function (id) { openRecord(id); }
    },
    'visita_domiciliar.html': {
      sel: '.screen.active', home: 'screen-home', form: 'screen-form', hist: true,
      fb: { 'screen-patient-detail': 'screen-patients', 'screen-month-view': 'screen-months', 'screen-viewer': 'screen-list' },
      ok: function () { return typeof goTo === 'function' && !!document.querySelector('.screen.active'); },
      go: function (id) { goTo(id, id === 'screen-form' ? 'new' : undefined); },
      edit: function () { return typeof editingId !== 'undefined' ? editingId : null; },
      open: function (id) { openRecord(id); }
    },
    'RegistroDiario_Promotor.html': {
      sel: '.screen.active', home: 'screen-home', form: 'screen-nuevo',
      ok: function () { return typeof irA === 'function' && !!document.querySelector('.screen.active'); },
      go: function (id) { irA(id); },
      edit: function () { return typeof _editId !== 'undefined' ? _editId : null; },
      open: function (id) { editarRegistro(id); }
    },
    'MapaSanitario.html': {
      sel: '.screen.active', home: 'screen-home',
      ok: function () { return typeof irA === 'function' && !!document.querySelector('.screen.active'); },
      go: function (id) { irA(id); }
    },
    'Vigilancia_Materna.html': {
      sel: '.section.active', home: 'inicio',
      ok: function () { return typeof mostrarSeccion === 'function' && !!document.querySelector('.section.active'); },
      go: function (id) { mostrarSeccion(id); }
    },
    'CurvasdeCrecimiento.html': {
      sel: '.content.active', home: 'personas',
      ok: function () { return typeof mostrarPanel === 'function' && !!document.querySelector('.content.active'); },
      go: function (id) { mostrarPanel(id); }
    },
    'calculadora_materna.html': {
      home: null,
      curEl: function () {
        var t = document.querySelectorAll('.tabcontent');
        for (var i = 0; i < t.length; i++) if (t[i].style.display === 'block') return t[i];
        return null;
      },
      ok: function () { return typeof openTab === 'function' && !!document.getElementById('menuSection'); },
      go: function (id) { openTab(id); }
    }
  };

  /* ---------- Menú principal (index.html): volver a la última app ---------- */
  if (file === 'index.html') {
    var ult = rd(ULT), now0 = Date.now(), dest = null;
    if (ult && ult.bg && ult.f && A[ult.f] && (now0 - ult.t) < MAX_MS && (now0 - ult.t) > MIN_BG_MS &&
        !location.hash && !location.search && navType() !== 'back_forward') dest = ult.f;
    // Estando en el menú, ninguna otra app queda "en segundo plano"
    Object.keys(A).forEach(function (f) {
      if (f === dest) return;
      var s = rd(P + f);
      if (s && s.bg) { s.bg = false; wr(P + f, s); }
    });
    try { RLS.removeItem(ULT); } catch (e) {}
    window.__siscEstado = { limpiar: limpiar };
    if (dest) location.replace(dest);
    return;
  }

  var ad = A[file];
  if (!ad) return;
  window.__siscEstado = { limpiar: limpiar };

  function limpiar() {
    try {
      Object.keys(A).forEach(function (f) { RLS.removeItem(P + f); });
      RLS.removeItem(ULT);
    } catch (e) {}
  }

  /* ---------- Leer el estado actual de la pantalla ---------- */
  function cur() {
    var el = null;
    try { el = ad.curEl ? ad.curEl() : document.querySelector(ad.sel); } catch (e) {}
    return el && el.id ? el : null;
  }
  function scrollerOf(el) { return el.querySelector('.scroller') || el; }

  function drafts(el) {
    var out = {}, n = 0, list = el.querySelectorAll('input,select,textarea');
    for (var i = 0; i < list.length && n < 400; i++) {
      var f = list[i], id = f.id, t = (f.type || '').toLowerCase();
      if (!id) continue;
      if (t === 'file' || t === 'password' || t === 'button' || t === 'submit' || t === 'reset' || t === 'image') continue;
      if (t === 'checkbox') { out[id] = { c: f.checked ? 1 : 0 }; n++; continue; }
      if (t === 'radio') { if (f.checked) { out[id] = { c: 1 }; n++; } continue; }
      var v = f.value;
      if (v === '' || v == null || v.length > 8000) continue;   // sin vacíos ni imágenes/firmas enormes
      out[id] = { v: v }; n++;
    }
    return out;
  }

  var pending = true;   // mientras la app arranca / restauramos, no se guarda nada (para no pisar lo guardado)
  var touched = false;

  function snap(bg) {
    if (pending) return;
    try {
      var el = cur(), s = { t: Date.now(), bg: !!bg, scr: el ? el.id : null };
      if (el) {
        s.edit = safe(ad.edit || function () { return null; });
        s.d = drafts(el);
        s.sc = { w: window.scrollY || 0, s: scrollerOf(el).scrollTop || 0 };
        if (ad.hist && typeof _navHistory !== 'undefined' && _navHistory && _navHistory.slice) s.h = _navHistory.slice(-30);
      }
      wr(P + file, s);
      wr(ULT, { f: file, t: s.t, bg: !!bg });
    } catch (e) {}
  }

  /* ---------- Restaurar ---------- */
  function fire(el, type) { try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e) {} }

  function putDrafts(d) {
    var bad = 0;
    for (var id in d) {
      if (!Object.prototype.hasOwnProperty.call(d, id)) continue;
      var el = document.getElementById(id), x = d[id];
      if (!el) continue;
      try {
        if ('c' in x) {
          if (el.checked !== !!x.c) { el.checked = !!x.c; fire(el, 'change'); }
        } else if (el.value !== x.v) {
          if (el.tagName === 'SELECT') {
            var has = false;
            for (var k = 0; k < el.options.length; k++) if (el.options[k].value === x.v) { has = true; break; }
            if (!has) { bad++; continue; }   // las opciones aún no existen (listas que dependen de otra)
          }
          el.value = x.v;
          fire(el, 'input'); fire(el, 'change');
        }
      } catch (e) {}
    }
    return bad;
  }

  function target(st) { return (ad.fb && ad.fb[st.scr]) || st.scr; }

  function navigate(st) {
    var id = target(st);
    if (!id || id === ad.home || !document.getElementById(id)) return;
    var c = cur();
    if (c && c.id === id) return;
    if (st.edit && ad.form === id && ad.open) safe(function () { ad.open(st.edit); });
    c = cur();
    if (!c || c.id !== id) safe(function () { ad.go(id); });
    c = cur();
    if (!c || c.id !== id) {   // último recurso: tocar el botón que lleva a esa pantalla
      var b = document.querySelector('[onclick*="' + id + '"]');
      if (b) safe(function () { b.click(); });
    }
    if (ad.hist && st.h && Object.prototype.toString.call(st.h) === '[object Array]' && typeof _navHistory !== 'undefined') {
      try { _navHistory = st.h; } catch (e) {}
    }
  }

  function afterNav(st) {
    var c = cur();
    if (!c || c.id !== st.scr) return;        // no llegamos a la misma pantalla (ej. era un detalle): sin borrador
    if (st.d) {
      var bad = putDrafts(st.d);
      if (bad) { setTimeout(function () { putDrafts(st.d); }, 600); setTimeout(function () { putDrafts(st.d); }, 1600); }
    }
    if (st.sc) setTimeout(function () {
      try { var c2 = cur(); if (c2) { scrollerOf(c2).scrollTop = st.sc.s || 0; if (st.sc.w) window.scrollTo(0, st.sc.w); } } catch (e) {}
    }, 350);
  }

  function whenReady(cb) {
    var t0 = Date.now();
    (function p() {
      var ok = false;
      try { ok = document.readyState === 'complete' && ad.ok(); } catch (e) {}
      if (ok) return setTimeout(cb, 700);          // damos tiempo a que la app termine de arrancar
      if (Date.now() - t0 > 20000) return cb();
      setTimeout(p, 200);
    })();
  }

  /* ---------- Decidir si toca restaurar ---------- */
  var st0 = rd(P + file), nt = navType(), now = Date.now();
  var doRestore = !!(st0 && st0.scr && !location.search && !location.hash && nt !== 'back_forward' &&
    (now - st0.t) < MAX_MS &&
    ((st0.bg && (now - st0.t) > MIN_BG_MS) || (nt === 'reload' && (now - st0.t) < RELOAD_MS)));

  ['pointerdown', 'keydown', 'touchstart'].forEach(function (e) {
    document.addEventListener(e, function () { touched = true; }, { capture: true, passive: true });
  });

  function bind() {
    var tm = null;
    function later() { if (pending) return; clearTimeout(tm); tm = setTimeout(function () { snap(false); }, 500); }
    ['click', 'input', 'change', 'focusout'].forEach(function (e) { document.addEventListener(e, later, true); });
    document.addEventListener('visibilitychange', function () { snap(document.visibilityState === 'hidden'); });
    document.addEventListener('freeze', function () { snap(true); });
    window.addEventListener('pagehide', function () { var s = rd(P + file); snap(s ? s.bg : false); });
  }

  function reaplicar(st, veces) {
    if (touched || veces <= 0) return;
    var c = cur();
    if (c && c.id === target(st)) return;
    navigate(st); setTimeout(function () { afterNav(st); }, 450);
    setTimeout(function () { reaplicar(st, veces - 1); }, 1500);
  }

  whenReady(function () {
    bind();
    if (!doRestore) { pending = false; snap(false); return; }
    navigate(st0);
    setTimeout(function () { afterNav(st0); }, 450);
    setTimeout(function () { pending = false; snap(false); }, 1200);
    // Si la app, al terminar de cargar, nos devolvió al inicio, se vuelve a intentar (máx. 2 veces)
    setTimeout(function () { reaplicar(st0, 2); }, 1800);
  });
})();
