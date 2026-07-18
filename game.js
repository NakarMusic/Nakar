'use strict';
/* Nakar — oyun mantığı. Kurallar: GAME-LOGIC.md */
(function () {

  /* ═══════════ sabitler ═══════════ */
  var UNLOCKS = [1, 2, 4, 7, 11, 16];
  var MAX_GUESSES = 6;
  var FULL_SEC = 30;
  var PERIOD_MS = 12 * 3600 * 1000;
  var TR_OFFSET_MS = 3 * 3600 * 1000;     // Türkiye UTC+3, DST yok
  var REPEAT_WINDOW = 180;                // ~90 gün × 2 period
  var ANCHOR_PERIOD = 41000;              // tekrar koruması hesabının sabit başlangıcı (2026 öncesi)
  var LAUNCH_PERIOD = 41301;              // lansman günü periyodu (2026-07-16) → paylaşımdaki #N, launch günü #1 verir
  var RUSH_MS = 60000;
  var COUNTER_API = 'https://nakar-counter.bekirerenkeskin.workers.dev';
  var SOLVE_COUNT_POLL_MS = 25000;
  // Sabit bir domain yerine gerçek barındırma adresinden türetilir — GitHub Pages
  // (kullanici.github.io/nakar/) veya ileride bağlanacak özel bir domain, kod
  // değişikliği gerekmeden doğru şekilde yansır.
  var DOMAIN = location.host + location.pathname.replace(/index\.html$/, '');
  var JSONP_TIMEOUT = 8000;

  var LS = {
    stats: 'nakar-stats-v1',
    daily: 'nakar-daily-v1',
    prefs: 'nakar-prefs-v1',
    favs: 'nakar-favs-v1',
    ach: 'nakar-ach-v1',
    seen: 'nakar-seen',
    spotlightSeen: 'nakar-spotlight-seen',
    spotlight2Seen: 'nakar-spotlight2-seen'
  };

  var CAT_ICONS = {
    'gunun': 'sparkle', 'y1980': 'cassette-tape', 'y1990': 'radio', 'y2000': 'disc',
    'y2010': 'headphones', 'y2020': 'waveform', 'turk-pop': 'microphone-stage',
    'anadolu-rock': 'guitar', 'arabesk': 'heart-break', 'turkuler': 'mountains',
    'turkce-rap': 'vinyl-record', 'alternatif-indie': 'sunglasses', 'dizi-muzikleri': 'television-simple',
    'turkiye-top-100': 'crown-simple', 'yeni-cikanlar': 'star-four'
  };

  var CAT_BLURBS = {
    'turk-pop': "Ajda'dan Mabel Matiz'e",
    'anadolu-rock': "Barış Manço'dan Pinhani'ye",
    'arabesk': "Tatlıses'ten Müslüm'e",
    'turkuler': "Neşet Ertaş'tan Volkan Konak'a",
    'turkce-rap': "Ceza'dan Ezhel'e",
    'alternatif-indie': "Emir Can İğrek'ten Kalben'e",
    'turkiye-top-100': 'Yılın en çok dinlenen 118 sanatçının 286 şarkısı.',
    'yeni-cikanlar': "Sadece 2026'nın en yeni çıkışları."
  };

  var ACHIEVEMENTS = [
    { id: 'first-win', name: 'İlk Zafer', desc: 'İlk turunu kazan' },
    { id: 'golden-ear', name: 'Altın Kulak', desc: '1. denemede bil' },
    { id: 'sharp-ear', name: 'Keskin Kulak', desc: '2. denemede bil' },
    { id: 'streak-7', name: "7'li Seri", desc: 'Günlükte 7 seri yap' },
    { id: 'no-skip', name: 'Atlamadan', desc: 'Hiç atlamadan kazan' },
    { id: 'unlimited-25', name: 'Maratoncu', desc: 'Sınırsızda 25 doğru bil' },
    { id: 'all-cats', name: 'Kaşif', desc: 'Her kategoride en az 1 tur oyna' },
    { id: 'night-owl', name: 'Gece Kuşu', desc: 'Gece yarısından sonra kazan' },
    { id: 'collector', name: 'Koleksiyoncu', desc: '5 kategoriyi favorile' },
    { id: 'rush-10', name: 'Hız Ustası', desc: 'Yarışta 60 saniyede 10 şarkı' }
  ];

  /* ═══════════ küçük yardımcılar ═══════════ */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', cls || 'ic');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }
  function show(node, on) { node.classList.toggle('hidden', !on); }
  function fmt(s) { return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

  /* Türkçe normalizasyon — İ/I dahil açık eşleme, naif toLowerCase kullanılmaz */
  var TR_MAP = {
    'İ': 'i', 'I': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ğ': 'g', 'ğ': 'g',
    'Ü': 'u', 'ü': 'u', 'Ö': 'o', 'ö': 'o', 'Ç': 'c', 'ç': 'c',
    'Â': 'a', 'â': 'a', 'Î': 'i', 'î': 'i', 'Û': 'u', 'û': 'u'
  };
  function norm(str) {
    var out = '';
    str = String(str || '');
    for (var i = 0; i < str.length; i++) {
      var ch = TR_MAP[str[i]];
      out += ch !== undefined ? ch : str[i].toLowerCase();
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  /* FNV-1a (32 bit) */
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function curPeriod() { return Math.floor((Date.now() + TR_OFFSET_MS) / PERIOD_MS); }
  function nextPeriodStartMs() { return (curPeriod() + 1) * PERIOD_MS - TR_OFFSET_MS; }

  function safeHttpsUrl(u, hostSuffix) {
    try {
      var url = new URL(String(u));
      if (url.protocol !== 'https:') return null;
      var h = url.hostname;
      if (h === hostSuffix || h.endsWith('.' + hostSuffix)) return url.href;
      return null;
    } catch (e) { return null; }
  }

  /* ═══════════ savunmacı localStorage ═══════════ */
  function loadLS(key, validate, fallback) {
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { }
    if (raw === null) return fallback;
    try {
      var obj = JSON.parse(raw);
      var ok = validate(obj);
      if (ok !== undefined && ok !== null) return ok;
    } catch (e) { }
    console.warn('Nakar: "' + key + '" verisi geçersiz — sıfırlandı.');
    try { localStorage.removeItem(key); } catch (e) { }
    return fallback;
  }
  function saveLS(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { }
  }

  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function intIn(v, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi; }

  function validStats(o) {
    if (!isObj(o) || o.v !== 1 || !isObj(o.data)) return null;
    var out = { v: 1, data: {} };
    for (var k in o.data) {
      if (!/^[a-z0-9-]+:(daily|unlimited|rush)$/.test(k)) continue;
      var s = o.data[k];
      if (!isObj(s)) continue;
      var c = {
        played: intIn(s.played, 0, 1e6) ? s.played : 0,
        wins: intIn(s.wins, 0, 1e6) ? s.wins : 0,
        streak: intIn(s.streak, 0, 1e6) ? s.streak : 0,
        maxStreak: intIn(s.maxStreak, 0, 1e6) ? s.maxStreak : 0,
        dist: [0, 0, 0, 0, 0, 0],
        best: intIn(s.best, 0, 1e4) ? s.best : 0,
        lastPeriod: intIn(s.lastPeriod, 0, 1e8) ? s.lastPeriod : 0,
        lastWin: s.lastWin === true
      };
      if (Array.isArray(s.dist) && s.dist.length === 6) {
        for (var i = 0; i < 6; i++) c.dist[i] = intIn(s.dist[i], 0, 1e6) ? s.dist[i] : 0;
      }
      out.data[k] = c;
    }
    return out;
  }

  function validDaily(o) {
    if (!isObj(o) || o.v !== 1 || !isObj(o.data)) return null;
    var out = { v: 1, data: {} };
    var cur = curPeriod();
    for (var k in o.data) {
      var m = /^(\d+):([a-z0-9-]+)$/.exec(k);
      if (!m || Number(m[1]) !== cur) continue;   // eski periyotları at
      var s = o.data[k];
      if (!isObj(s)) continue;
      if (s.done !== null && s.done !== 'win' && s.done !== 'lose') continue;
      if (!Array.isArray(s.g) || s.g.length > MAX_GUESSES) continue;
      var g = [], ok = true;
      for (var i = 0; i < s.g.length; i++) {
        var e = s.g[i];
        if (!isObj(e) || ['skip', 'wrong', 'close'].indexOf(e.s) < 0 || typeof e.t !== 'string' || e.t.length > 300) { ok = false; break; }
        g.push({ s: e.s, t: e.t });
      }
      if (!ok) continue;
      out.data[k] = { g: g, done: s.done };
    }
    return out;
  }

  function validPrefs(o) {
    if (!isObj(o) || o.v !== 1) return null;
    return { v: 1, autoplay: o.autoplay === true, reduceMotion: o.reduceMotion === true, dimmer: o.dimmer === true };
  }

  function validFavs(o) {
    if (!isObj(o) || o.v !== 1 || !Array.isArray(o.ids)) return null;
    var ids = [];
    for (var i = 0; i < o.ids.length && i < 50; i++) {
      if (typeof o.ids[i] === 'string' && /^[a-z0-9-]{1,40}$/.test(o.ids[i])) ids.push(o.ids[i]);
    }
    return { v: 1, ids: ids };
  }

  function validAch(o) {
    if (!isObj(o) || o.v !== 1 || !isObj(o.unlocked)) return null;
    var out = { v: 1, unlocked: {} };
    for (var i = 0; i < ACHIEVEMENTS.length; i++) {
      var id = ACHIEVEMENTS[i].id;
      if (o.unlocked[id] === true) out.unlocked[id] = true;
    }
    return out;
  }

  /* ═══════════ durum ═══════════ */
  var state = {
    cats: [],            // categories.json
    songs: {},           // catId → sarkilar[]
    catId: 'gunun',
    mode: 'daily',       // seçicideki mod
    roundType: 'daily',  // daily | unlimited | rush | archive | meydan
    archivePeriod: null,
    targetIdx: 0,
    guesses: [],
    done: null,          // null | 'win' | 'lose' | 'rush'
    hintOn: false,
    selected: null,      // autocomplete'ten seçilen şarkı indexi
    sugItems: [],
    sugActive: -1,
    preview: null,       // taze Deezer preview URL'i (asla saklanmaz)
    cover: null,
    loadingTrack: false,
    playing: false,
    reachedCap: false,   // önizleme, kilidi açık süreye doğal olarak ulaşıp kendi kendine durdu mu (kullanıcı elle duraklatmadı)
    rushScore: 0,
    rushEnd: 0,
    badge: '',
    roundToken: 0,
    volume: 50,
    stats: loadLS(LS.stats, validStats, { v: 1, data: {} }),
    dailyState: loadLS(LS.daily, validDaily, { v: 1, data: {} }),
    prefs: loadLS(LS.prefs, validPrefs, { v: 1, autoplay: false, reduceMotion: false, dimmer: false }),
    favs: loadLS(LS.favs, validFavs, { v: 1, ids: [] }),
    ach: loadLS(LS.ach, validAch, { v: 1, unlocked: {} })
  };

  var audio = $('audio');
  var rafId = 0;
  var toastTimer = 0;
  var spotlightTimer = 0;
  var spotlight2Timer = 0;
  var spotlight1Active = false;

  function pool() { return state.songs[state.catId] || []; }
  function target() { var p = pool(); return p[state.targetIdx % p.length]; }
  function songLabel(s) { return s.sanatci + ' — ' + s.baslik; }
  function statKey(cat, mode) { return cat + ':' + mode; }
  function statFor(cat, mode) {
    return state.stats.data[statKey(cat, mode)] ||
      { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], best: 0, lastPeriod: 0, lastWin: false };
  }
  function unlockedSec() {
    if (state.done) return FULL_SEC;
    return UNLOCKS[Math.min(state.guesses.length, UNLOCKS.length - 1)];
  }
  function dailyKey() { return curPeriod() + ':' + state.catId; }

  /* ═══════════ veri yükleme ═══════════ */
  function fetchJSON(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function validSong(s) {
    return isObj(s) && intIn(s.deezerId, 1, 1e12) &&
      typeof s.baslik === 'string' && s.baslik.length > 0 && s.baslik.length < 200 &&
      typeof s.sanatci === 'string' && s.sanatci.length > 0 && s.sanatci.length < 200 &&
      (s.yil === undefined || intIn(s.yil, 1900, 2100));
  }

  function loadCategories() {
    return fetchJSON('data/categories.json').then(function (arr) {
      if (!Array.isArray(arr)) throw new Error('kategori listesi bozuk');
      state.cats = arr.filter(function (c) {
        return isObj(c) && typeof c.id === 'string' && /^[a-z0-9-]{1,40}$/.test(c.id) &&
          typeof c.ad === 'string' && c.ad.length < 100;
      });
    });
  }

  var songPromises = {};
  function loadSongs(catId) {
    if (state.songs[catId]) return Promise.resolve(state.songs[catId]);
    if (songPromises[catId]) return songPromises[catId];
    if (!state.cats.some(function (c) { return c.id === catId; })) return Promise.reject(new Error('bilinmeyen kategori'));
    songPromises[catId] = fetchJSON('data/' + catId + '.json').then(function (obj) {
      if (!isObj(obj) || !Array.isArray(obj.sarkilar)) throw new Error('şarkı dosyası bozuk');
      var list = obj.sarkilar.filter(validSong);
      if (!list.length) throw new Error('şarkı listesi boş');
      state.songs[catId] = list;
      return list;
    });
    songPromises[catId].catch(function () { delete songPromises[catId]; });
    return songPromises[catId];
  }

  /* ═══════════ deterministik günlük seçim + tekrar koruması ═══════════ */
  var pickMemo = {}; // catId → { period → idx }
  function pickForPeriod(catId, period) {
    var songs = state.songs[catId];
    var n = songs.length;
    var memo = pickMemo[catId] || (pickMemo[catId] = {});
    if (memo[period] !== undefined) return memo[period];
    var W = Math.min(REPEAT_WINDOW, n - 1);
    // Yürüyüş HER ZAMAN sabit ANCHOR_PERIOD'dan başlar (period'a göre değil) —
    // aksi halde bir istemci bir kategoriye önce günlük moddan, başka biri arşivden
    // (farklı bir period'dan) ilk kez dokunursa pencere farklı yerden dolar ve
    // çakışma-kaçınma adımı küçük havuzlu kategorilerde farklı sonuç üretebilir.
    // Sabit çapa, kaç periyot geçerse geçsin herkesin aynı diziyi hesaplamasını garantiler;
    // maliyeti (yılda ~730 iterasyon) JS için önemsizdir.
    var recentQ = [], recentSet = {};
    for (var p = ANCHOR_PERIOD; p <= period; p++) {
      var cand = memo[p];
      if (cand === undefined) {
        cand = fnv1a(p + ':' + catId) % n;
        var guard = 0;
        while (recentSet[cand] && guard < n) { cand = (cand + 1) % n; guard++; }
        memo[p] = cand;
      }
      recentQ.push(cand);
      recentSet[cand] = (recentSet[cand] || 0) + 1;
      if (recentQ.length > W) {
        var old = recentQ.shift();
        if (--recentSet[old] <= 0) delete recentSet[old];
      }
    }
    return memo[period];
  }

  /* ═══════════ sınırsız / yarış — rastgele seçimde yakın tekrar koruması ═══════════ */
  var recentRandom = {}; // catId → [idx, idx, ...] (en eski → en yeni)
  function pickRandomAvoidingRecent(catId, n) {
    var recent = recentRandom[catId] || [];
    var avoid = {};
    for (var i = 0; i < recent.length; i++) avoid[recent[i]] = true;
    var idx, guard = 0;
    do { idx = Math.floor(Math.random() * n); guard++; }
    while (avoid[idx] && guard < n * 4);
    return idx;
  }
  function rememberRandomIdx(catId, idx, n) {
    var W = Math.min(20, Math.max(0, n - 1));
    var arr = recentRandom[catId] || (recentRandom[catId] = []);
    arr.push(idx);
    if (arr.length > W) arr.shift();
  }

  /* ═══════════ Deezer JSONP ═══════════ */
  function fetchTrack(deezerId) {
    return new Promise(function (resolve, reject) {
      if (!intIn(deezerId, 1, 1e12)) { reject(new Error('geçersiz id')); return; }
      var cb = 'nakarCb' + Math.floor(Math.random() * 1e9).toString(16) + Date.now().toString(16);
      var script = document.createElement('script');
      var timer = 0;
      function cleanup() {
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[cb] = function (resp) {
        cleanup();
        if (!isObj(resp) || resp.error) { reject(new Error('deezer hata yanıtı')); return; }
        var preview = (typeof resp.preview === 'string' && resp.preview.length < 500)
          ? safeHttpsUrl(resp.preview, 'dzcdn.net') : null;
        var cover = null;
        if (isObj(resp.album) && typeof resp.album.cover_medium === 'string' && resp.album.cover_medium.length < 500) {
          cover = safeHttpsUrl(resp.album.cover_medium, 'dzcdn.net');
        }
        resolve({ preview: preview, cover: cover });
      };
      script.onerror = function () { cleanup(); reject(new Error('jsonp yüklenemedi')); };
      timer = setTimeout(function () { cleanup(); reject(new Error('jsonp zaman aşımı')); }, JSONP_TIMEOUT);
      // path yalnızca doğrulanmış sayıdan kurulur (track/\d+)
      script.src = 'https://api.deezer.com/track/' + String(deezerId) + '?output=jsonp&callback=' + cb;
      document.head.appendChild(script);
    });
  }

  /* ═══════════ ses — atlama çalmayı kesmez ═══════════ */
  function playLoop() {
    var cap = unlockedSec();
    var t = Math.min(audio.currentTime, cap);
    updateProgress(t);
    if (audio.currentTime >= cap || audio.ended) {
      audio.pause();
      state.playing = false;
      state.reachedCap = true; // elle değil, kendi kendine durdu — bir sonraki skip anında 0'a sıfırlanmalı
      renderPlayButton();
      updateProgress(Math.min(audio.currentTime, cap));
      return;
    }
    rafId = requestAnimationFrame(playLoop);
  }

  function startPlayback(fromStart) {
    if (!state.preview) return;
    state.reachedCap = false;
    if (state.roundType === 'rush' && state.rushEnd === 0) state.rushEnd = Date.now() + RUSH_MS;
    if (audio.src !== state.preview) { audio.src = state.preview; audio.currentTime = 0; }
    if (fromStart || audio.currentTime >= unlockedSec() || audio.ended) {
      try { audio.currentTime = 0; } catch (e) { }
    }
    audio.volume = state.volume / 100;
    var pr = audio.play();
    if (pr && pr.catch) pr.catch(function () { state.playing = false; renderPlayButton(); });
    state.playing = true;
    renderPlayButton();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(playLoop);
  }

  function stopPlayback() {
    audio.pause();
    state.playing = false;
    state.reachedCap = false; // elle duraklatma — doğal bitiş değil, kaldığı yerden devam etmeli
    cancelAnimationFrame(rafId);
    renderPlayButton();
  }

  function togglePlay() {
    if (state.loadingTrack || !state.preview) return;
    if (state.playing) stopPlayback(); else startPlayback(false);
  }

  /* ═══════════ ilk ziyaret: oynat düğmesi spotlight'ı ═══════════ */
  function maybeShowSpotlight(delay) {
    var seen = null;
    try { seen = localStorage.getItem(LS.spotlightSeen); } catch (e) { }
    if (seen) return;
    setTimeout(showSpotlight, delay || 0);
  }

  function showSpotlight() {
    var seen = null;
    try { seen = localStorage.getItem(LS.spotlightSeen); } catch (e) { }
    if (seen) return;
    try { localStorage.setItem(LS.spotlightSeen, '1'); } catch (e) { }
    spotlight1Active = true;
    $('btn-play').classList.add('spotlight');
    show($('play-spotlight-bubble'), true);
    spotlightTimer = setTimeout(dismissSpotlight, 9000);
  }

  function dismissSpotlight() {
    clearTimeout(spotlightTimer);
    $('btn-play').classList.remove('spotlight');
    show($('play-spotlight-bubble'), false);
    if (spotlight1Active) {
      spotlight1Active = false;
      maybeShowSpotlight2(400);
    }
  }

  /* ═══════════ ilk ziyaret: tahmin/atla spotlight'ı (2. adım) ═══════════ */
  function maybeShowSpotlight2(delay) {
    var seen = null;
    try { seen = localStorage.getItem(LS.spotlight2Seen); } catch (e) { }
    if (seen) return;
    if (state.guesses.length > 0) return; // kullanıcı zaten tahmin etti ya da atladı
    setTimeout(showSpotlight2, delay || 0);
  }

  function showSpotlight2() {
    var seen = null;
    try { seen = localStorage.getItem(LS.spotlight2Seen); } catch (e) { }
    if (seen || state.guesses.length > 0) return;
    try { localStorage.setItem(LS.spotlight2Seen, '1'); } catch (e) { }
    $('guess-input').classList.add('spotlight-pulse');
    $('btn-skip').classList.add('spotlight-pulse');
    show($('spotlight2-bubble'), true);
    spotlight2Timer = setTimeout(dismissSpotlight2, 10000);
  }

  function dismissSpotlight2() {
    clearTimeout(spotlight2Timer);
    $('guess-input').classList.remove('spotlight-pulse');
    $('btn-skip').classList.remove('spotlight-pulse');
    show($('spotlight2-bubble'), false);
  }

  function updateProgress(t) {
    var total = state.done ? FULL_SEC : UNLOCKS[UNLOCKS.length - 1];
    var cap = unlockedSec();
    $('bar-unlocked').style.width = Math.min(100, cap / total * 100) + '%';
    $('bar-progress').style.width = Math.min(100, Math.min(t, cap) / total * 100) + '%';
    $('time-label').textContent = fmt(Math.min(t, cap)) + ' / ' + fmt(state.done ? FULL_SEC : UNLOCKS[UNLOCKS.length - 1]);
    show($('play-eq'), state.playing);
    UNLOCKS.forEach(function (sec, i) {
      var dot = $('seg-dot-' + i);
      if (dot) dot.classList.toggle('unlocked', cap >= sec);
    });
    $('play-marker').style.left = Math.min(100, Math.min(t, cap) / total * 100) + '%';
  }

  function renderPlayButton() {
    $('play-icon').setAttribute('href', state.playing ? '#i-pause-f' : '#i-play-f');
    $('btn-play').classList.toggle('playing', state.playing);
    show($('play-eq'), state.playing);
  }

  /* ═══════════ tur yönetimi ═══════════ */
  function pickTargetIdx() {
    var n = pool().length;
    if (state.roundType === 'daily') return pickForPeriod(state.catId, curPeriod());
    if (state.roundType === 'archive') return pickForPeriod(state.catId, state.archivePeriod);
    var idx = pickRandomAvoidingRecent(state.catId, n);
    rememberRandomIdx(state.catId, idx, n);
    return idx;
  }

  function loadPreview(attempt) {
    var token = ++state.roundToken;
    state.preview = null;
    state.cover = null;
    state.loadingTrack = true;
    showNetError(false);
    var song = target();
    fetchTrack(song.deezerId).then(function (tr) {
      if (token !== state.roundToken) return;
      if (!tr.preview) {
        // hak kısıtlı parça — deterministik dizide sıradakine geç
        console.warn('Nakar: "' + song.baslik + '" için önizleme yok, sıradaki şarkıya geçildi.');
        if ((attempt || 0) >= pool().length) { state.loadingTrack = false; showNetError(true); return; }
        if (state.roundType === 'daily' || state.roundType === 'archive' || state.roundType === 'meydan') {
          state.targetIdx = (state.targetIdx + 1) % pool().length;
        } else {
          state.targetIdx = pickRandomAvoidingRecent(state.catId, pool().length);
          rememberRandomIdx(state.catId, state.targetIdx, pool().length);
        }
        loadPreview((attempt || 0) + 1);
        return;
      }
      state.preview = tr.preview;
      state.cover = tr.cover;
      state.loadingTrack = false;
      if (state.done) renderResult();
      if (!state.done && state.prefs.autoplay) startPlayback(true);
    }).catch(function (err) {
      if (token !== state.roundToken) return;
      console.warn('Nakar: parça yüklenemedi — ' + err.message);
      state.loadingTrack = false;
      showNetError(true);
    });
  }

  function showNetError(on) {
    show($('net-error'), on);
  }

  function startRound(catId, mode, opts) {
    opts = opts || {};
    stopPlayback();
    audio.removeAttribute('src');
    state.catId = catId;
    state.mode = (mode === 'archive' || mode === 'meydan') ? state.mode : mode;
    state.roundType = mode;
    state.archivePeriod = opts.archivePeriod !== undefined ? opts.archivePeriod : null;
    state.guesses = [];
    state.done = null;
    state.hintOn = false;
    state.selected = null;
    state.badge = '';
    state.rushScore = 0;
    state.rushEnd = 0; // yarış sayacı ilk play basılana kadar başlamaz
    $('guess-input').value = '';
    closeSuggestions();
    loadSongs(catId).then(function () {
      if (opts.deezerId !== undefined) {
        var idx = pool().findIndex(function (s) { return s.deezerId === opts.deezerId; });
        state.targetIdx = idx >= 0 ? idx : pickTargetIdx();
      } else {
        state.targetIdx = pickTargetIdx();
      }
      // günlük: bu periyotta kaydedilmiş durum varsa geri yükle
      if (mode === 'daily') {
        var saved = state.dailyState.data[dailyKey()];
        if (saved) {
          state.guesses = saved.g.map(function (e) { return { s: e.s, t: e.t }; });
          if (saved.done) state.done = saved.done;
        }
      }
      renderAll();
      loadPreview(0);
    }).catch(function (err) {
      console.warn('Nakar: kategori yüklenemedi — ' + err.message);
      showNetError(true);
    });
  }

  function saveDaily() {
    // Not: ipucu açık/kapalı durumu kasıtlı olarak burada YOK — GAME-LOGIC §5
    // "Hint state is per-round UI state, not persisted to localStorage."
    if (state.roundType !== 'daily') return;
    state.dailyState.data[dailyKey()] = {
      g: state.guesses.map(function (e) { return { s: e.s, t: e.t }; }),
      done: state.done === 'win' || state.done === 'lose' ? state.done : null
    };
    saveLS(LS.daily, state.dailyState);
  }

  /* ═══════════ tahmin mekaniği ═══════════ */
  function submitGuess() {
    dismissSpotlight2();
    if (state.done || state.selected === null) return;
    var guess = pool()[state.selected];
    if (!guess) return;
    var t = target();
    var correct = guess.deezerId === t.deezerId ||
      (norm(guess.baslik) === norm(t.baslik) && norm(guess.sanatci) === norm(t.sanatci));
    var close = !correct && norm(guess.sanatci) === norm(t.sanatci);
    state.selected = null;
    $('guess-input').value = '';
    closeSuggestions();

    if (state.roundType === 'rush') {
      if (correct) {
        state.rushScore++;
        flashToast('+1 · Doğru!', 1100);
        nextRushSong();
      } else {
        pushGuess(close ? 'close' : 'wrong', songLabel(guess) + (close ? ' · Sanatçı doğru!' : ''));
      }
      renderAll();
      return;
    }

    if (correct) { finishRound(true); return; }
    pushGuess(close ? 'close' : 'wrong', songLabel(guess) + (close ? ' · Sanatçı doğru!' : ''));
    if (state.guesses.length >= MAX_GUESSES) { finishRound(false); return; }
    saveDaily();
    renderAll();
  }

  function pushGuess(s, t) {
    state.guesses.push({ s: s, t: t });
    if (state.roundType === 'rush' && state.guesses.length > UNLOCKS.length - 1) {
      state.guesses = state.guesses.slice(-(UNLOCKS.length - 1));
    }
    // atlama/yanlış çalmayı KESMEZ — sadece sınır uzar, rAF döngüsü yeni sınıra doğru sürer.
    // Ama önizleme kullanıcı durdurmadan, kendi kendine eski sınırda durduysa imleç orada
    // takılı kalmasın — yeni açılan süre için baştan başlasın.
    if (!state.playing && state.reachedCap) {
      try { audio.currentTime = 0; } catch (e) { }
      state.reachedCap = false;
    }
  }

  function skip() {
    dismissSpotlight2();
    if (state.done) return;
    if (state.roundType === 'rush') { nextRushSong(); renderAll(); return; }
    var delta = UNLOCKS[Math.min(state.guesses.length + 1, 5)] - unlockedSec();
    pushGuess('skip', 'Atlandı (+' + delta + ' sn)');
    if (state.guesses.length >= MAX_GUESSES) { finishRound(false); return; }
    saveDaily();
    renderAll();
  }

  function nextRushSong() {
    state.guesses = [];
    state.selected = null;
    stopPlayback();
    state.targetIdx = pickRandomAvoidingRecent(state.catId, pool().length);
    rememberRandomIdx(state.catId, state.targetIdx, pool().length);
    loadPreview(0);
  }

  /* ═══════════ günlük çözüm sayacı (Cloudflare Worker) ═══════════ */
  var solveCountCache = null; // { catId, count } — en son başarılı GET sonucu
  var lastSolveCountFetch = 0;
  var solveCountReqId = 0; // periyodik/visibilitychange/manuel istekler çakışırsa yalnızca en yenisi geçerli sayılır

  function postSolveCount(catId) {
    fetch(COUNTER_API + '/count/' + encodeURIComponent(catId), { method: 'POST' })
      .catch(function (err) { console.warn('Nakar: çözüm sayacı gönderilemedi — ' + err.message); });
  }

  function haveSolveCount(catId) {
    return !!(solveCountCache && solveCountCache.catId === catId);
  }

  function renderSolveCounter() {
    var box = $('solve-counter');
    if (!box) return;
    var visible = state.roundType === 'daily' && haveSolveCount(state.catId);
    if (visible) $('solve-counter-text').textContent = solveCountCache.count + ' kişi bugün bildi';
    show(box, !!visible);
  }

  function fetchSolveCount(catId) {
    lastSolveCountFetch = Date.now();
    var reqId = ++solveCountReqId;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 5000) : null;
    fetch(COUNTER_API + '/count/' + encodeURIComponent(catId), controller ? { signal: controller.signal } : {})
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        if (reqId !== solveCountReqId) return; // bu arada daha yeni bir istek başlatıldı, bu yanıt eskidi
        if (typeof data.count !== 'number') throw new Error('geçersiz yanıt');
        solveCountCache = { catId: catId, count: data.count };
        renderSolveCounter();
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        console.warn('Nakar: çözüm sayacı alınamadı — ' + err.message);
        if (reqId !== solveCountReqId) return;
        if (solveCountCache && solveCountCache.catId === catId) solveCountCache = null;
        renderSolveCounter();
      });
  }

  function finishRound(win) {
    stopPlayback();
    var nGuess = state.guesses.length + 1;
    state.done = win ? 'win' : 'lose';
    var badges = [];

    if (state.roundType === 'daily' || state.roundType === 'unlimited') {
      var key = statKey(state.catId, state.roundType);
      var st = statFor(state.catId, state.roundType);
      st = JSON.parse(JSON.stringify(st));
      st.played++;
      if (win) {
        st.wins++;
        st.dist[Math.min(nGuess, 6) - 1]++;
        if (state.roundType === 'daily') {
          st.streak = (st.lastPeriod === curPeriod() - 1 || st.lastPeriod === curPeriod()) ? st.streak + 1 : 1;
          st.maxStreak = Math.max(st.maxStreak, st.streak);
        } else {
          st.streak++;
          st.maxStreak = Math.max(st.maxStreak, st.streak);
        }
      } else {
        st.streak = 0;
      }
      if (state.roundType === 'daily') { st.lastPeriod = curPeriod(); st.lastWin = win; }
      state.stats.data[key] = st;
      saveLS(LS.stats, state.stats);

      if (win) {
        if (nGuess === 1) badges.push('Altın Kulak');
        else if (nGuess === 2) badges.push('Keskin Kulak');
        if (state.roundType === 'daily' && st.streak >= 5) badges.push('Seri Ustası');
      }
      checkAchievements(win, nGuess, st);
    }

    state.badge = badges.join(' · ');
    saveDaily();
    renderAll();
    if (win) launchConfetti();

    if (state.roundType === 'daily') {
      if (win) postSolveCount(state.catId);
      fetchSolveCount(state.catId);
    }
  }

  function finishRush() {
    stopPlayback();
    state.done = 'rush';
    var key = statKey(state.catId, 'rush');
    var st = JSON.parse(JSON.stringify(statFor(state.catId, 'rush')));
    st.played++;
    st.best = Math.max(st.best, state.rushScore);
    state.stats.data[key] = st;
    saveLS(LS.stats, state.stats);
    checkAchievements(false, 0, st);
    renderAll();
  }

  /* ═══════════ başarımlar ═══════════ */
  function unlockAch(id) {
    if (state.ach.unlocked[id]) return;
    state.ach.unlocked[id] = true;
    saveLS(LS.ach, state.ach);
    var a = ACHIEVEMENTS.find(function (x) { return x.id === id; });
    if (a) flashToast('Başarım: ' + a.name + ' 🏆', 2600);
  }

  function checkAchievements(win, nGuess, st) {
    if (win) {
      unlockAch('first-win');
      if (nGuess === 1) unlockAch('golden-ear');
      if (nGuess === 2) unlockAch('sharp-ear');
      if (!state.guesses.some(function (g) { return g.s === 'skip'; })) unlockAch('no-skip');
      var trHour = Math.floor(((Date.now() + TR_OFFSET_MS) % 86400000) / 3600000);
      if (trHour >= 0 && trHour < 6) unlockAch('night-owl');
      if (state.roundType === 'daily' && st.streak >= 7) unlockAch('streak-7');
    }
    var unlimWins = 0, playedCats = {};
    for (var k in state.stats.data) {
      var parts = k.split(':');
      if (parts[1] === 'unlimited') unlimWins += state.stats.data[k].wins;
      if (state.stats.data[k].played > 0) playedCats[parts[0]] = true;
    }
    if (unlimWins >= 25) unlockAch('unlimited-25');
    var playable = state.cats.filter(function (c) { return CAT_ICONS[c.id]; });
    if (playable.length && playable.every(function (c) { return playedCats[c.id]; })) unlockAch('all-cats');
    if (state.rushScore >= 10) unlockAch('rush-10');
    if (state.favs.ids.length >= 5) unlockAch('collector');
  }

  /* ═══════════ ipuçları ═══════════ */
  function hintTiers() {
    var t = target();
    if (!t) return [];
    var words = t.baslik.trim().split(/\s+/);
    var tiers = [
      'Kelime sayısı: ' + words.length,
      'İlk harf: ' + t.baslik.trim().charAt(0)
    ];
    // on yıl ipucu — yalnız kategori birden fazla on yılı kapsıyorsa ve şarkının yılı varsa
    var decades = {};
    pool().forEach(function (s) { if (s.yil) decades[Math.floor(s.yil / 10) * 10] = true; });
    if (Object.keys(decades).length > 1 && t.yil) {
      tiers.push('Dönem: ' + (Math.floor(t.yil / 10) * 10) + "'ler");
    }
    tiers.push('Sanatçı: ' + t.sanatci);
    tiers.push('Baş harfler: ' + words.map(function (w) {
      return w.charAt(0) + '_'.repeat(Math.max(0, Math.min(w.length - 1, 12)));
    }).join(' '));
    return tiers;
  }

  function renderHints() {
    var box = $('hint-box');
    while (box.firstChild) box.removeChild(box.firstChild);
    var on = state.hintOn && !state.done && state.roundType !== 'rush';
    $('btn-hint').setAttribute('aria-pressed', state.hintOn ? 'true' : 'false');
    $('hint-icon').setAttribute('href', state.hintOn ? '#i-lightbulb-f' : '#i-lightbulb');
    show($('btn-hint'), state.roundType !== 'rush' && !state.done);
    if (!on) { show(box, false); return; }
    var tiers = hintTiers();
    var revealed = Math.min(state.guesses.length, tiers.length);
    if (revealed === 0) {
      var chip0 = el('div', 'hint-chip');
      chip0.appendChild(icon('lightbulb', 'ic'));
      chip0.appendChild(el('span', null, 'İpuçları açık — her harcanan hak bir ipucu açar'));
      box.appendChild(chip0);
    }
    for (var i = 0; i < revealed; i++) {
      var chip = el('div', 'hint-chip');
      chip.appendChild(icon('lightbulb-f', 'ic'));
      chip.appendChild(el('span', null, tiers[i]));
      box.appendChild(chip);
    }
    show(box, true);
  }

  /* ═══════════ autocomplete — yalnızca seçimle tahmin ═══════════ */
  function onInput() {
    state.selected = null;
    var q = norm($('guess-input').value);
    if (q.length < 2) { closeSuggestions(); renderSubmit(); return; }
    var p = pool();
    var items = [];
    for (var i = 0; i < p.length && items.length < 30; i++) {
      if (norm(songLabel(p[i])).indexOf(q) >= 0) items.push(i);
    }
    state.sugItems = items;
    state.sugActive = -1;
    var boxEl = $('suggestions');
    while (boxEl.firstChild) boxEl.removeChild(boxEl.firstChild);
    items.forEach(function (idx, i) {
      var b = el('button', 'sug-item');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.appendChild(icon('music-note', 'ic'));
      b.appendChild(el('span', null, songLabel(p[idx])));
      b.addEventListener('click', function () { pickSuggestion(idx); });
      boxEl.appendChild(b);
    });
    show(boxEl, items.length > 0);
    $('guess-input').setAttribute('aria-expanded', items.length > 0 ? 'true' : 'false');
    renderSubmit();
  }

  function pickSuggestion(idx) {
    state.selected = idx;
    $('guess-input').value = songLabel(pool()[idx]);
    closeSuggestions();
    renderSubmit();
    $('guess-input').focus();
  }

  function closeSuggestions() {
    state.sugItems = [];
    state.sugActive = -1;
    show($('suggestions'), false);
    $('guess-input').setAttribute('aria-expanded', 'false');
  }

  function moveSuggestion(dir) {
    if (!state.sugItems.length) return;
    state.sugActive = (state.sugActive + dir + state.sugItems.length) % state.sugItems.length;
    var kids = $('suggestions').children;
    for (var i = 0; i < kids.length; i++) kids[i].classList.toggle('sug-item--active', i === state.sugActive);
    kids[state.sugActive].scrollIntoView({ block: 'nearest' });
  }

  function renderSubmit() {
    $('btn-submit').disabled = state.selected === null || !!state.done;
  }

  /* ═══════════ paylaşım / skor kartı / meydan ═══════════ */
  function emojiMarks() {
    var map = { skip: '⬜', wrong: '🟥', close: '🟨' };
    var marks = state.guesses.map(function (g) { return map[g.s]; });
    if (state.done === 'win') marks.push('🟩');
    return marks.join('');
  }

  function shareText() {
    var cat = state.cats.find(function (c) { return c.id === state.catId; });
    var name = cat ? cat.ad : state.catId;
    var head;
    if (state.roundType === 'daily' || state.roundType === 'archive') {
      var n = (state.roundType === 'archive' ? state.archivePeriod : curPeriod()) - LAUNCH_PERIOD + 1;
      head = 'Nakar #' + n + ' · ' + name;
    } else {
      head = 'Nakar · ' + name + (state.roundType === 'rush' ? ' (Yarış)' : ' (Sınırsız)');
    }
    var body = state.done === 'rush'
      ? '⏱️ 60 saniyede ' + state.rushScore + ' şarkı!'
      : '🔊' + emojiMarks();
    return head + '\n' + body + '\n' + DOMAIN;
  }

  function doShare() {
    var txt = shareText();
    if (navigator.share) {
      navigator.share({ text: txt }).catch(function () { });
      return;
    }
    copyText(txt, 'Sonuç panoya kopyalandı');
  }

  function copyText(txt, msg) {
    var done = function () { flashToast(msg); };
    try {
      navigator.clipboard.writeText(txt).then(done, done);
    } catch (e) { done(); }
  }

  function challengeLink() {
    var t = target();
    var url = location.origin + location.pathname + '?meydan=1&k=' + encodeURIComponent(state.catId) + '&s=' + t.deezerId;
    copyText('Bu şarkıyı benden hızlı bilebilir misin? ' + url, 'Meydan okuma bağlantısı kopyalandı — arkadaşına gönder!');
  }

  function tryMeydanParam() {
    var params = new URLSearchParams(location.search);
    if (params.get('meydan') !== '1') return Promise.resolve(false);
    var k = params.get('k') || '';
    var s = Number(params.get('s'));
    if (!/^[a-z0-9-]{1,40}$/.test(k) || !intIn(s, 1, 1e12)) return Promise.resolve(false);
    if (!state.cats.some(function (c) { return c.id === k; })) return Promise.resolve(false);
    return loadSongs(k).then(function (list) {
      if (!list.some(function (x) { return x.deezerId === s; })) return false;
      startRound(k, 'meydan', { deezerId: s });
      return true;
    }).catch(function () { return false; });
  }

  /* ═══════════ görünüm ═══════════ */
  function renderAll() {
    renderHeader();
    renderModeUI();
    renderRows();
    renderHints();
    renderPlayArea();
    renderResult();
    renderSubmit();
    renderCats();
    renderSummary();
    updateProgress(state.playing ? audio.currentTime : (state.done ? 0 : Math.min(audio.currentTime || 0, unlockedSec())));
  }

  function renderHeader() {
    var st = statFor(state.catId, 'daily');
    var effective = (st.lastPeriod === curPeriod() || st.lastPeriod === curPeriod() - 1) ? st.streak : 0;
    $('streak-text').textContent = effective + ' seri';
  }

  function renderModeUI() {
    var segs = { daily: $('seg-daily'), unlimited: $('seg-unlimited'), rush: $('seg-rush') };
    for (var m in segs) {
      segs[m].classList.toggle('seg-btn--active', state.roundType === m);
      segs[m].setAttribute('aria-selected', state.roundType === m ? 'true' : 'false');
    }
    var kickers = {
      daily: 'Günlük mod · herkes aynı şarkıyı çözüyor',
      unlimited: 'Sınırsız mod · bekleme yok',
      rush: 'Süre yarışı · 60 saniyede kaç şarkı?',
      archive: 'Arşiv · geçmiş günlük şarkı',
      meydan: 'Meydan okuma · aynı şarkıyı sen de bil'
    };
    $('mode-kicker').textContent = kickers[state.roundType];
    var cat = state.cats.find(function (c) { return c.id === state.catId; });
    var titleSpan = $('cat-title-text');
    if (titleSpan.textContent !== (cat ? cat.ad : '')) {
      var fresh = el('span', null, cat ? cat.ad : '');
      fresh.id = 'cat-title-text';
      titleSpan.replaceWith(fresh);
    }
    show($('daily-countdown'), state.roundType === 'daily');
    show($('rush-chips'), state.roundType === 'rush' && !state.done);
    renderCountdown();
    renderSolveCounter();
  }

  function renderCountdown() {
    var msLeft = Math.max(0, nextPeriodStartMs() - Date.now());
    var s = Math.floor(msLeft / 1000);
    var txt = String(Math.floor(s / 3600)).padStart(2, '0') + ':' +
      String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ':' +
      String(s % 60).padStart(2, '0');
    [$('countdown'), $('countdown2')].forEach(function (n) {
      while (n.firstChild) n.removeChild(n.firstChild);
      n.appendChild(document.createTextNode(txt.slice(0, 6)));
      var sec = el('span', 'tick-digit', txt.slice(6));
      n.appendChild(sec);
    });
    if (state.roundType === 'rush') {
      $('rush-time').textContent = state.rushEnd > 0
        ? String(Math.max(0, Math.ceil((state.rushEnd - Date.now()) / 1000)))
        : String(RUSH_MS / 1000);
      $('rush-score').textContent = String(state.rushScore);
    }
  }

  function renderRows() {
    var box = $('rows');
    while (box.firstChild) box.removeChild(box.firstChild);
    var total = state.roundType === 'rush' ? UNLOCKS.length - 1 : MAX_GUESSES;
    for (var i = 0; i < total; i++) {
      var g = state.guesses[i];
      var row = el('div', 'row');
      var isWinRow = state.done === 'win' && i === state.guesses.length;
      var isNext = !g && !isWinRow && i === state.guesses.length && !state.done;
      if (g) {
        row.classList.add('row--filled');
        var kind = g.s === 'skip' ? 'skipped' : g.s;
        row.classList.add('row--' + kind);
        var icName = g.s === 'skip' ? 'skip-forward' : g.s === 'close' ? 'target' : 'x';
        row.appendChild(icon(icName, 'ic'));
        row.appendChild(el('span', 'row-text', g.t));
        if (i === state.guesses.length - 1 && !state.done) {
          row.classList.add(g.s === 'wrong' ? 'row--anim-wrong' : 'row--anim-in');
        }
      } else if (isWinRow) {
        row.classList.add('row--win', 'row--anim-win');
        row.appendChild(icon('check', 'ic'));
        row.appendChild(el('span', 'row-text', songLabel(target())));
      } else {
        if (isNext) row.classList.add('row--next');
        row.appendChild(el('span', 'row-text', ''));
      }
      box.appendChild(row);
    }
  }

  function renderPlayArea() {
    var inPlay = !state.done;
    show($('play-area'), inPlay);
    var g = state.guesses.length;
    var label;
    if (state.roundType === 'rush') label = 'Yeni Şarkı';
    else if (g >= MAX_GUESSES - 1) label = 'Pes Et';
    else label = 'Atla (+' + (UNLOCKS[Math.min(g + 1, 5)] - UNLOCKS[Math.min(g, 5)]) + ' sn)';
    $('skip-label').textContent = label;
  }

  function renderResult() {
    var done = state.done;
    show($('result'), !!done);
    if (!done) return;
    var r = $('result');
    r.classList.remove('result--win', 'result--lose', 'result--rush');
    r.classList.add(done === 'win' ? 'result--win' : done === 'rush' ? 'result--rush' : 'result--lose');
    $('result-icon').setAttribute('href', done === 'win' ? '#i-seal-check-f' : done === 'rush' ? '#i-timer-f' : '#i-x-circle');
    $('result-title').textContent = done === 'win' ? 'Doğru bildin!' : done === 'rush' ? 'Süre doldu!' : 'Olmadı — cevap buydu';
    show($('result-badge'), !!state.badge);
    $('badge-text').textContent = state.badge;

    var t = target();
    $('answer-title').textContent = done === 'rush' ? state.rushScore + ' şarkı' : (t ? t.baslik : '');
    $('answer-artist').textContent = done === 'rush' ? '60 saniyede' : (t ? t.sanatci : '');
    var img = $('cover-img');
    if (state.cover && done !== 'rush') {
      img.src = state.cover;
      show(img, true); show($('cover'), false);
    } else {
      img.removeAttribute('src');
      show(img, false); show($('cover'), true);
    }

    var detail;
    if (done === 'win') {
      detail = (state.guesses.length + 1) + '. denemede, ' + UNLOCKS[Math.min(state.guesses.length, 5)] + ' saniye dinleyerek buldun.';
    } else if (done === 'rush') {
      var best = statFor(state.catId, 'rush').best;
      detail = '60 saniyede ' + state.rushScore + ' şarkı bildin. Rekorun: ' + Math.max(best, state.rushScore) + ' şarkı.';
    } else if (state.roundType === 'daily') {
      detail = 'Üzülme — yeni şarkı yolda. Serin sıfırlandı, geri kazan!';
    } else {
      detail = 'Sonraki şarkıyla tekrar dene.';
    }
    $('result-detail').textContent = detail;

    show($('result-countdown-box'), state.roundType === 'daily');
    show($('btn-listen-full'), done !== 'rush' && !!state.preview);
    var nextBtn = $('btn-next');
    show(nextBtn, state.roundType !== 'daily');
    $('next-label').textContent = state.roundType === 'rush' ? 'Tekrar Yarış' : 'Sonraki Şarkı';
    show($('btn-challenge'), done !== 'rush');
  }

  function launchConfetti() {
    if (state.prefs.reduceMotion) return;
    var box = $('confetti');
    while (box.firstChild) box.removeChild(box.firstChild);
    var colors = ['var(--color-accent)', 'var(--color-accent-300)', 'var(--color-accent-600)', 'var(--color-accent-200)', 'oklch(70% .13 150)'];
    for (var i = 0; i < 28; i++) {
      var d = el('div', 'confetti-piece');
      d.style.left = (3 + Math.random() * 94) + '%';
      d.style.width = (6 + Math.random() * 5) + 'px';
      d.style.height = (10 + Math.random() * 7) + 'px';
      d.style.background = colors[i % colors.length];
      d.style.animationDuration = (2.4 + Math.random() * 2) + 's';
      d.style.animationDelay = (Math.random() * 0.6) + 's';
      box.appendChild(d);
    }
    show(box, true);
    setTimeout(function () { show(box, false); }, 5500);
  }

  /* ═══════════ kategori kartları ═══════════ */
  function catCard(c, wide) {
    var btn = el('button', 'cat-card');
    btn.type = 'button';
    if (c.id === state.catId) btn.classList.add('cat-card--active');

    var st = statFor(c.id, 'daily');
    var effStreak = (st.lastPeriod === curPeriod() || st.lastPeriod === curPeriod() - 1) ? st.streak : 0;
    if (effStreak > 0) {
      var chip = el('span', 'cat-streak');
      chip.appendChild(icon('flame-f', 'ic'));
      chip.appendChild(document.createTextNode(' ' + effStreak));
      btn.appendChild(chip);
    }

    var fav = el('button', 'cat-fav');
    fav.type = 'button';
    var isFav = state.favs.ids.indexOf(c.id) >= 0;
    if (isFav) fav.classList.add('cat-fav--on');
    fav.title = isFav ? 'Favorilerden çıkar' : 'Favorilere ekle';
    fav.appendChild(icon(isFav ? 'heart-f' : 'heart', 'ic'));
    fav.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleFav(c.id);
    });
    btn.appendChild(fav);

    var ib = el('div', 'cat-icon');
    ib.appendChild(icon((CAT_ICONS[c.id] || 'music-note') + '-f', 'ic-cat'));
    btn.appendChild(ib);
    var nameWrap = el('div', 'cat-name-wrap');
    nameWrap.appendChild(el('div', 'cat-name', c.ad));
    if (CAT_BLURBS[c.id]) nameWrap.appendChild(el('div', 'cat-blurb', CAT_BLURBS[c.id]));
    btn.appendChild(nameWrap);
    var count = state.songs[c.id] ? state.songs[c.id].length + ' şarkı · Günlük + Sınırsız' : 'Günlük + Sınırsız';
    btn.appendChild(el('div', 'cat-meta', count));

    var dk = curPeriod() + ':' + c.id;
    var ds = state.dailyState.data[dk];
    if (ds && ds.done) {
      var doneEl = el('span', 'cat-done');
      doneEl.appendChild(icon('check-circle-f', 'ic'));
      doneEl.appendChild(document.createTextNode(' Bugün oynandı'));
      btn.appendChild(doneEl);
    }

    btn.addEventListener('click', function () {
      startRound(c.id, state.mode);
      window.scrollTo({ top: 0, behavior: state.prefs.reduceMotion ? 'auto' : 'smooth' });
    });
    return btn;
  }

  function toggleFav(catId) {
    var i = state.favs.ids.indexOf(catId);
    if (i >= 0) state.favs.ids.splice(i, 1);
    else state.favs.ids.push(catId);
    saveLS(LS.favs, state.favs);
    checkAchievements(false, 0, null);
    renderCats();
  }

  function sortFavFirst(list) {
    return list.slice().sort(function (a, b) {
      var fa = state.favs.ids.indexOf(a.id) >= 0 ? 0 : 1;
      var fb = state.favs.ids.indexOf(b.id) >= 0 ? 0 : 1;
      return fa - fb;
    });
  }

  function renderCats() {
    var groups = { yil: $('grid-yil'), tur: $('grid-tur') };
    for (var g in groups) {
      var grid = groups[g];
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      sortFavFirst(state.cats.filter(function (c) { return c.grup === g; }))
        .forEach(function (c) { grid.appendChild(catCard(c)); });
    }
    var diger = $('grid-diger');
    var euro = $('eurovision-card');
    while (diger.firstChild) diger.removeChild(diger.firstChild);
    sortFavFirst(state.cats.filter(function (c) { return c.grup === 'diger'; }))
      .forEach(function (c) { diger.appendChild(catCard(c, true)); });
    diger.appendChild(euro);
    var dizi = state.songs['dizi-muzikleri'];
    $('dizi-meta').textContent = dizi ? dizi.length + ' jenerik seni bekliyor.' : '';
  }

  function renderSummary() {
    var cur = curPeriod();
    var playable = state.cats.filter(function (c) { return CAT_ICONS[c.id]; });
    var played = 0, won = 0;
    playable.forEach(function (c) {
      var ds = state.dailyState.data[cur + ':' + c.id];
      if (ds && ds.done) {
        played++;
        if (ds.done === 'win') won++;
      }
    });
    $('summary-text').textContent = 'Bugünkü günlükler: ' + played + '/' + playable.length + ' oynandı · ' + won + ' doğru';
    var bar = $('summary-bar');
    bar.style.width = (playable.length ? played / playable.length * 100 : 0) + '%';
    bar.style.minWidth = played ? '10px' : '0';
  }

  /* ═══════════ istatistik modalı ═══════════ */
  function renderStatsModal() {
    var cat = state.cats.find(function (c) { return c.id === state.catId; });
    var mode = state.mode === 'rush' ? 'unlimited' : state.mode;
    var modeLabel = state.mode === 'daily' ? 'Günlük mod' : state.mode === 'rush' ? 'Sınırsız mod' : 'Sınırsız mod';
    $('stats-subtitle').textContent = (cat ? cat.ad : '') + ' · ' + modeLabel;
    var st = statFor(state.catId, mode);
    $('st-played').textContent = String(st.played);
    $('st-winpct').textContent = '%' + (st.played ? Math.round(st.wins / st.played * 100) : 0);
    $('st-streak').textContent = String(st.streak);
    $('st-maxstreak').textContent = String(st.maxStreak);

    var box = $('dist-bars');
    while (box.firstChild) box.removeChild(box.firstChild);
    var maxDist = Math.max.apply(null, [1].concat(st.dist));
    st.dist.forEach(function (count, i) {
      var row = el('div', 'dist-row');
      row.appendChild(el('span', 'dist-n tnum', String(i + 1)));
      var track = el('div', 'dist-track');
      var fill = el('div', 'dist-fill');
      fill.style.width = (count / maxDist * 100) + '%';
      fill.style.minWidth = count ? '14px' : '0';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'dist-count tnum', String(count)));
      box.appendChild(row);
    });

    var rushSt = statFor(state.catId, 'rush');
    show($('rush-best-row'), rushSt.best > 0);
    $('rush-best-text').textContent = 'Yarış rekoru: 60 saniyede ' + rushSt.best + ' şarkı';

    var ach = $('ach-grid');
    while (ach.firstChild) ach.removeChild(ach.firstChild);
    ACHIEVEMENTS.forEach(function (a) {
      var unlocked = !!state.ach.unlocked[a.id];
      var item = el('div', 'ach-item' + (unlocked ? '' : ' ach-item--locked'));
      item.appendChild(icon(unlocked ? 'trophy-f' : 'trophy', 'ic'));
      var meta = el('div', 'ach-meta');
      meta.appendChild(el('div', 'ach-name', a.name));
      meta.appendChild(el('div', 'ach-desc', a.desc));
      item.appendChild(meta);
      ach.appendChild(item);
    });
  }

  /* ═══════════ arşiv ═══════════ */
  function renderArchive() {
    var listEl = $('archive-list');
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    var cat = state.cats.find(function (c) { return c.id === state.catId; });
    var sub = document.querySelector('#modal-archive .dialog-sub');
    sub.textContent = (cat ? cat.ad : '') + ' — kaçırdığın günlük şarkıları oyna, sonuç serini etkilemez.';
    var cur = curPeriod();
    for (var i = 1; i <= 30; i++) {
      (function (p) {
        var trMs = p * PERIOD_MS; // TR'ye kaydırılmış zaman
        var d = new Date(trMs);
        var dateLabel = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' }) +
          (p % 2 === 1 ? ' · Akşam' : ' · Sabah');
        var item = el('div', 'archive-item');
        item.appendChild(icon('calendar-blank', 'ic-cal ic'));
        item.appendChild(el('span', 'archive-label', dateLabel));
        var b = el('button', 'btn btn-ghost');
        b.type = 'button';
        b.appendChild(icon('play', 'ic ic-sm'));
        b.appendChild(document.createTextNode(' Oyna'));
        b.addEventListener('click', function () {
          closeModal($('modal-archive'));
          startRound(state.catId, 'archive', { archivePeriod: p });
          window.scrollTo({ top: 0, behavior: state.prefs.reduceMotion ? 'auto' : 'smooth' });
        });
        item.appendChild(b);
        listEl.appendChild(item);
      })(cur - i);
    }
  }

  /* ═══════════ modallar / toast ═══════════ */
  function openModal(m) {
    if (m === $('modal-stats')) renderStatsModal();
    if (m === $('modal-archive')) renderArchive();
    show(m, true);
  }
  function closeModal(m) {
    show(m, false);
    if (m === $('modal-help')) maybeShowSpotlight(300);
  }

  function flashToast(msg, ms) {
    $('toast-text').textContent = msg;
    show($('toast'), true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { show($('toast'), false); }, ms || 2200);
  }

  /* ═══════════ ayarlar ═══════════ */
  function applyPrefs() {
    document.body.classList.toggle('no-motion', state.prefs.reduceMotion);
    show($('dimmer'), state.prefs.dimmer);
    ['autoplay', 'reduceMotion', 'dimmer'].forEach(function (k) {
      $('tgl-' + k).setAttribute('aria-checked', state.prefs[k] ? 'true' : 'false');
    });
  }

  function togglePref(k) {
    state.prefs[k] = !state.prefs[k];
    saveLS(LS.prefs, state.prefs);
    applyPrefs();
  }

  /* ═══════════ üst bar / hamburger ═══════════ */
  var MENU_ITEMS = [
    { icon: 'clock-counter-clockwise', label: 'Arşiv', modal: 'modal-archive' },
    { icon: 'gear-six', label: 'Ayarlar', modal: 'modal-settings' },
    { icon: 'chart-bar', label: 'İstatistikler', modal: 'modal-stats' },
    { icon: 'question', label: 'Nasıl oynanır?', modal: 'modal-help' },
    { icon: 'instagram-logo', label: 'Instagram', modal: null, url: 'https://www.instagram.com/nakartr/' },
    { icon: 'x-logo', label: 'X', modal: null, url: 'https://x.com/nakartr' }
  ];

  function buildMenu() {
    var menu = $('menu');
    while (menu.firstChild) menu.removeChild(menu.firstChild);
    MENU_ITEMS.forEach(function (mi) {
      var b = el('button', 'menu-item');
      b.type = 'button';
      b.appendChild(icon(mi.icon, 'ic'));
      b.appendChild(document.createTextNode(mi.label));
      b.addEventListener('click', function () {
        toggleMenu(false);
        if (mi.modal) openModal($(mi.modal));
        if (mi.url) window.open(mi.url, '_blank', 'noopener');
      });
      menu.appendChild(b);
    });
  }

  function toggleMenu(force) {
    var menu = $('menu');
    var on = force !== undefined ? force : menu.classList.contains('hidden');
    show(menu, on);
    $('menu-icon').setAttribute('href', on ? '#i-x' : '#i-list');
  }

  function onResize() {
    var narrow = window.innerWidth < 640;
    show($('topbar-icons'), !narrow);
    show($('hamburger-wrap'), narrow);
    if (!narrow) toggleMenu(false);
  }

  /* ═══════════ olay bağlama ═══════════ */
  function bindEvents() {
    $('seg-daily').addEventListener('click', function () { startRound(state.catId, 'daily'); });
    $('seg-unlimited').addEventListener('click', function () { startRound(state.catId, 'unlimited'); });
    $('seg-rush').addEventListener('click', function () { startRound(state.catId, 'rush'); });

    $('btn-play').addEventListener('click', function () { dismissSpotlight(); togglePlay(); });
    $('btn-skip').addEventListener('click', skip);
    $('btn-submit').addEventListener('click', submitGuess);
    $('btn-retry').addEventListener('click', function () {
      showNetError(false);
      if (!state.cats.length) { loadInitialData(); return; }
      if (!pool().length) startRound(state.catId, state.roundType === 'archive' ? 'archive' : state.mode, { archivePeriod: state.archivePeriod });
      else loadPreview(0);
    });

    $('btn-hint').addEventListener('click', function () {
      if (state.done || state.roundType === 'rush') return;
      state.hintOn = !state.hintOn;
      renderHints();
    });

    $('btn-vol').addEventListener('click', function (e) {
      e.stopPropagation();
      show($('vol-pop'), $('vol-pop').classList.contains('hidden'));
    });
    $('vol-pop').addEventListener('click', function (e) { e.stopPropagation(); });
    $('vol-range').addEventListener('input', function () {
      state.volume = Number($('vol-range').value);
      $('vol-label').textContent = '%' + state.volume;
      audio.volume = state.volume / 100;
      $('vol-icon').setAttribute('href', state.volume === 0 ? '#i-speaker-slash' : state.volume < 50 ? '#i-speaker-low' : '#i-speaker-high');
    });

    var input = $('guess-input');
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggestion(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggestion(-1); }
      else if (e.key === 'Enter') {
        if (state.sugActive >= 0 && state.sugItems[state.sugActive] !== undefined) pickSuggestion(state.sugItems[state.sugActive]);
        else if (state.selected !== null) submitGuess();
      } else if (e.key === 'Escape') closeSuggestions();
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.input-wrap')) closeSuggestions();
      if (!e.target.closest || !e.target.closest('.player-left')) show($('vol-pop'), false);
      if (!e.target.closest || !e.target.closest('#hamburger-wrap')) toggleMenu(false);
    });

    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toUpperCase();
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON') {
        e.preventDefault();
        togglePlay();
      }
      if (e.key === 'Escape') {
        ['modal-stats', 'modal-help', 'modal-settings', 'modal-archive'].forEach(function (id) { closeModal($(id)); });
      }
    });

    // sonuç butonları
    $('btn-share').addEventListener('click', doShare);
    $('btn-listen-full').addEventListener('click', function () { startPlayback(true); });
    $('btn-stats2').addEventListener('click', function () { openModal($('modal-stats')); });
    $('btn-next').addEventListener('click', function () {
      startRound(state.catId, state.roundType === 'rush' ? 'rush' : 'unlimited');
      window.scrollTo({ top: 0, behavior: state.prefs.reduceMotion ? 'auto' : 'smooth' });
    });
    $('btn-challenge').addEventListener('click', challengeLink);

    // üst bar
    $('btn-archive').addEventListener('click', function () { openModal($('modal-archive')); });
    $('btn-archive2').addEventListener('click', function () { openModal($('modal-archive')); });
    $('btn-settings').addEventListener('click', function () { openModal($('modal-settings')); });
    $('btn-stats').addEventListener('click', function () { openModal($('modal-stats')); });
    $('btn-help').addEventListener('click', function () { openModal($('modal-help')); });
    $('btn-menu').addEventListener('click', function (e) { e.stopPropagation(); toggleMenu(); });

    $('btn-brand').addEventListener('click', function () {
      document.querySelectorAll('.dialog-backdrop').forEach(function (m) { closeModal(m); });
      toggleMenu(false);
      startRound('gunun', 'daily');
      window.scrollTo({ top: 0, behavior: state.prefs.reduceMotion ? 'auto' : 'smooth' });
    });

    $('btn-scroll-top').addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: state.prefs.reduceMotion ? 'auto' : 'smooth' });
    });
    window.addEventListener('scroll', function () {
      $('btn-scroll-top').classList.toggle('visible', window.scrollY > 480);
    }, { passive: true });

    // dizi banner
    $('dizi-banner').addEventListener('click', function () {
      startRound('dizi-muzikleri', state.mode);
      window.scrollTo({ top: 0, behavior: state.prefs.reduceMotion ? 'auto' : 'smooth' });
    });

    // modallar: backdrop + kapat butonları
    document.querySelectorAll('.dialog-backdrop').forEach(function (bd) {
      bd.addEventListener('click', function (e) { if (e.target === bd) closeModal(bd); });
      bd.querySelector('.dialog').addEventListener('click', function (e) { e.stopPropagation(); });
      bd.querySelectorAll('.modal-close').forEach(function (btn) {
        btn.addEventListener('click', function () { closeModal(bd); });
      });
    });

    // ayarlar
    ['autoplay', 'reduceMotion', 'dimmer'].forEach(function (k) {
      $('tgl-' + k).addEventListener('click', function () { togglePref(k); });
    });

    audio.addEventListener('ended', function () {
      state.playing = false;
      renderPlayButton();
    });

    window.addEventListener('resize', onResize);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.roundType === 'daily') fetchSolveCount(state.catId);
    });
  }

  /* ═══════════ saat döngüsü ═══════════ */
  var lastPeriodSeen = curPeriod();
  setInterval(function () {
    renderCountdown();
    if (state.roundType === 'rush' && !state.done && state.rushEnd > 0 && Date.now() >= state.rushEnd) {
      finishRush();
    }
    if (state.roundType === 'daily' && Date.now() - lastSolveCountFetch >= SOLVE_COUNT_POLL_MS &&
      (!state.done || !haveSolveCount(state.catId))) {
      fetchSolveCount(state.catId);
    }
    var p = curPeriod();
    if (p !== lastPeriodSeen) {
      lastPeriodSeen = p;
      // periyot değişti: eski günlük durumları temizle, günlük moddaysa yeni turu başlat
      state.dailyState = { v: 1, data: {} };
      saveLS(LS.daily, state.dailyState);
      if (state.roundType === 'daily') startRound(state.catId, 'daily');
      else { renderCats(); renderSummary(); }
    }
  }, 1000);

  /* ═══════════ açılış ═══════════ */
  function boot() {
    applyPrefs();
    buildMenu();
    onResize();
    bindEvents();
    $('vol-range').value = String(state.volume);
    $('vol-label').textContent = '%' + state.volume;

    if (!state.prefs.reduceMotion) {
      show($('intro'), true);
      setTimeout(function () { show($('intro'), false); }, 1300);
    }
    var seen = null;
    try { seen = localStorage.getItem(LS.seen); } catch (e) { }
    if (!seen) {
      try { localStorage.setItem(LS.seen, '1'); } catch (e) { }
      setTimeout(function () { openModal($('modal-help')); }, state.prefs.reduceMotion ? 400 : 1500);
    } else {
      // yardım modalı gösterilmeyecek (daha önce görülmüş) — spotlight'ı modalı beklemeden göster
      maybeShowSpotlight(state.prefs.reduceMotion ? 400 : 1500);
    }

    loadInitialData();
  }

  function loadInitialData() {
    loadCategories().then(function () {
      return tryMeydanParam();
    }).then(function (meydanStarted) {
      if (!meydanStarted) startRound('gunun', 'daily');
      fetchSolveCount(state.catId);
      // kart sayaçları + autocomplete havuzları için kalan kategorileri arka planda yükle
      state.cats.forEach(function (c) {
        if (CAT_ICONS[c.id]) loadSongs(c.id).then(renderCats).catch(function () { });
      });
    }).catch(function (err) {
      console.warn('Nakar: veri yüklenemedi — ' + err.message);
      showNetError(true);
    });
  }

  boot();
})();
