/* Sessions on the cams page: just the way to log one. Logging itself has
   its own page (log.html, log.js): area, then beach, then how it was. The
   viewer carries a link there with this spot picked. */

const FEEDBACK_URL = SURF_WORKER;   // score.js
const spotNow = (offset) => new Date(Date.now() + offset * 1000).toISOString().slice(0, 16);   // spot-local "YYYY-MM-DDTHH:MM"

const ICON_BOARD = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20c4-1 12-9 16-16-7 4-15 12-16 16z"/><path d="M8 16l2 2"/></svg>';
function renderFb(c) {
  const el = $('v-fb');
  const L = learnedSpot(c.id), n = L ? L.n : 0;
  el.hidden = false;
  el.innerHTML = `<div class="fb-row sess-open">
    <a class="fb-btn" href="log.html?spot=${encodeURIComponent(c.id)}">${ICON_BOARD}Surfed here? Log a session</a>
    <span class="fb-note">${n ? `${n} session${n > 1 ? 's' : ''} logged here` : 'Your sessions teach the scores'}</span>
  </div>`;
}
