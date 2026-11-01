// App shell: loads data, switches tabs, registers the service worker.
import { load } from './store.js';
import { todayKey, isValidKey, toast, esc } from './util.js';
import { renderLog } from './log.js';
import { renderCalendar } from './calendar.js';
import { renderBody } from './body.js';
import { renderCoach } from './coach.js';
import { renderSettings } from './settings.js';

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

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('App updated', { label: 'Reload', run: () => location.reload() });
  });
}
