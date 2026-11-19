// App shell: loads data, switches tabs, registers the service worker.
import { load, flush } from './store.js';
import { todayKey, isValidKey, toast, esc } from './util.js';
import { renderLog } from './log.js';
import { renderCalendar } from './calendar.js';
import { renderBody } from './body.js';
import { renderCoach } from './coach.js';
import { renderSettings } from './settings.js';
import { initLiveUpdates } from './updater.js';

const view = document.getElementById('view');
const ctx = {
  tab: 'log',
  prevTab: 'log',
  date: todayKey(),
  go(tab, date) {
    if (date && isValidKey(date)) ctx.date = date;
    if (tab === 'settings' && ctx.tab !== 'settings') ctx.prevTab = ctx.tab;
    ctx.tab = tab;
    render();
    window.scrollTo(0, 0);
  },
  setDate(date) { ctx.go('log', date); },
};

const RENDER = { log: renderLog, calendar: renderCalendar, body: renderBody, coach: renderCoach, settings: renderSettings };

function render() {
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.tab === ctx.tab) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  try {
    RENDER[ctx.tab](view, ctx);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="notice warn">Something went wrong: ${esc(err.message)}</div>`;
  }
}

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (t) ctx.go(t.dataset.tab);
});

// If the app is left open past midnight, "today" moves on when you come back to it.
let lastToday = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = todayKey();
  if (t !== lastToday) {
    if (ctx.date === lastToday) ctx.date = t;
    lastToday = t;
    render();
  }
});

await load();
render();
initLiveUpdates();

// Updates: app files are fetched fresh whenever you open the app (see sw.js). If the
// offline worker itself changes, reload automatically once it is safe — saved data
// stays in IndexedDB, so nothing is lost.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !self.Capacitor?.isNativePlatform?.()) {
  const hadController = !!navigator.serviceWorker.controller;
  const regP = navigator.serviceWorker.register('sw.js').catch(() => null);
  const typing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value; };
  let pending = false;
  const reloadWhenSafe = async () => {
    if (self.__liftlogBusy || typing()) { pending = true; return; }
    pending = false;
    await flush();
    try { sessionStorage.setItem('liftlog:updated', '1'); } catch { /* ignore */ }
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) reloadWhenSafe(); });
  // Check for a new version each time the app comes back to the screen.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (pending) return reloadWhenSafe();
    (await regP)?.update().catch(() => {});
  });
  document.addEventListener('focusout', () => { if (pending) setTimeout(reloadWhenSafe, 500); });
  try { if (sessionStorage.getItem('liftlog:updated')) { sessionStorage.removeItem('liftlog:updated'); toast('Updated to the latest version'); } } catch { /* ignore */ }
}
