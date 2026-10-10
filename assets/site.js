/* Portfolio engine — renders the whole site from content.json (or the copy embedded in index.html).
   You normally never edit this file: use /admin/ instead. */
(function (root) {
  'use strict';

  /* ---------- fonts available in the admin ---------- */
  var FONTS = {
    'Bricolage Grotesque': { spec: 'Bricolage+Grotesque:opsz,wght@12..96,400..800', kind: 'sans-serif' },
    'Inter': { spec: 'Inter:wght@400;500;600', kind: 'sans-serif' },
    'Space Mono': { spec: 'Space+Mono:wght@400;700', kind: 'monospace' },
    'Poppins': { spec: 'Poppins:wght@400;500;600;700;800', kind: 'sans-serif' },
    'Montserrat': { spec: 'Montserrat:wght@400;500;600;700;800', kind: 'sans-serif' },
    'Playfair Display': { spec: 'Playfair+Display:wght@400;600;700;800', kind: 'serif' },
    'Space Grotesk': { spec: 'Space+Grotesk:wght@400;500;600;700', kind: 'sans-serif' },
    'Syne': { spec: 'Syne:wght@400;600;700;800', kind: 'sans-serif' },
    'DM Serif Display': { spec: 'DM+Serif+Display', kind: 'serif' },
    'Oswald': { spec: 'Oswald:wght@400;500;600;700', kind: 'sans-serif' },
    'Anton': { spec: 'Anton', kind: 'sans-serif' },
    'Archivo Black': { spec: 'Archivo+Black', kind: 'sans-serif' },
    'Outfit': { spec: 'Outfit:wght@400;500;600;700;800', kind: 'sans-serif' },
    'Unbounded': { spec: 'Unbounded:wght@400;600;700;800', kind: 'sans-serif' },
    'DM Sans': { spec: 'DM+Sans:wght@400;500;600', kind: 'sans-serif' },
    'Manrope': { spec: 'Manrope:wght@400;500;600', kind: 'sans-serif' },
    'Nunito': { spec: 'Nunito:wght@400;500;600', kind: 'sans-serif' },
    'Work Sans': { spec: 'Work+Sans:wght@400;500;600', kind: 'sans-serif' },
    'Lora': { spec: 'Lora:wght@400;500;600', kind: 'serif' },
    'JetBrains Mono': { spec: 'JetBrains+Mono:wght@400;700', kind: 'monospace' },
    'IBM Plex Mono': { spec: 'IBM+Plex+Mono:wght@400;600', kind: 'monospace' },
    'DM Mono': { spec: 'DM+Mono:wght@400;500', kind: 'monospace' },
    'Roboto Mono': { spec: 'Roboto+Mono:wght@400;700', kind: 'monospace' }
  };
  var FONT_GROUPS = {
    display: ['Bricolage Grotesque', 'Poppins', 'Montserrat', 'Playfair Display', 'Space Grotesk', 'Syne', 'DM Serif Display', 'Oswald', 'Anton', 'Archivo Black', 'Outfit', 'Unbounded'],
    body: ['Inter', 'DM Sans', 'Manrope', 'Nunito', 'Work Sans', 'Poppins', 'Lora'],
    mono: ['Space Mono', 'JetBrains Mono', 'IBM Plex Mono', 'DM Mono', 'Roboto Mono']
  };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hexToRgbArr(h) {
    h = String(h || '#000000').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (x) { return x + x; }).join('');
    var n = parseInt(h, 16);
    if (isNaN(n)) n = 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbStr(h) { return hexToRgbArr(h).join(','); }
  function mixHex(a, b, p) {
    var A = hexToRgbArr(a), B = hexToRgbArr(b);
    var out = A.map(function (v, i) { return Math.round(v + (B[i] - v) * p); });
    return '#' + out.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }
  function fontStack(name) {
    var f = FONTS[name];
    return "'" + name + "'," + (f ? f.kind : 'sans-serif');
  }
  function fontsHref(t) {
    var names = [];
    [t.fontDisplay, t.fontBody, t.fontMono].forEach(function (n) { if (FONTS[n] && names.indexOf(n) < 0) names.push(n); });
    if (!names.length) return '';
    return 'https://fonts.googleapis.com/css2?' + names.map(function (n) { return 'family=' + FONTS[n].spec; }).join('&') + '&display=swap';
  }
  var SHAPES = { square: '1/1', portrait: '4/5', landscape: '4/3', auto: 'auto' };
  function themeCSS(c) {
    var t = c.theme || {};
    var ink = t.ink || '#060C14', paper = t.paper || '#EEF4FF', accent = t.accent || '#00C8E0', fire = t.fire || '#2979FF';
    var bright = (t.heroBrightness == null ? 20 : t.heroBrightness) / 100;
    var shape = (c.work && c.work.shape) || 'square';
    var vshape = (c.video && c.video.shape) || '9/16';
    return ':root{' +
      '--ink:' + ink + ';--paper:' + paper + ';--accent:' + accent + ';--fire:' + fire + ';' +
      '--ink-rgb:' + rgbStr(ink) + ';--paper-rgb:' + rgbStr(paper) + ';--accent-rgb:' + rgbStr(accent) + ';--fire-rgb:' + rgbStr(fire) + ';' +
      '--surface:' + mixHex(ink, fire, 0.06) + ';--surface2:' + mixHex(ink, fire, 0.14) + ';' +
      '--deep:' + mixHex(ink, '#000000', 0.35) + ';--deeper:' + mixHex(ink, '#000000', 0.5) + ';' +
      "--td:" + fontStack(t.fontDisplay || 'Bricolage Grotesque') + ';--tb:' + fontStack(t.fontBody || 'Inter') + ';--tm:' + fontStack(t.fontMono || 'Space Mono') + ';' +
      '--ease:cubic-bezier(.25,.46,.45,.94);--r:' + (t.radius == null ? 2 : t.radius) + 'px;' +
      '--hero-bright:' + bright + ';--tile-ratio:' + (SHAPES[shape] || '1/1') + ';--vid-ratio:' + vshape + ';}';
  }
  function faviconHref(site) {
    if (site.faviconImage) return site.faviconImage;
    var emoji = site.favicon || '🎨';
    return "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>" + emoji + "</text></svg>");
  }
  /* The block between SITE_HEAD_START/END in index.html (rewritten by the admin on every publish) */
  function headBlock(c) {
    var s = c.site || {};
    var fh = fontsHref(c.theme || {});
    return '<title>' + esc(s.title) + '</title>\n' +
      '<meta name="description" content="' + esc(s.description) + '">\n' +
      '<meta property="og:title" content="' + esc(s.title) + '">\n' +
      '<meta property="og:description" content="' + esc(s.description) + '">\n' +
      '<meta property="og:type" content="website">\n' +
      '<meta name="theme-color" content="' + esc((c.theme || {}).ink || '#060C14') + '">\n' +
      '<link rel="icon" id="pf-icon" href="' + esc(faviconHref(s)) + '">\n' +
      (fh ? '<link id="pf-fonts" href="' + esc(fh) + '" rel="stylesheet">\n' : '<link id="pf-fonts" rel="stylesheet">\n') +
      '<style id="pf-theme">' + themeCSS(c) + '</style>\n' +
      '<script id="pf-data" type="application/json">' + JSON.stringify(c).replace(/</g, '\\u003c') + '</script>';
  }

  function linkHref(type, v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (type === 'phone') return 'tel:' + v.replace(/[^\d+]/g, '');
    if (type === 'email') return 'mailto:' + v;
    if (type === 'whatsapp') return 'https://wa.me/' + v.replace(/\D/g, '');
    if (type === 'link') return /^(https?:|mailto:|tel:|#|\/)/i.test(v) ? v : 'https://' + v;
    return '';
  }
  function fmtDate(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
    if (!m) return d || '';
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1];
    return (+m[3]) + ' ' + mon + ' ' + m[1];
  }
  function isExternal(h) { return /^https?:/i.test(h); }

  /* ---------- section renderers ---------- */
  function R(c) {
    var catName = {};
    ((c.work && c.work.categories) || []).forEach(function (k) { catName[k.id] = k.name; });

    var out = {};

    out.hero = function (s) {
      var h = c.hero || {};
      var btns = (h.buttons || []).filter(function (b) { return b.label; }).map(function (b) {
        var href = linkHref(b.type, b.value) || '#';
        return '<a href="' + esc(href) + '"' + (isExternal(href) ? ' target="_blank" rel="noopener"' : '') + ' class="btn ' + (b.style === 'ghost' ? 'btn--ghost' : 'btn--solid') + '">' + esc(b.label) + '</a>';
      }).join('');
      var sw = h.showSwatches && (h.swatches || []).length ? '<div class="swatches reveal">' + h.swatches.map(function (x) {
        return '<div class="swatch" style="--c:' + esc(x) + '"><span></span>' + esc(String(x).replace('#', '')) + '</div>';
      }).join('') + '</div>' : '';
      return '<section class="hero" id="top">' +
        (h.image ? '<div class="hero__bg" style="background-image:url(\'' + esc(h.image) + '\')"></div>' : '') +
        '<div class="hero__inner">' +
        (h.eyebrow ? '<p class="eyebrow reveal">' + esc(h.eyebrow) + '</p>' : '') +
        '<h1 class="hero__name reveal">' + esc(h.name) + '</h1>' +
        (h.role ? '<p class="hero__role reveal">' + esc(h.role) + '</p>' : '') +
        (h.sub ? '<p class="hero__sub reveal">' + esc(h.sub) + '</p>' : '') +
        (btns ? '<div class="hero__cta reveal">' + btns + '</div>' : '') + sw +
        '</div><div class="hero__scroll">scroll</div></section>';
    };

    out.about = function (s) {
      var a = c.about || {}, p = c.profile || {};
      var meta = (a.meta || []).map(function (m) {
        var v = m.auto === 'currentCompany' ? p.currentCompany : m.value;
        if (!v && !m.label) return '';
        return '<li><span>' + esc(m.label) + '</span>' + esc(v) + '</li>';
      }).join('');
      return '<section class="about" id="about"><div class="about__frame reveal">' +
        (a.photo ? '<img src="' + esc(a.photo) + '" alt="' + esc((c.hero || {}).name) + '">' : '<div class="monogram">' + esc(a.monogram) + '</div>') +
        '</div><div class="about__copy">' +
        (a.label ? '<p class="label reveal">' + esc(a.label) + '</p>' : '') +
        (a.lead ? '<p class="about__lead reveal">' + esc(a.lead) + '</p>' : '') +
        (a.body ? '<p class="about__body reveal">' + esc(a.body) + '</p>' : '') +
        (meta ? '<ul class="meta reveal">' + meta + '</ul>' : '') + '</div></section>';
    };

    function chipSection(id, data, alt) {
      data = data || {};
      return '<section class="section-inner" id="' + id + '">' +
        (data.label ? '<p class="label reveal">' + esc(data.label) + '</p>' : '') +
        '<div class="two-col">' + (data.groups || []).map(function (g) {
          return '<div class="col-group reveal"><span class="col-label">' + esc(g.label) + '</span><div class="chips">' +
            (g.chips || []).map(function (x) { return '<span class="chip' + (alt ? ' chip--alt' : '') + '">' + esc(x) + '</span>'; }).join('') +
            '</div></div>';
        }).join('') + '</div></section>';
    }
    out.tools = function () { return chipSection('tools', c.tools, false); };
    out.skills = function () { return chipSection('skills', c.skills, true); };

    out.experience = function () {
      var e = c.experience || {};
      return '<section class="section-inner" id="experience">' +
        (e.label ? '<p class="label reveal">' + esc(e.label) + '</p>' : '') +
        (e.items || []).map(function (x) {
          return '<div class="exp-card reveal"><div class="exp-dates">' + esc(x.dates) + '</div><div><h3>' + esc(x.title) +
            (x.current ? '<span class="now-badge">Now</span>' : '') + '</h3>' +
            (x.company ? '<p class="exp-co">' + esc(x.company) + '</p>' : '') +
            (x.text ? '<p>' + esc(x.text) + '</p>' : '') + '</div></div>';
        }).join('') + '</section>';
    };

    out.work = function () {
      var w = c.work || {};
      var items = w.items || [];
      var used = {};
      items.forEach(function (i) { used[i.cat] = 1; });
      var cats = (w.categories || []).filter(function (k) { return used[k.id]; });
      var filters = cats.length > 1 ? '<div class="filters reveal"><button class="filter is-active" data-filter="all">' + esc(w.allLabel || 'All') + '</button>' +
        cats.map(function (k) { return '<button class="filter" data-filter="' + esc(k.id) + '">' + esc(k.name) + '</button>'; }).join('') + '</div>' : '';
      return '<section class="work" id="work">' +
        (w.label ? '<p class="label reveal">' + esc(w.label) + '</p>' : '') +
        (w.title ? '<h2 class="section-title reveal">' + esc(w.title) + '</h2>' : '') + filters +
        '<div class="gallery" data-shape="' + esc(w.shape || 'square') + '">' +
        (items.length ? items.map(function (i) {
          return '<figure class="g-item" data-cat="' + esc(i.cat) + '"><img loading="lazy" src="' + esc(i.img) + '" alt="' + esc(i.title) + '">' +
            '<figcaption><span>' + esc(catName[i.cat] || '') + '</span>' + esc(i.title) +
            (w.showDates && i.date ? '<small>' + esc(fmtDate(i.date)) + '</small>' : '') + '</figcaption></figure>';
        }).join('') : '<p class="empty-note">No work added yet.</p>') + '</div>' +
        (w.note ? '<p class="work-note reveal">' + esc(w.note) + '</p>' : '') + '</section>';
    };

    out.video = function () {
      var v = c.video || {};
      return '<section class="vid-section" id="video">' +
        (v.label ? '<p class="label reveal">' + esc(v.label) + '</p>' : '') +
        (v.title ? '<h2 class="section-title reveal">' + esc(v.title) + '</h2>' : '') +
        '<div class="vid-row" data-shape="' + esc(v.shape || '9/16') + '">' +
        (v.items || []).map(function (i, idx) {
          return '<figure class="v-item"><div class="v-thumb" data-vid="' + idx + '" style="background-image:url(\'' + esc(i.thumb) + '\')">' +
            '<div class="v-play">&#9654;</div>' +
            '<div class="v-label-top"><span class="v-brand">' + esc(i.brand) + '</span>' + esc(i.title) + '</div>' +
            (i.note ? '<div class="v-note">' + esc(i.note) + '</div>' : '<div></div>') + '</div></figure>';
        }).join('') + '</div></section>';
    };

    out.contact = function () {
      var k = c.contact || {};
      var rows = (k.rows || []).filter(function (r) { return r.label || r.value; }).map(function (r) {
        var href = linkHref(r.type, r.value);
        var shown = r.type === 'link' ? String(r.value).replace(/^https?:\/\//i, '').replace(/\/$/, '') : r.value;
        return '<div class="card-row"><span class="card-k">' + esc(r.label) + '</span>' +
          (href ? '<a class="card-v" href="' + esc(href) + '"' + (isExternal(href) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(shown) + '</a>' : '<span class="card-v">' + esc(r.value) + '</span>') + '</div>';
      }).join('');
      var btns = (k.buttons || []).filter(function (b) { return b.label; }).map(function (b) {
        var href = linkHref(b.type, b.value) || '#';
        return '<a href="' + esc(href) + '"' + (isExternal(href) ? ' target="_blank" rel="noopener"' : '') + ' class="btn ' + (b.style === 'ghost' ? 'btn--ghost btn--ghost-light' : 'btn--solid') + '">' + esc(b.label) + '</a>';
      }).join('');
      return '<section class="contact" id="contact">' +
        (k.label ? '<p class="label label--light reveal">' + esc(k.label) + '</p>' : '') +
        (k.title ? '<h2 class="section-title reveal">' + esc(k.title) + '</h2>' : '') +
        (rows ? '<div class="card reveal">' + rows + '</div>' : '') +
        (btns ? '<div class="hero__cta reveal">' + btns + '</div>' : '') + '</section>';
    };
    return out;
  }

  function appHTML(c) {
    var s = c.site || {};
    var secs = (c.sections || []).filter(function (x) { return x.visible !== false; });
    var r = R(c);
    var links = secs.filter(function (x) { return x.id !== 'hero' && x.nav; }).map(function (x) {
      return '<a href="#' + x.id + '">' + esc(x.nav) + '</a>';
    }).join('');
    var callHref = linkHref('phone', s.navPhone);
    var nav = '<header class="nav"><a href="#top" class="nav__mark">' + esc(s.logoMark) + '</a><nav class="nav__links">' + links + '</nav>' +
      (s.navPhoneShow !== false && s.navPhone ? '<a href="' + esc(callHref) + '" class="nav__call">' + esc(s.navPhone) + '</a>' : '<span></span>') + '</header>';
    var body = secs.map(function (x) { return r[x.id] ? r[x.id](x) : ''; }).join('\n');
    var f = c.footer || {};
    var footer = '<footer class="footer"><span>' + esc(f.left) + '</span><span>' + esc(f.right) + '</span></footer>';
    return nav + body + footer;
  }

  /* ---------- exports for Node (used when building) and admin ---------- */
  var API = { FONTS: FONTS, FONT_GROUPS: FONT_GROUPS, SHAPES: SHAPES, esc: esc, themeCSS: themeCSS, fontsHref: fontsHref, headBlock: headBlock, appHTML: appHTML, faviconHref: faviconHref, linkHref: linkHref, mixHex: mixHex };
  root.PF = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof document === 'undefined' || !document.getElementById('lightbox')) return;

  /* ---------- browser runtime ---------- */
  var current = null, io = null;
  var inPreview = false;
  try { inPreview = window.parent !== window; } catch (e) { inPreview = true; }
  if (inPreview) document.documentElement.classList.add('pf-preview');

  function applyHead(c) {
    var s = c.site || {};
    document.title = s.title || '';
    var m = document.querySelector('meta[name="description"]'); if (m) m.setAttribute('content', s.description || '');
    var ic = document.getElementById('pf-icon'); if (ic) ic.setAttribute('href', faviconHref(s));
    var fl = document.getElementById('pf-fonts'); var fh = fontsHref(c.theme || {});
    if (fl && fh && fl.getAttribute('href') !== fh) fl.setAttribute('href', fh);
    var st = document.getElementById('pf-theme'); if (st) st.textContent = themeCSS(c);
    var tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.setAttribute('content', (c.theme || {}).ink || '#060C14');
    document.documentElement.classList.toggle('no-grain', (c.theme || {}).grain === false);
  }

  function observe() {
    if (io) io.disconnect();
    var els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('visible'); }); return; }
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e, i) {
        if (e.isIntersecting) { setTimeout(function () { e.target.classList.add('visible'); }, i * 55); io.unobserve(e.target); }
      });
    }, { threshold: 0.08 });
    els.forEach(function (el) { io.observe(el); });
  }

  function render(c, keepScroll) {
    current = c;
    applyHead(c);
    var app = document.getElementById('app');
    var y = window.scrollY;
    app.innerHTML = appHTML(c);
    observe();
    var bg = document.querySelector('.hero__bg');
    if (bg) requestAnimationFrame(function () { bg.classList.add('loaded'); });
    if (keepScroll) window.scrollTo(0, y);
    onScroll();
  }

  /* lightbox */
  var lb, lbBody;
  function visibleTiles() { return Array.prototype.slice.call(document.querySelectorAll('.g-item:not(.hidden)')); }
  var lbIndex = -1;
  function openLb(html) { lbBody.innerHTML = html; lb.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeLb() { lb.classList.remove('open'); document.body.style.overflow = ''; setTimeout(function () { if (!lb.classList.contains('open')) lbBody.innerHTML = ''; }, 300); lbIndex = -1; }
  function showImg(i) {
    var tiles = visibleTiles(); if (!tiles.length) return;
    lbIndex = (i + tiles.length) % tiles.length;
    var img = tiles[lbIndex].querySelector('img');
    openLb('<img src="' + esc(img.getAttribute('src')) + '" alt="' + esc(img.alt) + '">');
  }
  function videoEmbed(url) {
    url = String(url || '').trim(); if (!url) return null;
    var m;
    if ((m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{6,})/))) {
      var tall = /shorts\//.test(url);
      return '<iframe class="' + (tall ? 'tall' : '') + '" src="https://www.youtube.com/embed/' + m[1] + '?autoplay=1&rel=0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
    }
    if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/))) return '<iframe src="https://player.vimeo.com/video/' + m[1] + '?autoplay=1" allow="autoplay; fullscreen" allowfullscreen></iframe>';
    if ((m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/))) return '<iframe src="https://drive.google.com/file/d/' + m[1] + '/preview" allow="autoplay; fullscreen" allowfullscreen></iframe>';
    if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) || /^videos\//.test(url)) return '<video src="' + esc(url) + '" controls autoplay playsinline></video>';
    return null;
  }

  function onScroll() {
    var cur = '';
    document.querySelectorAll('section[id]').forEach(function (s) { if (window.scrollY >= s.offsetTop - 130) cur = s.id; });
    document.querySelectorAll('.nav__links a').forEach(function (a) { a.style.opacity = a.getAttribute('href') === '#' + cur ? '1' : ''; });
  }

  function boot() {
    lb = document.getElementById('lightbox'); lbBody = document.getElementById('lbBody');
    document.addEventListener('click', function (e) {
      var t = e.target;
      var f = t.closest && t.closest('.filter');
      if (f) {
        document.querySelectorAll('.filter').forEach(function (b) { b.classList.remove('is-active'); });
        f.classList.add('is-active');
        var cat = f.dataset.filter;
        document.querySelectorAll('.g-item').forEach(function (it) { it.classList.toggle('hidden', cat !== 'all' && it.dataset.cat !== cat); });
        return;
      }
      var g = t.closest && t.closest('.g-item');
      if (g) { showImg(visibleTiles().indexOf(g)); return; }
      var v = t.closest && t.closest('.v-thumb');
      if (v && current) {
        var item = ((current.video || {}).items || [])[+v.dataset.vid];
        if (!item || !item.url) return;
        var emb = videoEmbed(item.url);
        if (emb) openLb(emb); else window.open(linkHref('link', item.url), '_blank', 'noopener');
        return;
      }
      if (t.id === 'lbClose' || t === lb) closeLb();
      if (inPreview && t.closest && t.closest('a[href]')) { var a = t.closest('a[href]'); if (!/^#/.test(a.getAttribute('href'))) e.preventDefault(); }
    });
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') closeLb();
      if (lbIndex >= 0 && e.key === 'ArrowRight') showImg(lbIndex + 1);
      if (lbIndex >= 0 && e.key === 'ArrowLeft') showImg(lbIndex - 1);
    });
    window.addEventListener('scroll', onScroll, { passive: true });

    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data) return;
      if (e.data.type === 'pf-content') render(e.data.content, true);
      if (e.data.type === 'pf-scroll') {
        var el = document.getElementById(e.data.id === 'hero' ? 'top' : e.data.id);
        if (el) window.scrollTo({ top: el.offsetTop - 60, behavior: 'smooth' });
      }
    });

    var inline = document.getElementById('pf-data');
    var start = null;
    try { start = inline && JSON.parse(inline.textContent); } catch (err) { start = null; }
    if (start && start.site) { render(start); }
    else {
      fetch('content.json?t=' + Math.floor(Date.now() / 60000)).then(function (r) { return r.json(); }).then(render)
        .catch(function () { document.getElementById('app').innerHTML = '<p style="padding:6rem 2rem;font-family:sans-serif">Could not load the portfolio content.</p>'; });
    }
    if (inPreview) parent.postMessage({ type: 'pf-ready' }, location.origin);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
