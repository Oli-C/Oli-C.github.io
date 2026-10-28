/* The surf toolbar's shared behaviour (see toolbar.css): the phones' ⋯
   menu, Enter folding the search, and what the search matches. Load
   after score.js (for norm). Each page wires its own filtering. */

// Every word typed must turn up somewhere in the spot's name, town, area,
// zone, country, source or tags; accents and case don't matter.
const spotHaystack = (c) => norm([c.name, c.town, c.area, c.zone, c.country, c.source, ...(c.tags || [])].join(' '));
function spotMatches(c, query, area) {
  const terms = norm((query || '').trim()).split(/\s+/).filter(Boolean);
  const hay = spotHaystack(c);
  return (!area || area === 'All' || c.area === area) && terms.every((t) => hay.includes(t));
}

(() => {
  const controls = document.getElementById('controls');
  const btn = document.getElementById('more-btn');
  const q = document.getElementById('q');
  if (controls && btn) {
    const setMore = (on) => {
      controls.classList.toggle('more-open', on);
      btn.setAttribute('aria-expanded', on);
    };
    btn.addEventListener('click', () => setMore(!controls.classList.contains('more-open')));
    document.addEventListener('click', (e) => { if (!e.target.closest('#more, #more-btn')) setMore(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMore(false); });
    matchMedia('(max-width: 700px)').addEventListener('change', () => setMore(false));
  }
  // Enter puts the keyboard away (and folds the field on phones); results
  // have already filtered as you typed.
  if (q) q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); q.blur(); } });
})();
