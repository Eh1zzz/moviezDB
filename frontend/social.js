/* =========================================================================
   MoviezDB — social.js
   Accounts (signup / login / logout), profiles, and the data API for reviews,
   ratings & discussions — all on Supabase.

   Loaded by shared.js ONLY when SUPABASE_URL + SUPABASE_ANON_KEY are set in
   config.js. With no Supabase config the app runs exactly as before (TMDB +
   local watchlist), so this file is a pure add-on.

   Exposes: App.Auth  (auth + profile)
            App.Social (per-title reviews / ratings / discussions)
   ========================================================================= */
(function () {
  'use strict';
  const cfg = window.MOVIEZDB_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;

  const t = (k, v) => (window.App && window.App.t) ? window.App.t(k, v) : k;

  let sb = null;
  let user = null;
  const listeners = [];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  // Boot: load supabase-js (ESM via CDN), then resolve the session.
  const ready = (async () => {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await sb.auth.getSession();
    await applyUser(data.session?.user || null);
    sb.auth.onAuthStateChange((_evt, session) => applyUser(session?.user || null));
    return sb;
  })().catch(err => { console.warn('[social] init failed:', err.message); });

  async function applyUser(u) {
    user = u;
    if (u) {
      // Mirror the Supabase profile into the existing local nav profile UI.
      try {
        const { data: p } = await sb.from('profiles').select('display_name,avatar_emoji').eq('id', u.id).maybeSingle();
        const name = p?.display_name || (u.email || t('profile.defaultName')).split('@')[0];
        window.App?.Store?.setProfile({ name, initials: name.slice(0, 2).toUpperCase() });
      } catch {}
    }
    window.App?.Profile?.refresh?.();
    decorateMenu();
    listeners.forEach(fn => { try { fn(u); } catch {} });
  }

  /* ── AUTH API ─────────────────────────── */
  const Auth = {
    ready,
    get user() { return user; },
    isAuthed() { return !!user; },
    onChange(fn) { listeners.push(fn); if (sb) fn(user); },
    open() { openModal(); },
    async signUp(email, password, displayName) {
      const { error } = await sb.auth.signUp({ email, password, options: { data: { display_name: displayName || '' } } });
      if (error) throw error;
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() {
      await sb.auth.signOut();
      window.App?.Store?.setProfile({ name: t('profile.defaultName'), initials: '' });
      window.App?.Profile?.refresh?.();
    },
    async updateProfile({ display_name }) {
      if (!user) throw new Error('Not signed in');
      const { error } = await sb.from('profiles').upsert({ id: user.id, display_name }).select();
      if (error) throw error;
      await applyUser(user);
    },
  };

  // Client-side author join — attach each row's profile (avoids needing a DB
  // foreign-key/embed between reviews/discussions and profiles).
  async function attachProfiles(rows) {
    const ids = [...new Set(rows.map(r => r.user_id))];
    if (!ids.length) return rows;
    const { data } = await sb.from('profiles').select('id,display_name,avatar_emoji').in('id', ids);
    const map = {};
    (data || []).forEach(p => { map[p.id] = p; });
    return rows.map(r => ({ ...r, profile: map[r.user_id] || { display_name: t('profile.defaultName'), avatar_emoji: '🎬' } }));
  }

  /* ── SOCIAL DATA API (used by details.html) ── */
  const Social = {
    ready,
    isAuthed() { return !!user; },
    requireAuth() { if (!user) { openModal(); throw new Error('Please sign in first'); } },

    async getRatings(id, type) {
      const { data } = await sb.from('ratings').select('rating,user_id').match({ tmdb_id: id, media_type: type });
      const list = data || [];
      const avg = list.length ? list.reduce((s, r) => s + r.rating, 0) / list.length : null;
      const mine = user ? (list.find(r => r.user_id === user.id)?.rating ?? null) : null;
      return { avg, count: list.length, mine };
    },
    async setRating(id, type, rating) {
      this.requireAuth();
      const { error } = await sb.from('ratings').upsert({ user_id: user.id, tmdb_id: id, media_type: type, rating, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    async getReviews(id, type) {
      const { data, error } = await sb.from('reviews').select('id,user_id,body,created_at')
        .match({ tmdb_id: id, media_type: type }).order('created_at', { ascending: false });
      return (error || !data) ? [] : attachProfiles(data);
    },
    async addReview(id, type, body) {
      this.requireAuth();
      const { error } = await sb.from('reviews').upsert({ user_id: user.id, tmdb_id: id, media_type: type, body }, { onConflict: 'user_id,tmdb_id,media_type' });
      if (error) throw error;
    },
    async deleteReview(reviewId) {
      this.requireAuth();
      const { error } = await sb.from('reviews').delete().eq('id', reviewId);
      if (error) throw error;
    },
    async getDiscussions(id, type) {
      const { data, error } = await sb.from('discussions').select('id,user_id,body,created_at')
        .match({ tmdb_id: id, media_type: type }).order('created_at', { ascending: true });
      return (error || !data) ? [] : attachProfiles(data);
    },
    async addDiscussion(id, type, body) {
      this.requireAuth();
      const { error } = await sb.from('discussions').insert({ user_id: user.id, tmdb_id: id, media_type: type, body });
      if (error) throw error;
    },
    async deleteDiscussion(rowId) {
      this.requireAuth();
      const { error } = await sb.from('discussions').delete().eq('id', rowId);
      if (error) throw error;
    },
  };

  /* ── ACCOUNT MODAL (login / signup / profile / logout) ── */
  let modal = null;
  function buildModal() {
    modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.innerHTML = `
      <div class="auth-backdrop" data-close></div>
      <div class="auth-panel">
        <button class="auth-close" data-close aria-label="Close">✕</button>
        <div id="auth-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  }
  function openModal() { if (!modal) buildModal(); renderModal(); modal.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeModal() { modal?.classList.remove('open'); document.body.style.overflow = ''; }

  function renderModal(mode) {
    const body = modal.querySelector('#auth-body');
    if (user) {
      const name = (window.App?.Store?.getProfile?.().name) || (user.email || '').split('@')[0];
      body.innerHTML = `
        <h2 class="auth-title">${t('auth.yourAccount')}</h2>
        <p class="auth-sub">${esc(user.email || '')}</p>
        <label class="auth-label">${t('auth.displayName')}</label>
        <input class="auth-input" id="auth-name" maxlength="40" value="${esc(name)}">
        <div class="auth-err" id="auth-err"></div>
        <button class="auth-btn" id="auth-save">${t('auth.saveProfile')}</button>
        <button class="auth-btn auth-btn-ghost" id="auth-logout">${t('auth.logout')}</button>`;
      body.querySelector('#auth-save').addEventListener('click', async () => {
        const dn = body.querySelector('#auth-name').value.trim();
        if (!dn) return;
        try { await Auth.updateProfile({ display_name: dn }); window.App?.Toast?.show(t('toast.profileUpdated'), '✏️'); closeModal(); }
        catch (e) { showErr(e.message); }
      });
      body.querySelector('#auth-logout').addEventListener('click', async () => { await Auth.signOut(); closeModal(); window.App?.Toast?.show(t('toast.loggedOut'), '👋'); });
      return;
    }

    const signup = mode === 'signup';
    body.innerHTML = `
      <div class="auth-tabs">
        <button class="auth-tab ${!signup ? 'active' : ''}" data-mode="login">${t('auth.login')}</button>
        <button class="auth-tab ${signup ? 'active' : ''}" data-mode="signup">${t('auth.signup')}</button>
      </div>
      ${signup ? `<label class="auth-label">${t('auth.displayName')}</label><input class="auth-input" id="auth-dn" maxlength="40" placeholder="${t('profile.defaultName')}">` : ''}
      <label class="auth-label">${t('auth.email')}</label>
      <input class="auth-input" id="auth-email" type="email" placeholder="you@example.com" autocomplete="email">
      <label class="auth-label">${t('auth.password')}</label>
      <input class="auth-input" id="auth-pw" type="password" placeholder="${signup ? t('auth.pwHintSignup') : t('auth.pwHintLogin')}" autocomplete="${signup ? 'new-password' : 'current-password'}">
      <div class="auth-err" id="auth-err"></div>
      <button class="auth-btn" id="auth-go">${signup ? t('auth.createAccount') : t('auth.login')}</button>`;
    body.querySelectorAll('.auth-tab').forEach(tab => tab.addEventListener('click', () => renderModal(tab.dataset.mode)));
    body.querySelector('#auth-go').addEventListener('click', async () => {
      const email = body.querySelector('#auth-email').value.trim();
      const pw = body.querySelector('#auth-pw').value;
      const dn = body.querySelector('#auth-dn')?.value.trim();
      if (!email || !pw) return showErr(t('auth.enterBoth'));
      const btn = body.querySelector('#auth-go'); btn.disabled = true; btn.textContent = '…';
      try {
        if (signup) {
          await Auth.signUp(email, pw, dn);
          window.App?.Toast?.show(t('toast.accountCreated'), '🎬');
        } else {
          await Auth.signIn(email, pw);
          window.App?.Toast?.show(t('toast.welcomeBack'), '🍿');
        }
        closeModal();
      } catch (e) { showErr(e.message); btn.disabled = false; btn.textContent = signup ? t('auth.createAccount') : t('auth.login'); }
    });
  }
  function showErr(msg) { const el = modal?.querySelector('#auth-err'); if (el) el.textContent = msg; }

  /* ── PROFILE-DROPDOWN INTEGRATION ──────── */
  // Adds an "Account" entry to the nav profile dropdown built by shared.js.
  function decorateMenu() {
    const links = document.querySelector('.pd-links');
    if (!links) return;
    links.querySelectorAll('[data-social]').forEach(el => el.remove());
    const item = document.createElement('div');
    item.className = 'pd-link';
    item.dataset.social = 'account';
    item.innerHTML = user
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${t('auth.accountProfile')}`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> ${t('auth.signInUp')}`;
    item.addEventListener('click', openModal);
    links.insertBefore(item, links.firstChild);
  }
  // The dropdown is built by App.buildNav() in each page's inline script (after
  // shared.js). Our async boot resolves later, but re-tag on an interval-safe
  // micro-retry in case the menu mounts after we first run.
  let tries = 0;
  (function waitMenu() { if (document.querySelector('.pd-links')) decorateMenu(); else if (tries++ < 40) setTimeout(waitMenu, 150); })();

  window.App = window.App || {};
  window.App.Auth = Auth;
  window.App.Social = Social;
})();
