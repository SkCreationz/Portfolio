/* Portfolio admin panel — static, runs entirely in your browser. Publishes to GitHub through the GitHub API. */
(function () {
  'use strict';
  const PF = window.PF;
  const $ = (s, r) => (r || document).querySelector(s);

  /* ---------------- tiny DOM helper ---------------- */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k === 'html') e.innerHTML = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    kids.flat(Infinity).forEach(c => { if (c == null || c === false) return; e.append(c.nodeType ? c : document.createTextNode(c)); });
    return e;
  }
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const set = (o, p, v) => { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach(k => { a = a[k]; }); a[ks[ks.length - 1]] = v; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  function toast(msg, kind) {
    const t = h('div', { class: 'toast ' + (kind || '') }, msg);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3200);
  }

  /* ---------------- state ---------------- */
  const S = {
    content: null, liveJSON: '', pending: new Map(), authDirty: false,
    panel: 'quick', stage: [], vstage: { thumb: '', title: '', brand: '', url: '' }, galFilter: 'all', lastCat: ''
  };

  /* ---------------- IndexedDB for not-yet-published media ---------------- */
  let dbp;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('pf_admin', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('media', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function idb(mode, fn) {
    try {
      const d = await db();
      return await new Promise((res, rej) => { const tx = d.transaction('media', mode); const st = tx.objectStore('media'); const rq = fn(st); tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error); });
    } catch (e) { return null; }
  }

  /* ---------------- pending media ---------------- */
  function addPending(blob, name, kind) {
    const id = uid();
    const rec = { id, blob, name, kind: kind || 'img', url: URL.createObjectURL(blob) };
    S.pending.set(id, rec);
    idb('readwrite', st => st.put({ id, blob, name, kind: rec.kind }));
    return 'pending:' + id;
  }
  function resolve(v, forPreview) {
    if (!v) return '';
    if (v.startsWith('pending:')) {
      const r = S.pending.get(v.slice(8));
      if (!r) return '';
      return forPreview && r.kind === 'video' ? r.url + '#.mp4' : r.url;
    }
    if (/^(https?:|data:|blob:)/.test(v)) return v;
    return '../' + v;
  }
  function walkStrings(o, fn) {
    if (Array.isArray(o)) o.forEach((x, i) => { if (typeof x === 'string') o[i] = fn(x); else walkStrings(x, fn); });
    else if (o && typeof o === 'object') Object.keys(o).forEach(k => { if (typeof o[k] === 'string') o[k] = fn(o[k]); else walkStrings(o[k], fn); });
  }

  async function processImage(file, max) {
    if (!/^image\//.test(file.type)) throw new Error('"' + file.name + '" is not an image.');
    const keep = /image\/(png|webp|gif|svg)/.test(file.type) && file.size < 450 * 1024;
    if (keep) return { blob: file, ext: file.type.split('/')[1].replace('svg+xml', 'svg') };
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read "' + file.name + '".')); i.src = URL.createObjectURL(file); }); }
    const w = bmp.width, hh = bmp.height, k = Math.min(1, max / Math.max(w, hh));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
    return { blob, ext: 'jpg' };
  }
  async function addImageFile(file, max) {
    const { blob, ext } = await processImage(file, max || 1800);
    return addPending(blob, slug(file.name.replace(/\.[^.]+$/, '')) + '.' + ext, 'img');
  }

  /* ---------------- schema safety ---------------- */
  const SEC_NAMES = { hero: 'Intro (top)', about: 'About', tools: 'Tools', experience: 'Experience', skills: 'Skills', work: 'Work gallery', video: 'Videos', contact: 'Contact' };
  function ensure(c) {
    const d = (o, k, v) => { if (o[k] == null) o[k] = v; };
    ['site', 'profile', 'theme', 'hero', 'about', 'tools', 'experience', 'skills', 'work', 'video', 'contact', 'footer'].forEach(k => d(c, k, {}));
    d(c, 'sections', []);
    Object.keys(SEC_NAMES).forEach(id => { if (!c.sections.find(s => s.id === id)) c.sections.push({ id, visible: true, nav: '' }); });
    d(c.hero, 'buttons', []); d(c.hero, 'swatches', []); d(c.about, 'meta', []);
    d(c.tools, 'groups', []); d(c.skills, 'groups', []); d(c.experience, 'items', []);
    d(c.work, 'items', []); d(c.work, 'categories', []); d(c.video, 'items', []);
    d(c.contact, 'rows', []); d(c.contact, 'buttons', []);
    return c;
  }

  /* ================= AUTH ================= */
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const unhex = s => new Uint8Array(s.match(/../g).map(x => parseInt(x, 16)));
  async function pbk(pass, saltHex, iter) {
    if (!(window.crypto && crypto.subtle)) throw new Error('Secure connection (https) required. Open the admin from your https://…github.io address.');
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(saltHex), iterations: iter, hash: 'SHA-256' }, k, 256));
  }
  async function fileAuth() {
    try { const r = await fetch('auth.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) { /* ignore */ }
    return null;
  }
  function overrideAuth() { try { return JSON.parse(ls.get('pf_auth') || 'null'); } catch (e) { return null; } }
  async function checkLogin(user, pass) {
    const cands = [overrideAuth(), await fileAuth()].filter(Boolean);
    if (!cands.length) throw new Error('Could not load auth.json. Make sure the admin folder is published.');
    for (const a of cands) {
      if (a.username.toLowerCase() === user.trim().toLowerCase() && (await pbk(pass, a.salt, a.iterations)) === a.hash) return a;
    }
    return null;
  }
  async function setCredentials(user, pass) {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16))), iterations = 250000;
    const a = { username: user.trim(), salt, iterations, hash: await pbk(pass, salt, iterations), mustChange: false };
    ls.set('pf_auth', JSON.stringify(a));
    S.authDirty = true; saveDraft(); refreshStatus();
  }
  function sessionOK() {
    for (const st of [localStorage, sessionStorage]) {
      try { const s = JSON.parse(st.getItem('pf_session') || 'null'); if (s && s.exp > Date.now()) return true; } catch (e) { /* ignore */ }
    }
    return false;
  }
  function startSession(keep) {
    const v = JSON.stringify({ exp: Date.now() + (keep ? 7 * 864e5 : 12 * 36e5) });
    try { (keep ? localStorage : sessionStorage).setItem('pf_session', v); } catch (e) { /* ignore */ }
  }
  function signOut() {
    ls.del('pf_session'); try { sessionStorage.removeItem('pf_session'); } catch (e) { /* ignore */ }
    location.reload();
  }
  function lockState() { try { return JSON.parse(ls.get('pf_lock') || '{}'); } catch (e) { return {}; } }

  function showLogin() {
    $('#login').hidden = false; $('#app').hidden = true;
    $('#loginForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const err = $('#lerr'), btn = $('#lbtn'); err.textContent = '';
      const lk = lockState();
      if (lk.until && lk.until > Date.now()) { err.textContent = 'Too many attempts. Try again in ' + Math.ceil((lk.until - Date.now()) / 60000) + ' min.'; return; }
      btn.disabled = true; btn.textContent = 'Checking…';
      try {
        const a = await checkLogin($('#lu').value, $('#lp').value);
        if (a) {
          ls.del('pf_lock'); startSession($('#lkeep').checked);
          $('#login').hidden = true; await startApp(a.mustChange);
        } else {
          const n = (lk.n || 0) + 1; ls.set('pf_lock', JSON.stringify({ n, until: n >= 5 ? Date.now() + 5 * 60000 : 0 }));
          err.textContent = n >= 5 ? 'Too many attempts. Locked for 5 minutes.' : 'Wrong username or password.';
        }
      } catch (e) { err.textContent = e.message; }
      btn.disabled = false; btn.textContent = 'Sign in';
    });
  }

  /* ================= modal ================= */
  function modal({ title, body, actions, dismiss = true }) {
    const root = $('#modalRoot');
    const close = () => m.remove();
    const m = h('div', { class: 'modal', onmousedown: e => { if (dismiss && e.target === m) close(); } },
      h('div', { class: 'box' }, h('h3', null, title), body && (typeof body === 'string' ? h('p', null, body) : body),
        actions && h('div', { class: 'actions' }, actions.map(a => h('button', { class: 'btn ' + (a.primary ? 'primary' : '') + (a.danger ? ' danger' : ''), id: a.id, onclick: async () => { if (a.onClick) { const r = await a.onClick(close); if (r === false) return; } if (!a.keep) close(); } }, a.label)))));
    root.append(m); return { close, el: m };
  }
  function askText(title, label, def) {
    return new Promise(res => {
      const inp = h('input', { value: def || '', placeholder: label });
      const m = modal({ title, body: h('div', { class: 'field' }, inp), actions: [{ label: 'Cancel', onClick: () => res(null) }, { label: 'OK', primary: true, onClick: () => res(inp.value.trim() || null) }] });
      setTimeout(() => inp.focus(), 30); inp.addEventListener('keydown', e => { if (e.key === 'Enter') { res(inp.value.trim() || null); m.close(); } });
    });
  }
  function forceCredentials() {
    const u = h('input', { value: 'sreekanth', autocapitalize: 'none' }), p1 = h('input', { type: 'password', placeholder: 'At least 8 characters' }), p2 = h('input', { type: 'password' });
    const err = h('div', { class: 'err' });
    modal({
      title: 'Set your own login', dismiss: false,
      body: h('div', null, h('p', null, 'You signed in with the starter password. Choose your own username and password now.'),
        h('div', { class: 'field' }, h('label', null, 'New username'), u), h('div', { class: 'field' }, h('label', null, 'New password'), p1), h('div', { class: 'field' }, h('label', null, 'Repeat password'), p2), err),
      actions: [{
        label: 'Save & continue', primary: true, keep: true, onClick: async close => {
          if (u.value.trim().length < 3) { err.textContent = 'Username is too short.'; return false; }
          if (p1.value.length < 8) { err.textContent = 'Password must be at least 8 characters.'; return false; }
          if (p1.value !== p2.value) { err.textContent = 'Passwords do not match.'; return false; }
          await setCredentials(u.value, p1.value); close(); toast('Login saved. It goes live for other devices after you press Publish.', 'ok');
        }
      }]
    });
  }

  /* ================= draft + dirty ================= */
  const saveDraft = debounce(() => { ls.set('pf_draft', JSON.stringify({ content: S.content, authDirty: S.authDirty })); }, 350);
  const isDirty = () => JSON.stringify(S.content) !== S.liveJSON || S.authDirty;
  function refreshStatus() {
    const d = isDirty(), p = $('#status');
    p.textContent = d ? '● Unpublished changes' : '✓ Everything is live';
    p.className = 'pill ' + (d ? 'dirty' : 'clean');
    $('#btnPublish').textContent = d ? '🚀 Publish ●' : '🚀 Publish';
  }
  const pushPreview = debounce(() => {
    const f = $('#pvFrame'); if (!f.contentWindow || !S.previewReady) return;
    const c = clone(S.content); walkStrings(c, v => (v.startsWith('pending:') ? resolve(v, true) : v));
    f.contentWindow.postMessage({ type: 'pf-content', content: c }, location.origin);
  }, 120);
  function changed() { saveDraft(); refreshStatus(); pushPreview(); }
  window.addEventListener('beforeunload', e => { if (S.content && isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  /* ================= field builders ================= */
  const rerender = () => { const m = $('#main'), y = m.scrollTop; renderPanel(); m.scrollTop = y; };
  const afterList = () => { changed(); rerender(); };
  function field(label, node, help) { return h('div', { class: 'field' }, label && h('label', null, label), node, help && h('div', { class: 'help' }, help)); }
  function bind(el, path, parse) {
    el.addEventListener('input', () => { set(S.content, path, parse ? parse(el) : el.value); changed(); });
    return el;
  }
  const F = {
    text: (label, path, o = {}) => field(label, bind(h('input', { value: get(S.content, path) || '', placeholder: o.ph || '', type: o.type || 'text' }), path), o.help),
    area: (label, path, o = {}) => field(label, bind(h('textarea', { rows: o.rows || 4, placeholder: o.ph || '' }, get(S.content, path) || ''), path), o.help),
    select: (label, path, opts, o = {}) => {
      const s = h('select', null, opts.map(([v, l]) => h('option', { value: v, selected: String(get(S.content, path)) === String(v) }, l)));
      return field(label, bind(s, path, e => (o.num ? +e.value : e.value)), o.help);
    },
    toggle: (label, path, o = {}) => h('label', { class: 'toggle', style: { marginBottom: '.9rem' } }, bind(h('input', { type: 'checkbox', checked: get(S.content, path) !== false && !!get(S.content, path) || (o.dflt && get(S.content, path) == null) }), path, e => e.checked), h('span', null, label)),
    range: (label, path, min, max, unit) => {
      const out = h('span', { class: 'help' }, (get(S.content, path) ?? 0) + unit);
      const r = h('input', { type: 'range', min, max, value: get(S.content, path) ?? 0 });
      r.addEventListener('input', () => { set(S.content, path, +r.value); out.textContent = r.value + unit; changed(); });
      return field(label, h('div', { class: 'row' }, r, out));
    },
    color: (label, path) => {
      const c = h('input', { type: 'color', value: get(S.content, path) || '#000000' });
      const t = h('input', { value: get(S.content, path) || '', maxlength: 7 });
      c.addEventListener('input', () => { t.value = c.value.toUpperCase(); set(S.content, path, c.value.toUpperCase()); changed(); });
      t.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) { c.value = t.value; set(S.content, path, t.value.toUpperCase()); changed(); } });
      return field(label, h('div', { class: 'colorfield' }, c, t));
    }
  };
  function imageField(label, path, o = {}) {
    const th = h('div', { class: 'th' });
    const paint = () => { const v = get(S.content, path); th.className = 'th' + (v ? ' has' : ''); th.style.backgroundImage = v ? 'url("' + resolve(v) + '")' : ''; th.textContent = v ? '' : 'No image'; };
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { set(S.content, path, await addImageFile(f, o.max || 1800)); paint(); changed(); } catch (er) { toast(er.message, 'err'); } } });
    paint();
    return field(label, h('div', { class: 'imgf' }, th, h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', onclick: () => file.click() }, '📷 Choose image'), get(S.content, path) && !o.required ? h('button', { class: 'btn sm danger', onclick: () => { set(S.content, path, ''); paint(); changed(); rerender(); } }, 'Remove') : null, file)), o.help);
  }
  function tagsField(label, path) {
    const arr = get(S.content, path);
    const box = h('div', { class: 'tags' });
    const inp = h('input', { placeholder: 'Type and press Enter' });
    const draw = () => { box.innerHTML = ''; arr.forEach((t, i) => box.append(h('span', { class: 'tag' }, t, h('button', { title: 'Remove', onclick: () => { arr.splice(i, 1); draw(); changed(); } }, '×')))); box.append(inp); };
    const add = () => { inp.value.split(',').map(x => x.trim()).filter(Boolean).forEach(x => arr.push(x)); inp.value = ''; draw(); changed(); inp.focus(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } if (e.key === 'Backspace' && !inp.value && arr.length) { arr.pop(); draw(); changed(); inp.focus(); } });
    inp.addEventListener('blur', () => { if (inp.value.trim()) add(); });
    draw(); return field(label, box);
  }
  function ctl(arr, i, o = {}) {
    const mv = (a, b) => { const x = arr[a]; arr.splice(a, 1); arr.splice(b, 0, x); afterList(); };
    return h('div', { class: 'row', style: { gap: '.25rem' } },
      !o.fixedFirst || i > 1 ? h('button', { class: 'btn sm icon', title: 'Move up', disabled: i === (o.min || 0), onclick: () => mv(i, i - 1) }, '↑') : h('span'),
      h('button', { class: 'btn sm icon', title: 'Move down', disabled: i === arr.length - 1, onclick: () => mv(i, i + 1) }, '↓'),
      o.noDelete ? null : h('button', { class: 'btn sm icon danger', title: 'Delete', onclick: () => { if (confirm('Delete this item?')) { arr.splice(i, 1); afterList(); } } }, '🗑'));
  }
  const LINK_TYPES = [['phone', 'Phone call'], ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['link', 'Website / social link'], ['text', 'Plain text (no link)']];
  const BTN_TYPES = LINK_TYPES.filter(x => x[0] !== 'text');
  const typeHelp = { phone: '+91 75108 81175', email: 'name@example.com', whatsapp: 'Number with country code', link: 'https://instagram.com/yourname', text: '' };
  function buttonsEditor(path, title) {
    const arr = get(S.content, path);
    const wrap = h('div', null);
    arr.forEach((b, i) => {
      const val = h('input', { value: b.value || '', placeholder: typeHelp[b.type] });
      wrap.append(h('div', { class: 'item' }, h('div', { class: 'item-head' }, h('span', { class: 't' }, b.label || 'Button ' + (i + 1)), ctl(arr, i)),
        h('div', { class: 'grid2' }, F.text('Button text', path + '.' + i + '.label'), F.select('Style', path + '.' + i + '.style', [['solid', 'Filled'], ['ghost', 'Outline']])),
        h('div', { class: 'grid2' }, F.select('Opens', path + '.' + i + '.type', BTN_TYPES, {}), F.text('Number / address / link', path + '.' + i + '.value', { ph: typeHelp[b.type] }))));
    });
    return h('div', null, h('div', { class: 'lbl', style: { margin: '.2rem 0 .5rem' } }, title), wrap,
      h('button', { class: 'btn sm', onclick: () => { arr.push({ label: 'New button', type: 'link', value: '', style: 'ghost' }); afterList(); } }, '＋ Add button'));
  }

  /* ================= PANELS ================= */
  const PANELS = [
    ['quick', '⚡', 'Quick post'], ['hero', '🏠', 'Intro (top)'], ['about', '👤', 'About'], ['skills', '🧰', 'Tools & skills'],
    ['experience', '💼', 'Experience'], ['work', '🖼', 'Work gallery'], ['video', '🎬', 'Videos'], ['contact', '☎️', 'Contact & footer'],
    '-', ['design', '🎨', 'Colours & fonts'], ['layout', '🧩', 'Sections & site info'], ['settings', '⚙️', 'Settings & GitHub']
  ];
  const SCROLL = { hero: 'hero', about: 'about', skills: 'tools', experience: 'experience', work: 'work', video: 'video', contact: 'contact', quick: 'work' };

  function buildSide() {
    const s = $('#side'); s.innerHTML = '';
    PANELS.forEach(p => { if (p === '-') return s.append(h('hr')); s.append(h('button', { class: p[0] === S.panel ? 'on' : '', onclick: () => go(p[0]) }, h('span', { class: 'ico' }, p[1]), p[2])); });
  }
  function go(id) {
    S.panel = id; buildSide(); renderPanel(); $('#main').scrollTop = 0;
    const f = $('#pvFrame'); if (f.contentWindow && SCROLL[id]) f.contentWindow.postMessage({ type: 'pf-scroll', id: SCROLL[id] }, location.origin);
  }
  function renderPanel() {
    const m = $('#main'); m.innerHTML = '';
    const fn = P[S.panel]; m.append(h('div', { class: 'panel' }, fn()));
  }
  const head = (t, lead) => [h('h2', null, t), h('p', { class: 'lead' }, lead)];
  const card = (title, hint, ...kids) => h('div', { class: 'card' }, title && h('h3', null, title), hint && h('p', { class: 'hint' }, hint), ...kids);

  /* ---- shared "add photos" card ---- */
  function catOptions(sel) {
    const c = S.content.work.categories;
    return [...c.map(k => h('option', { value: k.id, selected: k.id === sel }, k.name)), h('option', { value: '__new' }, '＋ New category…')];
  }
  async function newCategory() {
    const name = await askText('New category', 'e.g. Wedding shoots');
    if (!name) return null;
    let id = slug(name), n = 2; while (S.content.work.categories.find(k => k.id === id)) id = slug(name) + '-' + n++;
    S.content.work.categories.push({ id, name }); changed(); return id;
  }
  function postCard() {
    const wrap = h('div');
    const draw = () => {
      wrap.innerHTML = '';
      const inp = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: e => take([...e.target.files]) });
      const drop = h('div', { class: 'drop', onclick: () => inp.click() }, h('b', null, '📤 Add today\'s work'), h('span', null, 'Tap here or drop pictures (you can pick many at once)'), inp);
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', e => take([...e.dataTransfer.files]));
      wrap.append(drop);
      S.stage.forEach((s, i) => {
        const sel = h('select', null, catOptions(s.cat));
        sel.addEventListener('change', async () => { if (sel.value === '__new') { const id = await newCategory(); s.cat = id || s.cat; draw(); } else { s.cat = sel.value; S.lastCat = s.cat; } });
        wrap.append(h('div', { class: 'stage' }, h('div', { class: 'th', style: { backgroundImage: 'url("' + resolve(s.ref) + '")' } }),
          h('div', { class: 'f' }, h('input', { value: s.title, placeholder: 'Title', oninput: e => { s.title = e.target.value; } }), sel,
            h('input', { type: 'date', value: s.date, oninput: e => { s.date = e.target.value; } }),
            h('button', { class: 'btn sm icon danger', onclick: () => { S.stage.splice(i, 1); draw(); } }, '✕'))));
      });
      if (S.stage.length) wrap.append(h('div', { class: 'row', style: { marginTop: '.9rem' } }, h('button', { class: 'btn primary', onclick: addAll }, 'Add ' + S.stage.length + ' to my portfolio'), h('button', { class: 'btn', onclick: () => { S.stage = []; draw(); } }, 'Clear')));
    };
    async function take(files) {
      files = files.filter(f => /^image\//.test(f.type)); if (!files.length) return toast('Please choose image files.', 'err');
      const cats = S.content.work.categories;
      for (const f of files) {
        try { S.stage.push({ ref: await addImageFile(f, 1800), title: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(), cat: S.lastCat || (cats[0] && cats[0].id) || '', date: today() }); }
        catch (e) { toast(e.message, 'err'); }
      }
      if (!cats.length) { const id = await newCategory(); S.stage.forEach(s => { if (!s.cat) s.cat = id; }); }
      draw();
    }
    function addAll() {
      if (S.stage.some(s => !s.cat)) return toast('Choose a category for every picture.', 'err');
      S.content.work.items.unshift(...S.stage.map(s => ({ img: s.ref, title: s.title || 'Untitled', cat: s.cat, date: s.date })));
      toast(S.stage.length + ' added to the top of your gallery. Press Publish to put it live.', 'ok'); S.stage = []; changed(); draw();
      if (S.panel === 'work') rerender();
    }
    draw(); return wrap;
  }
  const ytId = u => { const m = String(u || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{6,})/); return m && m[1]; };

  const P = {};

  P.quick = () => [
    ...head('Quick post', 'The fastest way to post your daily work. Add pictures, give them a title, then press Publish at the top.'),
    card('📸 New design / photo posts', 'Pictures are automatically resized so your site stays fast.', postCard()),
    card('🎞 New video post', 'Paste a YouTube / Google Drive / Instagram link. YouTube thumbnails are filled in automatically.', videoQuick()),
    card('✏️ Quick updates', 'The two things that change most often.',
      F.text('Currently working at', 'profile.currentCompany', { help: 'Shows in the About section.' }),
      F.text('Top line (availability / city)', 'hero.eyebrow', { help: 'Small text above your name, e.g. “Palakkad, Kerala — Available for work”.' }))
  ];
  function videoQuick() {
    const v = S.vstage; const wrap = h('div');
    const paint = () => { th.style.backgroundImage = v.thumb ? 'url("' + resolve(v.thumb) + '")' : ''; th.textContent = v.thumb ? '' : (ytId(v.url) ? 'Auto' : 'No image'); };
    const th = h('div', { class: 'th' });
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { v.thumb = await addImageFile(f, 900); paint(); } catch (er) { toast(er.message, 'err'); } } } });
    const urlIn = h('input', { value: v.url, placeholder: 'https://youtu.be/…', oninput: e => { v.url = e.target.value; paint(); } });
    wrap.append(h('div', { class: 'imgf', style: { marginBottom: '.9rem' } }, th, h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', onclick: () => file.click() }, '📷 Thumbnail'), file)),
      h('div', { class: 'grid2' }, field('Title', h('input', { value: v.title, oninput: e => { v.title = e.target.value; } })), field('Label (client / type)', h('input', { value: v.brand, placeholder: 'Social Reel', oninput: e => { v.brand = e.target.value; } }))),
      field('Video link', urlIn, 'Leave empty to show “available on request”.'),
      h('button', { class: 'btn primary', onclick: () => {
        if (!v.title) return toast('Give the video a title.', 'err');
        const thumb = v.thumb || (ytId(v.url) ? 'https://img.youtube.com/vi/' + ytId(v.url) + '/hqdefault.jpg' : '');
        if (!thumb) return toast('Add a thumbnail image (or use a YouTube link).', 'err');
        S.content.video.items.unshift({ thumb, brand: v.brand, title: v.title, note: '', url: v.url.trim() });
        S.vstage = { thumb: '', title: '', brand: '', url: '' }; changed(); toast('Video added. Press Publish to put it live.', 'ok'); rerender();
      } }, 'Add video'));
    paint(); return wrap;
  }

  P.hero = () => {
    const c = S.content, sw = c.hero.swatches;
    return [...head('Intro (top of the page)', 'The first thing your clients see.'),
      card('Text', null, F.text('Top line', 'hero.eyebrow'), F.text('Your name (big title)', 'hero.name'), F.text('Role line', 'hero.role', { help: 'Tip: separate roles with · ' }), F.area('Short intro', 'hero.sub', { rows: 3 })),
      card('Background picture', null, imageField('Image', 'hero.image', { max: 2000 }), F.range('Picture darkness (higher = brighter)', 'theme.heroBrightness', 5, 80, '%')),
      card('Buttons', null, buttonsEditor('hero.buttons', 'Intro buttons')),
      card('Colour dots', 'The small colour palette shown under the buttons.', F.toggle('Show colour dots', 'hero.showSwatches'),
        h('div', { class: 'row wrap', style: { marginBottom: '.8rem' } }, sw.map((col, i) => h('div', { class: 'row', style: { gap: '.2rem' } },
          h('input', { type: 'color', value: col, onchange: e => { sw[i] = e.target.value.toUpperCase(); changed(); } }), h('button', { class: 'btn sm icon', onclick: () => { sw.splice(i, 1); afterList(); } }, '×')))),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', onclick: () => { sw.push('#FFFFFF'); afterList(); } }, '＋ Add colour'),
          h('button', { class: 'btn sm', onclick: () => { c.hero.swatches = [c.theme.accent, c.theme.fire, c.theme.paper, c.theme.ink]; afterList(); } }, 'Use my theme colours')))];
  };

  P.about = () => {
    const a = S.content.about.meta;
    return [...head('About', 'Your story and quick facts.'),
      card('Text', null, F.text('Section label', 'about.label'), F.text('Headline sentence', 'about.lead'), F.area('Paragraph', 'about.body', { rows: 6 })),
      card('Picture', 'Shows a big letter if you don’t add a picture.', F.text('Big letter', 'about.monogram'), imageField('Your photo (optional)', 'about.photo', { max: 1200 })),
      card('Quick facts', null, F.text('Currently working at', 'profile.currentCompany', { help: 'Used by the “Currently at” row below.' }),
        ...a.map((m, i) => h('div', { class: 'item' }, h('div', { class: 'item-head' }, h('span', { class: 't' }, m.label || 'Row'), ctl(a, i)),
          h('div', { class: 'grid2' }, F.text('Label', 'about.meta.' + i + '.label'), m.auto ? field('Value', h('input', { value: 'Linked to “Currently working at”', disabled: true })) : F.text('Value', 'about.meta.' + i + '.value'))
        )),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', onclick: () => { a.push({ label: 'New fact', value: '' }); afterList(); } }, '＋ Add row'),
          !a.find(x => x.auto) ? h('button', { class: 'btn sm', onclick: () => { a.push({ label: 'Currently at', value: '', auto: 'currentCompany' }); afterList(); } }, '＋ Add “Currently at” row') : null))];
  };

  function groupsEditor(key, title) {
    const g = S.content[key].groups;
    return card(title, null, F.text('Section label', key + '.label'),
      ...g.map((x, i) => h('div', { class: 'item' }, h('div', { class: 'item-head' }, h('span', { class: 't' }, x.label || 'Group'), ctl(g, i)), F.text('Group name', key + '.groups.' + i + '.label'), tagsField('Items', key + '.groups.' + i + '.chips'))),
      h('button', { class: 'btn sm', onclick: () => { g.push({ label: 'New group', chips: [] }); afterList(); } }, '＋ Add group'));
  }
  P.skills = () => [...head('Tools & skills', 'The software you use and what you’re good at. Type an item and press Enter.'), groupsEditor('tools', 'Tools'), groupsEditor('skills', 'Skills')];

  P.experience = () => {
    const it = S.content.experience.items;
    return [...head('Experience', 'Your current and past companies.'), card('Section', null, F.text('Section label', 'experience.label')),
      ...it.map((x, i) => card(null, null, h('div', { class: 'item-head' }, h('span', { class: 't' }, (x.company || 'Company') + (x.current ? ' • current' : '')), ctl(it, i)),
        h('div', { class: 'grid2' }, F.text('Company', 'experience.items.' + i + '.company'), F.text('Dates', 'experience.items.' + i + '.dates', { ph: '2023 — Present' })),
        F.text('Job title', 'experience.items.' + i + '.title'), F.area('What you do there', 'experience.items.' + i + '.text', { rows: 3 }),
        F.toggle('I currently work here (shows a “Now” badge)', 'experience.items.' + i + '.current'))),
      h('button', { class: 'btn primary', onclick: () => { it.unshift({ dates: '', title: '', company: '', text: '', current: false }); afterList(); } }, '＋ Add company')];
  };

  P.work = () => {
    const w = S.content.work, items = w.items;
    const cats = w.categories;
    const shown = items.map((x, i) => [x, i]).filter(([x]) => S.galFilter === 'all' || x.cat === S.galFilter);
    return [...head('Work gallery', items.length + ' pieces. Newest first — move things around with the arrows.'),
      card('📸 Add new pictures', null, postCard()),
      card('Section text & layout', null, F.text('Section label', 'work.label'), F.text('Heading', 'work.title'), F.area('Small note under the gallery', 'work.note', { rows: 2 }),
        h('div', { class: 'grid2' }, F.select('Picture shape', 'work.shape', [['square', 'Square'], ['portrait', 'Portrait (4:5)'], ['landscape', 'Landscape (4:3)'], ['auto', 'Original (no crop)']]), F.text('Name of the “All” filter', 'work.allLabel')),
        F.toggle('Show date on pictures', 'work.showDates')),
      card('Categories', 'These become the filter buttons on your site.',
        ...cats.map((k, i) => { const n = items.filter(x => x.cat === k.id).length; return h('div', { class: 'row', style: { marginBottom: '.5rem' } }, h('input', { value: k.name, oninput: e => { k.name = e.target.value; changed(); } }), h('span', { class: 'help', style: { minWidth: '56px' } }, n + ' pics'), ctl(cats, i, { noDelete: true }), h('button', { class: 'btn sm icon danger', disabled: n > 0, title: n ? 'Move or delete its pictures first' : 'Delete', onclick: () => { cats.splice(i, 1); afterList(); } }, '🗑')); }),
        h('button', { class: 'btn sm', onclick: async () => { if (await newCategory()) rerender(); } }, '＋ Add category')),
      card('All pictures', null, h('div', { class: 'row', style: { marginBottom: '.9rem' } }, h('select', { style: { maxWidth: '240px' }, onchange: e => { S.galFilter = e.target.value; rerender(); } }, [h('option', { value: 'all', selected: S.galFilter === 'all' }, 'Show: all categories'), ...cats.map(k => h('option', { value: k.id, selected: S.galFilter === k.id }, k.name))])),
        h('div', { class: 'gal' }, shown.map(([x, i]) => {
          const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { x.img = await addImageFile(f, 1800); changed(); rerender(); } catch (er) { toast(er.message, 'err'); } } } });
          const sel = h('select', { onchange: e => { x.cat = e.target.value; changed(); } }, cats.map(k => h('option', { value: k.id, selected: k.id === x.cat }, k.name)));
          return h('div', { class: 'g' }, h('div', { class: 'pic', style: { backgroundImage: 'url("' + resolve(x.img) + '")' }, onclick: () => file.click() }, file),
            h('div', { class: 'bd' }, h('input', { value: x.title, placeholder: 'Title', oninput: e => { x.title = e.target.value; changed(); } }), sel, h('input', { type: 'date', value: x.date || '', oninput: e => { x.date = e.target.value; changed(); } })),
            h('div', { class: 'bar' }, h('button', { class: 'btn sm', title: 'Move to top', disabled: i === 0, onclick: () => { items.splice(i, 1); items.unshift(x); afterList(); } }, '⤒'), h('button', { class: 'btn sm', title: 'Earlier', disabled: i === 0, onclick: () => { items.splice(i, 1); items.splice(i - 1, 0, x); afterList(); } }, '◀'), h('button', { class: 'btn sm', title: 'Later', disabled: i === items.length - 1, onclick: () => { items.splice(i, 1); items.splice(i + 1, 0, x); afterList(); } }, '▶'), h('button', { class: 'btn sm danger', title: 'Delete', onclick: () => { if (confirm('Delete “' + x.title + '”?')) { items.splice(i, 1); afterList(); } } }, '🗑')));
        })))];
  };

  P.video = () => {
    const it = S.content.video.items;
    return [...head('Videos', 'Show thumbnails; clients click to watch. Link YouTube, Google Drive or Vimeo (best for long videos).'),
      card('📎 New video post', null, videoQuick()),
      card('Section text & layout', null, F.text('Section label', 'video.label'), F.text('Heading', 'video.title'), F.select('Thumbnail shape', 'video.shape', [['9/16', 'Vertical reel (9:16)'], ['16/9', 'Wide (16:9)'], ['1/1', 'Square'], ['4/5', 'Portrait (4:5)']])),
      ...it.map((x, i) => {
        const pre = 'video.items.' + i + '.';
        const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => { const f = e.target.files[0]; e.target.value = ''; if (f) { try { x.thumb = await addImageFile(f, 900); changed(); rerender(); } catch (er) { toast(er.message, 'err'); } } } });
        const vfile = h('input', { type: 'file', accept: 'video/mp4,video/webm', hidden: true, onchange: e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (f.size > 45 * 1024 * 1024) return toast('That video is over 45 MB — upload it to YouTube / Google Drive and paste the link instead.', 'err'); x.url = addPending(f, slug(f.name.replace(/\.[^.]+$/, '')) + '.' + (f.type.includes('webm') ? 'webm' : 'mp4'), 'video'); changed(); rerender(); } });
        return card(null, null, h('div', { class: 'item-head' }, h('span', { class: 't' }, x.title || 'Video'), ctl(it, i)),
          h('div', { class: 'imgf', style: { marginBottom: '.9rem' } }, h('div', { class: 'th has', style: { backgroundImage: 'url("' + resolve(x.thumb) + '")' } }), h('button', { class: 'btn sm', onclick: () => file.click() }, '📷 Change thumbnail'), file),
          h('div', { class: 'grid2' }, F.text('Title', pre + 'title'), F.text('Label', pre + 'brand')),
          (x.url || '').startsWith('pending:') ? field('Video', h('div', { class: 'row' }, h('input', { disabled: true, value: 'Attached file: ' + ((S.pending.get(x.url.slice(8)) || {}).name || 'video') }), h('button', { class: 'btn sm danger', onclick: () => { x.url = ''; afterList(); } }, 'Remove')), 'Uploads when you press Publish.') : F.text('Video link', pre + 'url', { ph: 'https://youtu.be/…', help: 'YouTube, Vimeo, Google Drive, Instagram… or leave empty.' }),
          h('div', { class: 'row wrap', style: { marginBottom: '.9rem' } }, h('button', { class: 'btn sm', onclick: () => vfile.click() }, '🎥 Or upload a small video file (max 45 MB)'), vfile),
          F.text('Small note on the tile', pre + 'note', { help: 'e.g. “Full video available on request”. Leave empty to hide.' }));
      })];
  };

  P.contact = () => {
    const r = S.content.contact.rows;
    return [...head('Contact & footer', 'How clients reach you.'),
      card('Heading', null, F.text('Section label', 'contact.label'), F.text('Heading', 'contact.title')),
      card('Details', null, ...r.map((x, i) => h('div', { class: 'item' }, h('div', { class: 'item-head' }, h('span', { class: 't' }, x.label || 'Row'), ctl(r, i)),
        h('div', { class: 'grid2' }, F.text('Label', 'contact.rows.' + i + '.label'), F.select('Type', 'contact.rows.' + i + '.type', LINK_TYPES)), F.text('Value', 'contact.rows.' + i + '.value', { ph: typeHelp[x.type] }))),
        h('button', { class: 'btn sm', onclick: () => { r.push({ label: 'Instagram', value: '', type: 'link' }); afterList(); } }, '＋ Add row (Instagram, Behance, WhatsApp…)')),
      card('Buttons', null, buttonsEditor('contact.buttons', 'Contact buttons')),
      card('Footer', null, h('div', { class: 'grid2' }, F.text('Left text', 'footer.left'), F.text('Right text', 'footer.right'))),
      card('Top bar phone number', null, F.text('Phone shown in the top bar', 'site.navPhone'), F.toggle('Show it', 'site.navPhoneShow'))];
  };

  const PRESETS = [
    ['Ocean Cyan', '#060C14', '#EEF4FF', '#00C8E0', '#2979FF'], ['Sunset', '#140A06', '#FFF3EA', '#FF7A1A', '#FF3D54'], ['Emerald', '#04110C', '#EAFBF3', '#18D98B', '#00A3FF'],
    ['Royal Violet', '#0B0716', '#F3EEFF', '#A56BFF', '#FF4FD8'], ['Crimson Noir', '#0C0809', '#F8EDEE', '#FF3B4E', '#FF9A3C'], ['Gold & Black', '#0A0907', '#F6F0E2', '#E8B64A', '#FF8A3D'],
    ['Mint Slate', '#0B0D0E', '#F2F5F4', '#7CF0C6', '#9AA7FF'], ['Midnight Blue', '#050A1F', '#E8EEFF', '#5B8CFF', '#00D1FF']
  ];
  let fontsLoaded = false;
  P.design = () => {
    if (!fontsLoaded) { fontsLoaded = true; document.head.append(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?' + Object.keys(PF.FONTS).map(n => 'family=' + PF.FONTS[n].spec).join('&') + '&display=swap' })); }
    const t = S.content.theme;
    const fsel = (label, path, group) => { const cur = get(S.content, path); const prev = h('div', { class: 'fontprev', style: { fontFamily: "'" + cur + "'" } }, 'Sreekanth — Graphic Designer 0123'); const s = h('select', null, PF.FONT_GROUPS[group].map(n => h('option', { selected: n === cur, value: n }, n))); s.addEventListener('input', () => { set(S.content, path, s.value); prev.style.fontFamily = "'" + s.value + "'"; changed(); }); return field(label, h('div', null, s, prev)); };
    return [...head('Colours & fonts', 'Change the whole look in one click, or fine-tune each colour. You see it live on the right.'),
      card('Ready-made colour themes', null, h('div', { class: 'presets' }, PRESETS.map(p => h('button', { class: 'preset', onclick: () => { Object.assign(t, { ink: p[1], paper: p[2], accent: p[3], fire: p[4] }); changed(); rerender(); } }, h('div', { class: 'sw' }, p.slice(1).map(c => h('i', { style: { background: c } }))), h('span', null, p[0]))))),
      card('Your own colours', null, h('div', { class: 'grid2' }, F.color('Background', 'theme.ink'), F.color('Text', 'theme.paper'), F.color('Main accent (buttons, highlights)', 'theme.accent'), F.color('Second accent (links, gradient)', 'theme.fire'))),
      card('Fonts', null, fsel('Headings & name', 'theme.fontDisplay', 'display'), fsel('Paragraph text', 'theme.fontBody', 'body'), fsel('Small labels & buttons', 'theme.fontMono', 'mono')),
      card('Style', null, F.select('Corner roundness', 'theme.radius', [[0, 'Square'], [2, 'Sharp (default)'], [6, 'Soft'], [12, 'Round'], [20, 'Very round']], { num: true }), F.toggle('Film-grain texture overlay', 'theme.grain', { dflt: true }), F.range('Intro picture brightness', 'theme.heroBrightness', 5, 80, '%'))];
  };

  P.layout = () => {
    const s = S.content.sections;
    return [...head('Sections & site info', 'Hide, show or reorder parts of the page, and set the browser-tab title.'),
      card('Page sections', 'Turn sections on/off and choose the name shown in the top menu (leave the name empty to hide it from the menu).',
        ...s.map((x, i) => i === 0 ? h('div', { class: 'item' }, h('div', { class: 'item-head' }, h('span', { class: 't' }, SEC_NAMES.hero + ' — always first'))) :
          h('div', { class: 'item' }, h('div', { class: 'item-head' }, h('span', { class: 't' }, SEC_NAMES[x.id]), ctl(s, i, { noDelete: true, min: 1 })),
            h('div', { class: 'grid2' }, F.toggle('Show on site', 'sections.' + i + '.visible'), F.text('Menu name', 'sections.' + i + '.nav', { ph: '(not in menu)' }))))),
      card('Browser tab & sharing', null, F.text('Site title', 'site.title'), F.area('Short description (Google / WhatsApp preview)', 'site.description', { rows: 2 }), F.text('Top-left logo text', 'site.logoMark'),
        h('div', { class: 'grid2' }, F.text('Tab icon (emoji)', 'site.favicon'), imageField('…or tab icon image', 'site.faviconImage', { max: 128 })))];
  };

  /* ---------- GitHub ---------- */
  function ghCfg() { try { return JSON.parse(ls.get('pf_gh') || '{}'); } catch (e) { return {}; } }
  function ghGuess() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/), parts = location.pathname.split('/').filter(Boolean);
    if (!m) return {};
    const repo = parts.length > 1 || (parts[0] && parts[0] !== 'admin') ? parts[0] : m[1] + '.github.io';
    return { owner: m[1], repo };
  }
  async function gh(cfg, path, opt = {}) {
    const r = await fetch('https://api.github.com' + path, { method: opt.method || 'GET', headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) }, body: opt.body ? JSON.stringify(opt.body) : undefined });
    if (!r.ok) {
      let msg = r.statusText; try { msg = (await r.json()).message || msg; } catch (e) { /* ignore */ }
      const e = new Error(r.status === 401 ? 'GitHub rejected the token (expired or wrong).' : r.status === 403 || r.status === 404 ? 'GitHub says: ' + msg + ' — check the token has “Contents: Read and write” access to this repository, and the owner/repo names are right.' : 'GitHub: ' + msg);
      e.status = r.status; throw e;
    }
    return r.status === 204 ? null : r.json();
  }
  const pagesURL = c => 'https://' + c.owner + '.github.io/' + (c.repo.toLowerCase() === (c.owner + '.github.io').toLowerCase() ? '' : c.repo + '/');

  P.settings = () => {
    const g = { ...ghGuess(), branch: 'main', ...ghCfg() };
    const f = {}; const inp = (k, ph, type) => (f[k] = h('input', { value: g[k] || '', placeholder: ph, type: type || 'text', autocapitalize: 'none', autocomplete: 'off' }));
    const status = h('div', { class: 'help', style: { marginTop: '.6rem' } });
    const saveCfg = () => { const c = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || 'main', token: f.token.value.trim() }; ls.set('pf_gh', JSON.stringify(c)); return c; };
    const nu = h('input', { value: (overrideAuth() || {}).username || 'sreekanth', autocapitalize: 'none' }), np = h('input', { type: 'password', placeholder: 'New password (min 8)' }), np2 = h('input', { type: 'password', placeholder: 'Repeat new password' });
    return [...head('Settings & GitHub', 'Connect once, then the Publish button sends your changes live.'),
      card('🔗 GitHub connection', 'Stored only in this browser on this device — never inside your website.',
        h('div', { class: 'grid2' }, field('GitHub username', inp('owner', 'your-username')), field('Repository name', inp('repo', 'portfolio'))),
        h('div', { class: 'grid2' }, field('Branch', inp('branch', 'main')), field('Access token', inp('token', 'github_pat_…', 'password'))),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: async () => { const c = saveCfg(); status.textContent = 'Testing…'; try { const r = await gh(c, '/repos/' + c.owner + '/' + c.repo); await gh(c, '/repos/' + c.owner + '/' + c.repo + '/git/ref/heads/' + c.branch); status.textContent = '✅ Connected to ' + r.full_name + (r.permissions && !r.permissions.push ? ' — but this token can only READ. Give it “Contents: Read and write”.' : '. Ready to publish.'); } catch (e) { status.textContent = '❌ ' + e.message; } } }, 'Save & test connection')), status,
        h('hr', { style: { border: 0, borderTop: '1px solid var(--line)', margin: '1.2rem 0' } }),
        h('div', { class: 'lbl', style: { marginBottom: '.6rem' } }, 'How to get the token (one time, 2 minutes)'),
        h('ol', { class: 'steps' },
          h('li', { html: 'Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a>' }),
          h('li', { html: '<b>Repository access</b> → “Only select repositories” → choose your portfolio repository.' }),
          h('li', { html: '<b>Permissions → Repository permissions → Contents</b> → “Read and write”.' }),
          h('li', { html: 'Pick the longest expiry, click <b>Generate token</b>, copy it and paste above.' }))),
      card('🔑 Admin login', 'Change the username/password used on this page.',
        h('div', { class: 'grid2' }, field('Username', nu), field('New password', np)), field('Repeat password', np2),
        h('button', { class: 'btn', onclick: async () => { if (nu.value.trim().length < 3) return toast('Username too short.', 'err'); if (np.value.length < 8) return toast('Password must be at least 8 characters.', 'err'); if (np.value !== np2.value) return toast('Passwords do not match.', 'err'); await setCredentials(nu.value, np.value); np.value = np2.value = ''; toast('Saved. Press Publish so it works on your other devices too.', 'ok'); } }, 'Change login'),
        h('div', { class: 'note', style: { marginTop: '1rem', marginBottom: 0 } }, h('span', null, 'ℹ️'), h('span', null, 'This page is a static GitHub Pages site, so the login only locks the editing screen. What really protects your live site is the GitHub token — without it nobody can publish. Never share the token.'))),
      card('💾 Backup & restore', 'Download a copy of all your text and settings (pictures stay in the repository).',
        h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(S.content, null, 2)], { type: 'application/json' })), download: 'portfolio-backup-' + today() + '.json' }); a.click(); } }, '⬇ Download backup'),
          h('label', { class: 'btn' }, '⬆ Restore from backup', h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async e => { const fl = e.target.files[0]; if (!fl) return; try { const j = JSON.parse(await fl.text()); if (!j.site || !j.hero) throw new Error('This is not a portfolio backup.'); S.content = ensure(j); changed(); rerender(); toast('Backup loaded. Review it, then Publish.', 'ok'); } catch (er) { toast(er.message, 'err'); } } })),
          h('button', { class: 'btn danger', onclick: async () => { if (!confirm('Throw away all unpublished changes and reload what is live?')) return; ls.del('pf_draft'); await idb('readwrite', st => st.clear()); S.authDirty = false; location.reload(); } }, 'Discard unpublished changes'))),
      card('Account', null, h('button', { class: 'btn', onclick: signOut }, 'Sign out'))];
  };

  /* ================= PUBLISH ================= */
  const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  const strB64 = s => { const bytes = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };

  function publishFlow() {
    const cfg = { ...ghGuess(), branch: 'main', ...ghCfg() };
    if (!cfg.token || !cfg.owner || !cfg.repo) {
      modal({ title: 'Connect GitHub first', body: 'Add your GitHub username, repository and access token once under Settings, then press Publish again.', actions: [{ label: 'Later' }, { label: 'Open settings', primary: true, onClick: () => go('settings') }] }); return;
    }
    const logEl = h('div', { class: 'log' }), bar = h('i'), msg = h('p', null, 'Everything you changed will go live in about a minute.');
    const m = modal({
      title: 'Publish to ' + cfg.owner + '/' + cfg.repo, body: h('div', null, msg, h('div', { class: 'bar-p', hidden: true }, bar), logEl), dismiss: false,
      actions: [{ label: 'Cancel', id: 'pCancel' }, { label: 'Publish now', primary: true, keep: true, id: 'pGo', onClick: async () => {
        $('#pGo').disabled = true; $('#pCancel').disabled = true; bar.parentNode.hidden = false;
        try { const url = await doPublish(cfg, (t, p) => { logEl.textContent += t + '\n'; logEl.scrollTop = 1e9; if (p != null) bar.style.width = p + '%'; }); bar.style.width = '100%'; msg.innerHTML = '✅ Published! Your site updates in about a minute at <a style="color:var(--brand)" target="_blank" rel="noopener" href="' + url + '">' + url + '</a>'; $('#pGo').remove(); $('#pCancel').textContent = 'Close'; $('#pCancel').disabled = false; }
        catch (e) { msg.textContent = '❌ ' + e.message; logEl.textContent += '\nFailed: ' + e.message; $('#pCancel').textContent = 'Close'; $('#pCancel').disabled = false; $('#pGo').disabled = false; $('#pGo').textContent = 'Try again'; }
        return false;
      } }]
    });
  }

  async function doPublish(cfg, log) {
    const base = '/repos/' + cfg.owner + '/' + cfg.repo;
    log('Checking GitHub connection…', 4);
    let ref; try { ref = await gh(cfg, base + '/git/ref/heads/' + cfg.branch); } catch (e) { if (e.status === 409) throw new Error('The repository is empty. Upload the website files first (see README).'); throw e; }
    const parent = ref.object.sha; const pc = await gh(cfg, base + '/git/commits/' + parent); const baseTree = pc.tree.sha;

    const final = clone(S.content); const files = []; const idMap = new Map(); const stamp = today().replace(/-/g, '');
    walkStrings(final, v => {
      if (!v.startsWith('pending:')) return v; const id = v.slice(8), r = S.pending.get(id); if (!r) return '';
      if (!idMap.has(id)) idMap.set(id, (r.kind === 'video' ? 'videos/' : 'images/uploads/') + stamp + '-' + id.slice(0, 4) + '-' + r.name.replace(/[^a-z0-9._-]/gi, '-'));
      return idMap.get(id);
    });
    for (const [id, path] of idMap) files.push({ path, blob: S.pending.get(id).blob });
    log(files.length ? 'Uploading ' + files.length + ' new file(s)…' : 'No new pictures to upload.', 10);

    const entries = []; let done = 0;
    const queue = files.slice();
    await Promise.all([0, 1, 2].map(async () => { while (queue.length) { const f = queue.shift(); const blob = await gh(cfg, base + '/git/blobs', { method: 'POST', body: { content: await b64(f.blob), encoding: 'base64' } }); entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha }); done++; log('  ✓ ' + f.path, 10 + 55 * done / files.length); } }));

    log('Updating content…', 70);
    const text = async (p, o) => { const r = await fetch(p + (p.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' }); return r.ok ? r.text() : null; };
    const addText = async (path, s) => { const b = await gh(cfg, base + '/git/blobs', { method: 'POST', body: { content: strB64(s), encoding: 'base64' } }); entries.push({ path, mode: '100644', type: 'blob', sha: b.sha }); };
    await addText('content.json', JSON.stringify(final, null, 2) + '\n');
    let idx = await text('../index.html');
    if (idx && /<!--SITE_HEAD_START-->[\s\S]*<!--SITE_HEAD_END-->/.test(idx)) { idx = idx.replace(/<!--SITE_HEAD_START-->[\s\S]*<!--SITE_HEAD_END-->/, () => '<!--SITE_HEAD_START-->\n' + PF.headBlock(final) + '\n<!--SITE_HEAD_END-->'); await addText('index.html', idx); }
    else log('  (index.html markers not found — the site will still read content.json)');
    if (S.authDirty) { const a = overrideAuth(); if (a) await addText('admin/auth.json', JSON.stringify(a, null, 2) + '\n'); }

    log('Cleaning unused pictures…', 80);
    const used = new Set(); walkStrings(clone(final), v => { if (/^(images|videos)\//.test(v)) used.add(v); return v; });
    try {
      const tree = await gh(cfg, base + '/git/trees/' + baseTree + '?recursive=1');
      if (!tree.truncated) tree.tree.forEach(n => { if (n.type === 'blob' && /^(images|videos)\//.test(n.path) && !used.has(n.path) && !idMap.has(n.path)) { entries.push({ path: n.path, mode: '100644', type: 'blob', sha: null }); log('  ✗ removing unused ' + n.path); } });
    } catch (e) { log('  (skipped cleanup)'); }

    log('Saving to GitHub…', 88);
    const tree = await gh(cfg, base + '/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: entries } });
    const commit = await gh(cfg, base + '/git/commits', { method: 'POST', body: { message: 'Update portfolio (admin panel) — ' + new Date().toISOString().slice(0, 16).replace('T', ' '), tree: tree.sha, parents: [parent] } });
    await gh(cfg, base + '/git/refs/heads/' + cfg.branch, { method: 'PATCH', body: { sha: commit.sha } });

    S.content = final; S.liveJSON = JSON.stringify(final); S.authDirty = false; S.pending.forEach(r => URL.revokeObjectURL(r.url)); S.pending.clear(); await idb('readwrite', st => st.clear());
    ls.del('pf_draft'); S.stage = []; S.vstage = { thumb: '', title: '', brand: '', url: '' }; refreshStatus(); pushPreview(); rerender();
    log('Done.', 100); return pagesURL(cfg);
  }

  /* ================= preview pane ================= */
  let pvMode = 'desktop';
  function fitPreview() {
    const st = $('#pvStage'), f = $('#pvFrame'), W = st.clientWidth, H = st.clientHeight; if (!W) return;
    st.classList.toggle('mobile', pvMode === 'mobile');
    if (pvMode === 'desktop') { const k = Math.min(1, W / 1280); f.style.width = '1280px'; f.style.height = Math.round(H / k) + 'px'; f.style.transform = 'translateX(-50%) scale(' + k + ')'; }
    else { const k = Math.min(1, (W - 20) / 406, (H - 24) / 760); f.style.width = '390px'; f.style.height = Math.round((H - 24) / k) + 'px'; f.style.transform = 'translateX(-50%) scale(' + k + ')'; }
  }

  /* ================= start ================= */
  async function startApp(mustChange) {
    $('#app').hidden = false;
    let live; try { const r = await fetch('../content.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw 0; live = await r.json(); }
    catch (e) { modal({ title: 'Could not load content.json', body: 'Open the admin from your published website address (https://…github.io/…/admin/) — not by double-clicking the file.', dismiss: false }); return; }
    ensure(live); S.liveJSON = JSON.stringify(live); S.content = clone(live);
    const recs = (await idb('readonly', st => st.getAll())) || [];
    recs.forEach(r => S.pending.set(r.id, { ...r, url: URL.createObjectURL(r.blob) }));
    try {
      const d = JSON.parse(ls.get('pf_draft') || 'null');
      if (d && d.content) { S.content = ensure(d.content); S.authDirty = !!d.authDirty; if (JSON.stringify(S.content) !== S.liveJSON) setTimeout(() => toast('Your unpublished draft was restored.'), 600); }
    } catch (e) { /* ignore */ }
    buildSide(); renderPanel(); refreshStatus();
    window.addEventListener('message', e => { if (e.origin === location.origin && e.data && e.data.type === 'pf-ready') { S.previewReady = true; pushPreview(); fitPreview(); } });
    $('#pvFrame').src = '../index.html';
    new ResizeObserver(fitPreview).observe($('#pvStage')); fitPreview();
    $('#pvDesk').onclick = () => { pvMode = 'desktop'; fitPreview(); }; $('#pvMob').onclick = () => { pvMode = 'mobile'; fitPreview(); };
    $('#btnPreview').onclick = () => { $('#preview').classList.add('show'); setTimeout(fitPreview, 30); }; $('#pvClose').onclick = () => $('#preview').classList.remove('show');
    $('#btnPublish').onclick = publishFlow;
    if (mustChange) forceCredentials();
  }

  async function init() {
    if (sessionOK()) { const a = overrideAuth() || (await fileAuth()) || {}; await startApp(a.mustChange && !overrideAuth()); }
    else showLogin();
  }
  init();
})();
