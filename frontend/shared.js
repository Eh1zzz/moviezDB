/* =========================================
   TMDB App — shared.js
   Exports: window.App = { buildNav, Store,
     Toast, injectCardActions, Lang, Stream }
   ========================================= */
'use strict';

/* ── FAVICON (injected before anything renders) ── */
(function() {
  const link = document.createElement('link');
  link.rel = 'icon'; link.type = 'image/svg+xml'; link.href = 'favicon.svg';
  document.head.appendChild(link);
  // PNG fallback for older browsers
  const fallback = document.createElement('link');
  fallback.rel = 'icon'; fallback.type = 'image/png'; fallback.href = 'assets/moviethumbnail.png';
  document.head.appendChild(fallback);
})();

/* Apply theme IMMEDIATELY before DOM render to avoid flash */
(function() {
  const saved = localStorage.getItem('tmdb_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

(function () {

  const API_KEY = '6e3d6ad4aea48a0574572ba2f174e8bc';
  const IMG_SM  = 'https://image.tmdb.org/t/p/w92';
  const IMG_W5  = 'https://image.tmdb.org/t/p/w500';

  /* ── STORAGE ──────────────────────────── */
  const Store = {
    _get(k, d)   { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    _set(k, v)   { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },

    getProfile()   { return this._get('tmdb_profile',   { name: 'Movie Fan', initials: 'MF' }); },
    setProfile(p)  { this._set('tmdb_profile', p); },
    getWatchlist() { return this._get('tmdb_watchlist', []); },
    getFavorites() { return this._get('tmdb_favorites', []); },

    _toggle(key, item) {
      let list = this._get(key, []);
      const i  = list.findIndex(x => x.id === item.id && x.type === item.type);
      if (i > -1) { list.splice(i, 1); this._set(key, list); return false; }
      list.unshift(item); this._set(key, list); return true;
    },
    toggleWatchlist(item) { return this._toggle('tmdb_watchlist', item); },
    toggleFavorite(item)  { return this._toggle('tmdb_favorites', item); },
    inWatchlist(id, type) { return this.getWatchlist().some(x => x.id === +id && x.type === type); },
    inFavorites(id, type) { return this.getFavorites().some(x => x.id === +id && x.type === type); },

    clearWatchlist() { this._set('tmdb_watchlist', []); },
    clearFavorites() { this._set('tmdb_favorites', []); },
  };

  /* ── TOAST ────────────────────────────── */
  const Toast = {
    root: null,
    _ensure() {
      if (!this.root) {
        this.root = document.createElement('div');
        this.root.id = 'toast-root';
        document.body.appendChild(this.root);
      }
    },
    show(msg, icon = '✓', ms = 2800) {
      this._ensure();
      const el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
      this.root.appendChild(el);
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
    },
  };

  /* ── CARD ACTION BUTTONS ──────────────── */
  function injectCardActions(cardEl, id, type, titleFn) {
    if (cardEl.querySelector('.ca-fav')) return; // already done

    const fa = document.createElement('button');
    const wa = document.createElement('button');
    fa.className = `card-action ca-fav   ${Store.inFavorites(+id, type)  ? 'active-fav'   : ''}`;
    wa.className = `card-action ca-watch ${Store.inWatchlist(+id, type) ? 'active-watch' : ''}`;
    fa.title = 'Favourite';  fa.innerHTML = '♥';  fa.setAttribute('aria-label','Toggle favourite');
    wa.title = 'Watchlist';  wa.innerHTML = '🔖'; wa.setAttribute('aria-label','Toggle watchlist');

    const meta = () => ({ id: +id, type, title: titleFn?.() || '', poster: cardEl.querySelector('img')?.src || '' });

    fa.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const added = Store.toggleFavorite(meta());
      fa.classList.toggle('active-fav', added);
      Toast.show(added ? 'Added to Favourites' : 'Removed from Favourites', added ? '♥' : '💔');
      window.App?.Profile?.refresh();
    });
    wa.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const added = Store.toggleWatchlist(meta());
      wa.classList.toggle('active-watch', added);
      Toast.show(added ? 'Added to Watchlist' : 'Removed from Watchlist', added ? '🔖' : '📋');
      window.App?.Profile?.refresh();
    });

    if (getComputedStyle(cardEl).position === 'static') cardEl.style.position = 'relative';
    cardEl.appendChild(fa);
    cardEl.appendChild(wa);
  }

  /* ── SEARCH ───────────────────────────── */
  const Search = {
    wrap: null, input: null, dropdown: null, clearBtn: null,
    timer: null, idx: -1, items: [],

    init(wrap) {
      this.wrap     = wrap;
      this.input    = wrap.querySelector('.nav-search-input');
      this.dropdown = wrap.querySelector('.search-dropdown');
      this.clearBtn = wrap.querySelector('.nav-search-clear');

      this.input.addEventListener('input',   () => this._onInput());
      this.input.addEventListener('keydown', e  => this._onKey(e));
      this.input.addEventListener('focus',   () => { if (this.input.value.trim()) this.dropdown.classList.add('open'); });
      this.clearBtn.addEventListener('click', () => this.clear());

      // Global shortcut: / or Ctrl+K
      document.addEventListener('keydown', e => {
        if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) &&
            document.activeElement !== this.input) {
          e.preventDefault(); this.input.focus(); this.input.select();
        }
        if (e.key === 'Escape') { this.close(); this.input.blur(); }
      });

      document.addEventListener('click', e => {
        if (!this.wrap.contains(e.target)) this.close();
      });
    },

    _onInput() {
      const q = this.input.value.trim();
      this.clearBtn.classList.toggle('show', q.length > 0);
      clearTimeout(this.timer);
      if (!q) { this.close(); return; }
      this.dropdown.innerHTML = '<div class="dd-searching">Searching…</div>';
      this.dropdown.classList.add('open');
      this.timer = setTimeout(() => this._fetch(q), 310);
    },

    async _fetch(q) {
      try {
        const r = await fetch(
          `https://api.themoviedb.org/3/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(q)}&page=1`
        );
        const d = await r.json();
        this.items = (d.results || [])
          .filter(x => x.media_type !== 'unknown')
          .slice(0, 9);
        this._render(q);
      } catch {
        this.dropdown.innerHTML = '<div class="dd-empty">Search unavailable.</div>';
      }
    },

    _render(q) {
      if (!this.items.length) {
        this.dropdown.innerHTML = `<div class="dd-empty">No results for "<strong>${q}</strong>"</div>`;
        return;
      }
      const groups = { movie: [], tv: [], person: [] };
      this.items.forEach(x => { if (groups[x.media_type]) groups[x.media_type].push(x); });

      const labels = { movie: 'Movies', tv: 'TV Series', person: 'People' };
      let html = '';
      Object.entries(groups).forEach(([type, arr]) => {
        if (!arr.length) return;
        html += `<div class="dd-section-label">${labels[type]}</div>`;
        html += arr.map(x => this._item(x, type)).join('');
      });
      html += `<a href="search.html?q=${encodeURIComponent(q)}" class="dd-see-all">See all results →</a>`;
      this.dropdown.innerHTML = html;
      this.idx = -1;

      this.dropdown.querySelectorAll('.dd-item').forEach((el, i) => {
        el.addEventListener('mouseenter', () => {
          this.dropdown.querySelectorAll('.dd-item').forEach(e => e.classList.remove('dd-focused'));
          el.classList.add('dd-focused'); this.idx = i;
        });
      });
    },

    _item(r, type) {
      const title  = r.title || r.name || 'Unknown';
      const year   = (r.release_date || r.first_air_date || '').slice(0, 4);
      const rating = r.vote_average ? `★ ${r.vote_average.toFixed(1)}` : '';
      const dept   = r.known_for_department || '';
      const src    = (r.poster_path || r.profile_path)
        ? IMG_SM + (r.poster_path || r.profile_path)
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(title)}&background=1a1a24&color=7a7a8c&size=92`;
      const href   = type === 'person' ? `person.html?personId=${r.id}`
                   : type === 'movie'  ? `details.html?movieId=${r.id}`
                   : `details.html?seriesId=${r.id}`;
      const badge  = `<span class="dd-type dd-type-${type}">${type === 'person' ? 'Person' : type === 'movie' ? 'Movie' : 'TV'}</span>`;
      const meta   = type === 'person' ? dept : [year, rating].filter(Boolean).join(' · ');
      return `
        <a href="${href}" class="dd-item">
          <img class="dd-thumb ${type === 'person' ? 'round' : ''}" src="${src}" alt="${title}" loading="lazy">
          <div class="dd-info">
            <div class="dd-title">${title}</div>
            <div class="dd-meta">${meta}</div>
          </div>
          ${badge}
        </a>`;
    },

    _onKey(e) {
      const els = [...this.dropdown.querySelectorAll('.dd-item')];
      if (!els.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); this.idx = Math.min(this.idx + 1, els.length - 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.idx = Math.max(this.idx - 1, 0); }
      else if (e.key === 'Enter' && this.idx >= 0) { e.preventDefault(); els[this.idx].click(); return; }
      else return;
      els.forEach((el, i) => el.classList.toggle('dd-focused', i === this.idx));
      els[this.idx]?.scrollIntoView({ block: 'nearest' });
    },

    close() { this.dropdown.classList.remove('open'); },
    clear() { this.input.value = ''; this.clearBtn.classList.remove('show'); this.close(); },
  };

  /* ── PROFILE CARD ─────────────────────── */
  const Profile = {
    btn: null, drop: null, editForm: null, editInput: null,

    init(btn, drop) {
      this.btn       = btn;
      this.drop      = drop;
      this.editForm  = drop.querySelector('.pd-edit');
      this.editInput = drop.querySelector('.pd-edit-input');
      this.refresh();

      btn.addEventListener('click', e => { e.stopPropagation(); this._toggle(); });
      document.addEventListener('click', e => {
        if (!drop.contains(e.target) && e.target !== btn) this._close();
      });

      drop.querySelector('[data-pd="edit"]')       ?.addEventListener('click', () => this._openEdit());
      drop.querySelector('[data-pd="watchlist"]')  ?.addEventListener('click', () => { location.href = 'watchlist.html'; });
      drop.querySelector('[data-pd="favorites"]')  ?.addEventListener('click', () => { location.href = 'watchlist.html#favorites'; });
      drop.querySelector('[data-pd="clear"]')      ?.addEventListener('click', () => this._clearAll());
      drop.querySelector('.pd-edit-save')           ?.addEventListener('click', () => this._saveEdit());
      drop.querySelector('.pd-edit-cancel')         ?.addEventListener('click', () => this._closeEdit());
      this.editInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') this._saveEdit();
        if (e.key === 'Escape') this._closeEdit();
      });
    },

    refresh() {
      if (!this.btn) return;
      const p  = Store.getProfile();
      const wl = Store.getWatchlist().length;
      const fv = Store.getFavorites().length;
      const ini = p.initials || p.name.slice(0,2).toUpperCase();

      document.querySelectorAll('.profile-avatar, .pd-avatar-lg').forEach(el => el.textContent = ini);
          const lbl = this.btn.querySelector('.profile-label');
      if (lbl) lbl.textContent = p.name;
      const pn = this.drop?.querySelector('.pd-name');
      if (pn) pn.textContent = p.name;
      const wn = this.drop?.querySelector('[data-stat="w"]');
      const fn = this.drop?.querySelector('[data-stat="f"]');
      if (wn) wn.textContent = wl;
      if (fn) fn.textContent = fv;
    },

    _toggle() {
      const open = this.drop.classList.toggle('open');
      this.btn.classList.toggle('open', open);
      if (open) this.refresh();
    },
    _close() {
      this.drop.classList.remove('open');
      this.btn.classList.remove('open');
      this._closeEdit();
    },
    _openEdit() {
      this.editInput.value = Store.getProfile().name;
      this.editForm.classList.add('show');
      this.editInput.focus();
    },
    _closeEdit() { this.editForm?.classList.remove('show'); },
    _saveEdit() {
      const name = this.editInput.value.trim();
      if (!name) return;
      const initials = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
      Store.setProfile({ name, initials });
      this.refresh(); this._closeEdit();
      Toast.show(`Name updated to "${name}"`, '✏️');
    },
    _clearAll() {
      if (!confirm('Clear all watchlist and favourites data?')) return;
      Store.clearWatchlist(); Store.clearFavorites();
      this.refresh(); Toast.show('All data cleared', '🗑️');
    },
  };

  /* ── HAMBURGER ────────────────────────── */
  function initHamburger(burger, links, overlay) {
    if (!burger || !links) return;
    const open  = () => { links.classList.add('open'); burger.classList.add('open'); overlay?.classList.add('show'); document.body.style.overflow='hidden'; };
    const close = () => { links.classList.remove('open'); burger.classList.remove('open'); overlay?.classList.remove('show'); document.body.style.overflow=''; };
    burger.addEventListener('click', () => links.classList.contains('open') ? close() : open());
    overlay?.addEventListener('click', close);
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
    document.addEventListener('keydown', e => e.key === 'Escape' && close());
  }

  /* ── THEME ────────────────────────────── */
  const Theme = {
    current() {
      return document.documentElement.getAttribute('data-theme') || 'dark';
    },
    toggle() {
      const next = this.current() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('tmdb_theme', next);
      document.querySelectorAll('.theme-toggle').forEach(btn => {
        btn.setAttribute('aria-label', next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
        btn.setAttribute('title',      next === 'dark' ? 'Light mode' : 'Dark mode');
      });
      Toast.show(next === 'light' ? 'Light mode' : 'Dark mode', next === 'light' ? '☀️' : '🌙', 1800);
    },
    init() {
      document.addEventListener('click', e => {
        if (e.target.closest('.theme-toggle')) this.toggle();
      });
    },
  };

  /* ── LANGUAGE ─────────────────────────── */
  const LANGUAGES = [
    { code: 'en',    label: 'English',    flag: '🇬🇧' },
    { code: 'fr',    label: 'Français',   flag: '🇫🇷' },
    { code: 'es',    label: 'Español',    flag: '🇪🇸' },
    { code: 'de',    label: 'Deutsch',    flag: '🇩🇪' },
    { code: 'pt',    label: 'Português',  flag: '🇧🇷' },
    { code: 'it',    label: 'Italiano',   flag: '🇮🇹' },
    { code: 'ja',    label: '日本語',      flag: '🇯🇵' },
    { code: 'ko',    label: '한국어',      flag: '🇰🇷' },
    { code: 'zh',    label: '中文',        flag: '🇨🇳' },
    { code: 'ar',    label: 'العربية',    flag: '🇸🇦' },
    { code: 'hi',    label: 'हिन्दी',     flag: '🇮🇳' },
    { code: 'ru',    label: 'Русский',    flag: '🇷🇺' },
  ];

  const Lang = {
    _key: 'tmdb_lang',
    current()  { return localStorage.getItem(this._key) || 'en'; },
    getLabel()  {
      const l = LANGUAGES.find(l => l.code === this.current());
      return l ? `${l.flag} ${l.label}` : '🇬🇧 English';
    },
    set(code) {
      localStorage.setItem(this._key, code);
      // Reload the page with new language so TMDB API picks it up
      const url = new URL(window.location.href);
      url.searchParams.set('lang', code);
      window.location.replace(url.toString());
    },
    getApiParam() { return this.current(); },
    renderDropdown() {
      return `
        <div class="lang-dropdown" id="lang-dropdown">
          ${LANGUAGES.map(l => `
            <button class="lang-option ${l.code === this.current() ? 'active' : ''}"
                    data-lang="${l.code}">
              <span class="lang-flag">${l.flag}</span>
              <span class="lang-name">${l.label}</span>
              ${l.code === this.current() ? '<span class="lang-check">✓</span>' : ''}
            </button>`).join('')}
        </div>`;
    },
    init() {
      document.addEventListener('click', e => {
        const btn = e.target.closest('.lang-btn');
        const opt = e.target.closest('.lang-option');
        const drop = document.getElementById('lang-dropdown');

        if (btn && drop) {
          drop.classList.toggle('open');
          btn.classList.toggle('open');
          e.stopPropagation();
          return;
        }
        if (opt) {
          const code = opt.dataset.lang;
          if (code && code !== this.current()) {
            this.set(code);
          } else if (drop) {
            drop.classList.remove('open');
          }
          return;
        }
        if (drop && !drop.contains(e.target)) {
          drop.classList.remove('open');
          document.querySelector('.lang-btn')?.classList.remove('open');
        }
      });
    },
  };

  /* ── STREAM ───────────────────────────── */
  const BACKEND_URL = window.MOVIEZDB_BACKEND || 'http://localhost:3001';

  const Stream = {
    /**
     * Open the stream player modal for a given title.
     * @param {object} opts - { type:'movie'|'tv', title, tmdbId, season?, episode?, posterUrl? }
     */
    async open(opts) {
      const { type, title, tmdbId, season, episode, posterUrl } = opts;

      // Build or reuse the modal
      let modal = document.getElementById('stream-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'stream-modal';
        modal.innerHTML = `
          <div class="sm-backdrop" id="sm-backdrop"></div>
          <div class="sm-panel">
            <div class="sm-header">
              <div class="sm-title-row">
                <h2 class="sm-title" id="sm-title"></h2>
                <button class="sm-close" id="sm-close" aria-label="Close player">✕</button>
              </div>
              <div class="sm-quality-row" id="sm-quality-row"></div>
            </div>
            <div class="sm-body" id="sm-body">
              <div class="sm-loading" id="sm-loading">
                <div class="sm-spinner"></div>
                <p id="sm-loading-msg">Resolving stream…</p>
              </div>
              <div class="sm-player hidden" id="sm-player">
                <video id="sm-video" controls playsinline preload="metadata"
                       crossorigin="anonymous">
                  <p>Your browser does not support the video player.</p>
                </video>
                <div class="sm-ep-nav hidden" id="sm-ep-nav">
                  <button class="sm-ep-btn" id="sm-prev-ep">← Prev Episode</button>
                  <span id="sm-ep-label"></span>
                  <button class="sm-ep-btn" id="sm-next-ep">Next Episode →</button>
                </div>
              </div>
              <div class="sm-error hidden" id="sm-error">
                <span class="sm-error-icon">⚠️</span>
                <p id="sm-error-msg"></p>
                <button class="sm-retry-btn" id="sm-retry">Try Again</button>
              </div>
            </div>
          </div>`;
        document.body.appendChild(modal);

        document.getElementById('sm-close').addEventListener('click', () => Stream.close());
        document.getElementById('sm-backdrop').addEventListener('click', () => Stream.close());
        document.addEventListener('keydown', e => { if (e.key === 'Escape') Stream.close(); });
      }

      // Store current context for retry / episode nav
      this._ctx = { type, title, tmdbId, season: season || 1, episode: episode || 1, posterUrl };

      document.getElementById('sm-title').textContent = title;
      this._showLoading('Resolving stream…');
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';

      // Episode controls for TV
      const epNav = document.getElementById('sm-ep-nav');
      if (type === 'tv' && season && episode) {
        document.getElementById('sm-ep-label').textContent = `S${season} E${episode}`;
        epNav.classList.remove('hidden');
        document.getElementById('sm-prev-ep').onclick = () => this._changeEpisode(-1);
        document.getElementById('sm-next-ep').onclick = () => this._changeEpisode(+1);
      } else {
        epNav?.classList.add('hidden');
      }

      // Quality selector
      document.getElementById('sm-quality-row').innerHTML = ['480p','720p','1080p'].map(q =>
        `<button class="sm-q-btn ${q === '1080p' ? 'active' : ''}" data-quality="${q}">${q}</button>`
      ).join('');
      document.getElementById('sm-quality-row').addEventListener('click', e => {
        const btn = e.target.closest('.sm-q-btn');
        if (!btn) return;
        document.querySelectorAll('.sm-q-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._ctx.quality = btn.dataset.quality;
        this._resolve();
      });

      document.getElementById('sm-retry').addEventListener('click', () => this._resolve());
      await this._resolve();
    },

    async _resolve() {
      const { type, title, season, episode, quality } = this._ctx;
      this._showLoading('Resolving stream…');
      try {
        const res  = await fetch(`${BACKEND_URL}/api/stream/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, title, season, episode, quality: quality || '1080p' }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Could not resolve stream.');
        this._play(data.url);
      } catch (err) {
        this._showError(err.message);
      }
    },

    _play(url) {
      const video = document.getElementById('sm-video');
      const isHLS = url.includes('.m3u8');
      if (isHLS && window.Hls?.isSupported()) {
        const hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(video);
      } else {
        video.src = url;
      }
      this._showPlayer();
      video.play().catch(() => {});
    },

    _changeEpisode(delta) {
      const ctx = this._ctx;
      ctx.episode = Math.max(1, ctx.episode + delta);
      document.getElementById('sm-ep-label').textContent = `S${ctx.season} E${ctx.episode}`;
      document.getElementById('sm-video').pause();
      this._resolve();
    },

    close() {
      const modal = document.getElementById('stream-modal');
      if (!modal) return;
      modal.classList.remove('open');
      document.body.style.overflow = '';
      const video = document.getElementById('sm-video');
      if (video) { video.pause(); video.src = ''; }
    },

    _showLoading(msg) {
      document.getElementById('sm-loading').classList.remove('hidden');
      document.getElementById('sm-player').classList.add('hidden');
      document.getElementById('sm-error').classList.add('hidden');
      document.getElementById('sm-loading-msg').textContent = msg;
    },
    _showPlayer() {
      document.getElementById('sm-loading').classList.add('hidden');
      document.getElementById('sm-player').classList.remove('hidden');
      document.getElementById('sm-error').classList.add('hidden');
    },
    _showError(msg) {
      document.getElementById('sm-loading').classList.add('hidden');
      document.getElementById('sm-player').classList.add('hidden');
      document.getElementById('sm-error').classList.remove('hidden');
      document.getElementById('sm-error-msg').textContent = msg;
    },
  };

  /* ── NAV BUILDER ──────────────────────── */
  function buildNav(activePage) {
    const nav = document.getElementById('app-nav');
    if (!nav) return;

    nav.innerHTML = `
      <a href="index.html" class="nav-logo" aria-label="MoviezDB Home">MoviezDB</a>

      <div class="nav-links" id="nav-links" role="navigation" aria-label="Main">
        <a href="index.html"  class="${activePage==='movies' ?'nav-active':''}">Movies</a>
        <a href="series.html" class="${activePage==='series' ?'nav-active':''}">TV Series</a>
      </div>

      <!-- Search -->
      <div class="nav-search" id="nav-search-wrap" role="search">
        <div class="nav-search-box">
          <span class="nav-search-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </span>
          <input id="nav-search-input" class="nav-search-input" type="search" placeholder="Search movies, shows, people…"
                 autocomplete="off" spellcheck="false" aria-label="Search">
          <span class="nav-search-kbd" aria-hidden="true">⌘K</span>
          <button class="nav-search-clear" aria-label="Clear" tabindex="-1">×</button>
        </div>
        <div class="search-dropdown" role="listbox" aria-label="Search results"></div>
      </div>

      <!-- Theme toggle + Lang + Profile -->
      <div class="nav-actions">
        <!-- Theme toggle -->
        <button class="theme-toggle"
                aria-label="${Theme.current() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}"
                title="${Theme.current() === 'dark' ? 'Light mode' : 'Dark mode'}">
          <svg class="tt-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <svg class="tt-sun"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        </button>

        <!-- Language switcher -->
        <div style="position:relative">
          <button class="lang-btn" aria-label="Switch language" title="Language">
            <span class="lang-current">${Lang.getLabel()}</span>
            <span class="lang-caret" aria-hidden="true">▾</span>
          </button>
          ${Lang.renderDropdown()}
        </div>

        <!-- Profile -->
        <div style="position:relative">
          <button class="profile-btn" id="profile-btn" aria-haspopup="true" aria-label="Profile menu">
            <div class="profile-avatar" aria-hidden="true">MF</div>
            <span class="profile-label">Movie Fan</span>
            <span class="profile-caret" aria-hidden="true">▾</span>
          </button>
          <div class="profile-dropdown" id="profile-dropdown" role="dialog" aria-label="Profile">
            <div class="pd-head">
              <div class="pd-avatar-lg" aria-hidden="true">MF</div>
              <div>
                <div class="pd-name">Movie Fan</div>
                <div class="pd-sub">Local · TMDB</div>
              </div>
            </div>
            <div class="pd-stats">
              <div class="pd-stat">
                <div class="pd-stat-n" data-stat="w">0</div>
                <div class="pd-stat-l">Watchlist</div>
              </div>
              <div class="pd-stat">
                <div class="pd-stat-n" data-stat="f">0</div>
                <div class="pd-stat-l">Favourites</div>
              </div>
            </div>
            <div class="pd-links">
              <div class="pd-link" data-pd="watchlist">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                My Watchlist
              </div>
              <div class="pd-link" data-pd="favorites">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                My Favourites
              </div>
              <div class="pd-link" data-pd="edit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit Display Name
              </div>
              <div class="pd-link danger" data-pd="clear">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                Clear All Data
              </div>
            </div>
            <div class="pd-edit">
              <input class="pd-edit-input" type="text" placeholder="Your display name" maxlength="28">
              <div class="pd-edit-row">
                <button class="pd-edit-save">Save</button>
                <button class="pd-edit-cancel">Cancel</button>
              </div>
            </div>
          </div>
        </div>

        <button class="nav-hamburger" id="nav-hamburger" aria-label="Menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
      </div>

      <div class="nav-mobile-overlay" id="nav-overlay" aria-hidden="true"></div>
    `;

    // Init all sub-systems
    Search.init(document.getElementById('nav-search-wrap'));
    Profile.init(
      document.getElementById('profile-btn'),
      document.getElementById('profile-dropdown')
    );
    initHamburger(
      document.getElementById('nav-hamburger'),
      document.getElementById('nav-links'),
      document.getElementById('nav-overlay')
    );
    Theme.init();
    Lang.init();

    // Smooth-scroll same-page links
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const t = document.querySelector(a.getAttribute('href'));
        if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
      });
    });
  }

  /* ── EXPOSE ───────────────────────────── */
  window.App = { buildNav, Store, Toast, Profile, Theme, Lang, Stream, injectCardActions };

})();
