/* Accounts and favourite spots, shared by the surf pages (account.css styles
   the forms). Load after score.js (esc, SURF_WORKER).

   An account is a name and a password (tools/worker/accounts.js). Signing
   in keeps a token on this device, so it stays signed in. Sign-up shows a
   recovery code once; with it the person sets a new password themselves,
   otherwise Oli resets it.

   Account.mount(el, { reason, onChange }) renders the account line or the
   open form into `el` and handles it; call it again whenever the page
   re-renders that spot (typed values carry over). onChange(event, then)
   hears 'in' (signed in; `then` is whatever Account.open was given) and
   'out'.

   Favourites: the person's spots, in their order. Kept on the device and,
   when signed in, on the account, so every device they sign in on shows the
   same list (the account's copy wins, unless this device changed its list
   while offline). Account.favs.list() / has(id) / toggle(id) / save(list) /
   sync() / onChange(fn). */
const Account = (() => {
  const KEY = 'surf-account', FAV_KEY = 'surf-favs', FAV_DIRTY = 'surf-favs-dirty';
  const api = (path) => SURF_WORKER.replace(/\/$/, '') + path;
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} },
  };
  const get = () => { try { const a = JSON.parse(ls.get(KEY) || 'null'); return a && a.token && a.name ? a : null; } catch { return null; } };
  const set = (a) => ls.set(KEY, a ? JSON.stringify({ name: a.name, token: a.token }) : null);

  // The device: a random id made here, plus its kind, system and browser.
  // Goes with sign-ins and sessions and stays private in the worker.
  function device() {
    let id = ls.get('surf-device') || '';
    if (!/^[a-f0-9-]{16,40}$/.test(id)) {
      id = crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      ls.set('surf-device', id);
    }
    const ua = navigator.userAgent || '';
    const os = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPadOS' : /iPhone|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
      : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'other';
    const browser = /SamsungBrowser/.test(ua) ? 'Samsung' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
      : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'other';
    const kind = os === 'iPadOS' || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet' : /Mobi|iPhone|Android/.test(ua) ? 'phone' : 'desktop';
    return { id, kind, os, browser };
  }

  const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.?!]$/.test(s) ? '' : '.');
  // A call to the worker as this account; { error, status } when it fails.
  async function call(method, path, body) {
    const me = get(), headers = {};
    if (me) headers.Authorization = 'Bearer ' + me.token;
    if (body) headers['Content-Type'] = 'application/json';
    try {
      const r = await fetch(api(path), { method, headers, body: body ? JSON.stringify({ ...body, dev: device() }) : undefined });
      const j = await r.json().catch(() => ({}));
      // The token's gone (signed out elsewhere, password changed): forget it here too.
      if (r.status === 401 && me && j.error === 'signed out') { set(null); fire('out'); }
      return r.ok ? j : { error: j.error ? sentence(j.error) : `The server said no (${r.status}).`, status: r.status };
    } catch { return { error: 'Couldn’t reach the server. Check your connection.' }; }
  }
  const post = (path, body) => call('POST', path, body || {});

  /* ---------- The form ---------- */
  let st = null;     // the open form: { mode: 'in' | 'up' | 'forgot' | 'pw' | 'code', msg, note, busy, code, then, opened }
  let host = null, opts = {};
  const listeners = new Set();
  const fire = (ev, then) => { if (opts.onChange) opts.onChange(ev, then); for (const fn of listeners) fn(ev); };
  const open = (mode, extra = {}) => { st = { mode, msg: '', note: '', busy: false, code: '', then: null, opened: Date.now(), ...extra }; render(); focus(); };
  const close = () => { st = null; render(); };
  const focus = () => requestAnimationFrame(() => { const i = host && host.querySelector('input:not([hidden]):not(.acct-hp)'); if (i) i.focus(); });
  // The name given on this device before accounts, offered at sign-up.
  const oldName = () => ls.get('surf-name') || '';

  function html() {
    const me = get();
    if (!st) {
      return me
        ? `<div class="acct-line">Signed in as <b>${esc(me.name)}</b> · <button class="acct-link" type="button" data-acct="pw">change password</button> · <button class="acct-link" type="button" data-acct="out">sign out</button></div>`
        : `<div class="acct-line"><button class="acct-link" type="button" data-acct="in">Sign in</button> or <button class="acct-link" type="button" data-acct="up">create an account</button> ${esc(opts.reason || '')}</div>`;
    }
    const x = `<button class="acct-x" type="button" data-acct="close" aria-label="Close">✕</button>`;
    if (st.mode === 'code') {
      return `<div class="acct">
        <div class="acct-head"><span class="acct-title">Your recovery code</span></div>
        <div class="acct-code" id="acct-code">${esc(st.code)}</div>
        <p class="acct-note">Keep it somewhere safe: a note, a photo, your password manager. It’s how you set a new password if you forget yours, and it won’t be shown again. Lost it? Ask Oli to reset your password.</p>
        <div class="acct-row"><button class="acct-btn ghost" type="button" data-acct="copy">Copy</button><button class="acct-btn" type="button" data-acct="saved">I’ve saved it</button></div>
      </div>`;
    }
    const field = (name, label, type, auto, extra = '') =>
      `<label class="acct-f"><span>${label}</span><input class="acct-in" name="${name}" type="${type}" autocomplete="${auto}" ${extra} required></label>`;
    const nameF = (v = '') => field('username', 'Name', 'text', 'username', `maxlength="30" autocapitalize="words" spellcheck="false" value="${esc(v)}"`);
    const forms = {
      in: { title: 'Sign in', body: nameF() + field('password', 'Password', 'password', 'current-password', 'minlength="8" maxlength="200"'), go: 'Sign in',
        links: `<button class="acct-link" type="button" data-acct="up">Create an account</button> · <button class="acct-link" type="button" data-acct="forgot">Forgot password?</button>` },
      up: { title: 'Create an account', body: nameF(oldName()) + field('password', 'Password', 'password', 'new-password', 'minlength="8" maxlength="200" placeholder="8 characters or more"')
          + '<input class="acct-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">', go: 'Create account',
        links: `Already have one? <button class="acct-link" type="button" data-acct="in">Sign in</button>`,
        note: 'Your name is kept private: only Oli sees it, never shown on the site.' },
      forgot: { title: 'Set a new password', body: nameF() + field('code', 'Recovery code', 'text', 'off', 'maxlength="24" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"')
          + field('password', 'New password', 'password', 'new-password', 'minlength="8" maxlength="200"'), go: 'Set password',
        links: `<button class="acct-link" type="button" data-acct="in">Back to sign in</button>`,
        note: 'Use the recovery code you saved when you signed up. No code? Ask Oli to reset your password.' },
      pw: { title: 'Change password', body: `<input type="text" name="username" autocomplete="username" value="${esc(me ? me.name : '')}" hidden>`
          + field('old', 'Current password', 'password', 'current-password', 'maxlength="200"') + field('password', 'New password', 'password', 'new-password', 'minlength="8" maxlength="200"'), go: 'Change password',
        links: `<button class="acct-link" type="button" data-acct="forgot">Forgot it?</button>`,
        note: 'Signs you out on your other devices.' },
    };
    const f = forms[st.mode];
    return `<form class="acct" data-acct-form novalidate>
      <div class="acct-head"><span class="acct-title">${f.title}</span>${x}</div>
      ${st.note ? `<p class="acct-note">${esc(st.note)}</p>` : ''}
      <div class="acct-fields">${f.body}</div>
      ${st.msg ? `<div class="acct-err">${esc(st.msg)}</div>` : ''}
      <div class="acct-row"><button class="acct-btn" type="submit"${st.busy ? ' disabled' : ''}>${st.busy ? 'One moment…' : f.go}</button></div>
      <div class="acct-note">${f.links}</div>
      ${f.note ? `<div class="acct-note">${f.note}</div>` : ''}
    </form>`;
  }

  // What's been typed (and where), so a re-render — or the page rebuilding
  // the panel around it — doesn't lose it.
  const typedIn = (el) => {
    const form = el && el.querySelector('[data-acct-form]');
    return form ? { vals: [...form.querySelectorAll('input')].map((i) => [i.name, i.value]), focused: document.activeElement && form.contains(document.activeElement) ? document.activeElement.name : null } : null;
  };
  function render(from) {
    if (!host) return;
    const typed = typedIn(from || host);
    host.innerHTML = html();
    const form = host.querySelector('[data-acct-form]');
    if (form && typed) {
      for (const [n, v] of typed.vals) { const i = form.elements[n]; if (i && v && i.type !== 'hidden') i.value = v; }
      if (typed.focused && form.elements[typed.focused]) form.elements[typed.focused].focus();
    }
  }
  function mount(el, o = {}) {
    const prev = host;
    host = el; opts = o;
    el.onclick = click;
    el.onsubmit = (e) => { e.preventDefault(); if (st && !st.busy) submit(e.target); };
    render(prev && prev !== el ? prev : null);
  }

  async function submit(form) {
    const v = (n) => (form.elements[n] ? form.elements[n].value : '');
    const name = v('username').normalize('NFC').replace(/\s+/g, ' ').trim(), pw = v('password');
    const bad = st.mode !== 'pw' && !/^[\p{L}\p{M}\p{N} .'’_-]{2,30}$/u.test(name) ? 'Names are 2–30 letters, numbers, spaces and . \' - _'
      : pw.length < 8 ? 'Passwords need at least 8 characters.'
      : st.mode === 'forgot' && v('code').replace(/[^a-z0-9]/gi, '').length !== 16 ? 'The recovery code is 16 letters and numbers.' : '';
    if (bad) { st.msg = bad; return render(); }
    st.busy = true; st.msg = ''; render();
    const body = st.mode === 'in' ? { name, password: pw }
      : st.mode === 'up' ? { name, password: pw, hp: v('website'), dt: Date.now() - st.opened }
      : st.mode === 'forgot' ? { name, code: v('code'), password: pw }
      : { old: v('old'), password: pw };
    const path = { in: '/a/login', up: '/a/signup', forgot: '/a/recover', pw: '/a/password' }[st.mode];
    const j = await post(path, body);
    st.busy = false;
    if (j.error) {
      if (st.mode === 'pw' && j.status === 401 && /signed out/i.test(j.error)) open('in', { note: 'You’ve been signed out. Sign in again.' });
      else { st.msg = j.error; render(); }
      return;
    }
    set({ name: j.name, token: j.token });
    ls.set('surf-name', null); ls.set('surf-name-skip', null);
    favs.sync();
    const then = st.then;
    if (j.recovery) open('code', { code: j.recovery, then });
    else done(then);
  }
  // Signed in: tell the page, which carries on to whatever asked for it.
  function done(then) { st = null; render(); fire('in', then); }

  async function click(e) {
    const b = e.target.closest('[data-acct]');
    if (!b) return;
    const what = b.dataset.acct;
    if (what === 'close') return close();
    if (what === 'out') { post('/a/logout'); set(null); st = null; render(); return fire('out'); }
    if (what === 'copy') {
      try { await navigator.clipboard.writeText(st.code); b.textContent = 'Copied'; } catch { const t = document.getElementById('acct-code'); if (t) getSelection().selectAllChildren(t); }
      return;
    }
    if (what === 'saved') return done(st.then);
    open(what, { then: st && st.then, note: st && st.mode === what ? st.note : '' });
  }

  /* ---------- Favourites ---------- */
  const favs = (() => {
    const fns = new Set();
    const known = () => new Set(CAMS.map((c) => c.id));
    const list = () => { try { const l = JSON.parse(ls.get(FAV_KEY) || '[]'); return Array.isArray(l) ? l.filter((id) => known().has(id)) : []; } catch { return []; } };
    const changed = () => { for (const fn of fns) fn(list()); };
    let timer = 0;
    // Keep it here at once; tell the account a moment later (one call for a burst of edits).
    function save(l, quiet) {
      ls.set(FAV_KEY, JSON.stringify([...new Set(l)]));
      if (!quiet) changed();
      if (!get()) return;
      ls.set(FAV_DIRTY, '1');
      clearTimeout(timer);
      timer = setTimeout(push, 500);
    }
    async function push() {
      const j = await post('/a/favs', { favs: list() });
      if (!j.error) ls.set(FAV_DIRTY, null);
    }
    // On sign-in and page load: the account's list wins, unless this
    // device changed its own since (then it goes up).
    async function sync() {
      if (!get()) return list();
      if (ls.get(FAV_DIRTY)) { await push(); return list(); }
      const j = await call('GET', '/a/favs');
      if (j.error) return list();
      if (j.favs && j.favs.length) { ls.set(FAV_KEY, JSON.stringify(j.favs)); changed(); }
      else if (list().length) await push();
      return list();
    }
    return {
      list, sync, save,
      has: (id) => list().includes(id),
      toggle: (id) => { const l = list(), on = !l.includes(id); save(on ? [...l, id] : l.filter((x) => x !== id)); return on; },
      onChange: (fn) => fns.add(fn),
    };
  })();

  /* ---------- The toolbar's account button ----------
     In the bar's options (the ⋯ menu on phones): your name, or "Sign in".
     It opens a small panel with the account line or form, and a way to
     your spots on the 7-day page. */
  const ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  function toolbar() {
    const more = document.getElementById('more');
    if (!more || document.getElementById('acct-btn')) return;
    const btn = document.createElement('button');
    Object.assign(btn, { className: 'acct-tb', id: 'acct-btn', type: 'button', title: 'Your account' });
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    more.appendChild(btn);
    const pop = document.createElement('div');
    Object.assign(pop, { className: 'acct-pop', id: 'acct-pop', hidden: true });
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Account');
    document.body.appendChild(pop);
    const label = () => { const me = get(); btn.innerHTML = `${ICON}<span>${me ? esc(me.name) : 'Sign in'}</span>`; };
    const foot = () => {
      const f = pop.querySelector('.acct-pop-foot'), n = favs.list().length;
      if (f) f.innerHTML = /week\.html/.test(location.pathname) ? '' : `<a href="week.html">${n ? `My spots (${n})` : 'Pick my spots'} on the 7-day page →</a>`;
    };
    function show(on) {
      pop.hidden = !on;
      btn.setAttribute('aria-expanded', on);
      if (!on) return;
      // On phones the button sits in the ⋯ menu: fold that away behind it.
      const ctl = document.getElementById('controls'), mb = document.getElementById('more-btn');
      if (ctl) ctl.classList.remove('more-open');
      if (mb) mb.setAttribute('aria-expanded', 'false');
      pop.innerHTML = '<div class="acct-pop-head"><b>Account</b><button class="acct-x" type="button" data-pop-x aria-label="Close">✕</button></div><div class="acct-pop-body"></div><div class="acct-pop-foot"></div>';
      mount(pop.querySelector('.acct-pop-body'), { reason: 'to log sessions and keep your spots on every device.', onChange: () => { label(); foot(); } });
      if (!get() && !st) open('in');
      foot();
    }
    btn.addEventListener('click', (e) => { e.stopPropagation(); show(pop.hidden); });
    pop.addEventListener('click', (e) => { e.stopPropagation(); if (e.target.closest('[data-pop-x]')) show(false); });
    document.addEventListener('click', (e) => { if (!pop.hidden && !e.target.closest('#acct-pop, #acct-btn')) show(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) show(false); });
    listeners.add(label);
    favs.onChange(foot);
    label();
  }
  toolbar();

  return { get, set, device, api, post, call, open, close, mount, render, isOpen: () => !!st, onChange: (fn) => listeners.add(fn), favs };
})();
