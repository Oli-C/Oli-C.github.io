/* The site's own counter (tools/tally): a view per page load, and a click
   for each link out (or any link pill), named by its label. No cookies,
   nothing kept in the browser; off for Do Not Track, automated browsers
   and local copies. Pages can count their own moments: tally('play', 'Featured set'). */
(() => {
  const URL_ = 'https://allfield-tally.odj-clarke.workers.dev/t';
  if (navigator.doNotTrack === '1' || navigator.webdriver || !/allfield\.online$/.test(location.hostname)) {
    window.tally = () => {};
    return;
  }
  const send = (k, l) => {
    let r = '';
    if (k === 'view') try { r = document.referrer ? new URL(document.referrer).hostname : ''; } catch {}
    const body = JSON.stringify({ k, p: location.pathname, l: l || '', r, w: innerWidth });
    try { if (!navigator.sendBeacon(URL_, body)) fetch(URL_, { method: 'POST', body, keepalive: true, mode: 'no-cors' }); } catch {}
  };
  window.tally = send;
  send('view');
  // Link pills carry their name in aria-label ("Surf cams — live cams…" → "Surf cams").
  const name = (a, u) => (a.getAttribute('aria-label') || '').split(' — ')[0] || a.textContent.trim().slice(0, 60) || u.hostname;
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (u.protocol === 'mailto:') send('click', 'Email');
    else if (u.hostname !== location.hostname || a.dataset.platform) send('click', name(a, u));
  }, true);
})();
