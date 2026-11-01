// Calendar tab: month view with muscle-colour dots, plus backup / restore.
import { state, save, exportData, parseBackup, restoreData } from './store.js';
import { CATS, catClass, esc, ICONS, toast, toKey, todayKey, fromKey, fmtDay } from './util.js';
import { saveFile } from './platform.js';

const ui = { y: null, m: null, pending: null };

function monthStats(y, m) {
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`;
  let workouts = 0, sets = 0;
  for (const [k, d] of Object.entries(state.days)) {
    if (!k.startsWith(prefix) || !d.ex?.length) continue;
    workouts++;
    for (const e of d.ex) sets += e.sets.length;
  }
  return { workouts, sets };
}

function cell(date, inMonth, today) {
  const ex = state.days[toKey(date)]?.ex || [];
  const cats = CATS.filter((c) => ex.some((e) => e.cat === c));
  const k = toKey(date);
  const plan = state.plan[k];
  const cls = [inMonth ? '' : 'out', ex.length ? 'has' : '', k === today ? 'today' : '', plan && !ex.length ? 'plan-' + (plan.status || 'planned') : ''].join(' ');
  const label = `${fmtDay(k, { weekday: 'long', month: 'long', day: 'numeric' })}${ex.length ? `, ${ex.length} exercises: ${cats.join(', ')}` : ''}${plan && !ex.length ? `, ${plan.status === 'skipped' ? 'skipped' : 'planned'}: ${plan.title}` : ''}`;
  return `<button class="${cls}" data-day="${k}" aria-label="${esc(label)}">
    <span class="d">${date.getDate()}</span>
    <span class="dots">${cats.map((c) => `<span class="dot ${catClass(c)}"></span>`).join('')}${plan && !ex.length ? '<span class="plan-mark"></span>' : ''}</span>
  </button>`;
}

export function renderCalendar(view, ctx) {
  if (ui.y === null) { const d = fromKey(ctx.date); ui.y = d.getFullYear(); ui.m = d.getMonth(); }
  const today = todayKey();
  const first = new Date(ui.y, ui.m, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const last = new Date(ui.y, ui.m + 1, 0);
  const end = new Date(last); end.setDate(last.getDate() + (6 - last.getDay()));
  const cells = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) cells.push(cell(new Date(d), d.getMonth() === ui.m, today));
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const { workouts, sets } = monthStats(ui.y, ui.m);
  const now = new Date();
  const isThisMonth = now.getFullYear() === ui.y && now.getMonth() === ui.m;
  const weekdays = [...Array(7)].map((_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }));
  const p = ui.pending;

  const root = document.createElement('div');
  root.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" data-act="prev" aria-label="Previous month">${ICONS.left}</button>
      <div class="title"><h1>${esc(monthName)}</h1></div>
      <button class="icon-btn" data-act="next" aria-label="Next month">${ICONS.right}</button>
      <button class="pill" data-act="this" ${isThisMonth ? 'disabled' : ''}>Today</button>
    </header>

    <div class="card row" style="margin-bottom:12px">
      <div class="big-stat">${workouts}</div>
      <div class="grow"><div style="font-weight:700">workout${workouts === 1 ? '' : 's'} this month</div><div class="muted small tabular">${sets} sets logged</div></div>
    </div>

    <div class="card stack" style="margin-bottom:16px">
      <div class="row"><strong class="grow">Backup</strong><span class="muted small tabular">${state.settings.lastBackup ? 'Last saved ' + esc(fmtDay(state.settings.lastBackup)) : 'Never saved'}</span></div>
      <div class="muted small">Your data lives only on this phone. The file goes to your Downloads folder (API key never included).</div>
      <div class="row">
        <button class="btn grow" data-act="backup">Save backup</button>
        <button class="btn grow" data-act="restore">Restore</button>
      </div>
      <input type="file" id="restore-file" accept="application/json,.json" hidden>
      ${p ? `
        <div class="notice warn stack">
          <div><strong>Replace all data with this backup?</strong></div>
          <div class="small tabular">Saved ${esc(new Date(p.exportedAt).toLocaleString())} · ${Object.keys(p.data.days || {}).length} workout days · ${(p.data.checkins || []).length} check-ins.</div>
          <div class="small">Everything currently on this phone will be overwritten.</div>
          <div class="row"><button class="btn ghost grow" data-act="restore-cancel">Cancel</button><button class="btn danger grow" data-act="restore-go">Replace my data</button></div>
        </div>` : ''}
    </div>
    <div class="cal-head" aria-hidden="true">${weekdays.map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="cal">${cells.join('')}</div>
    <div class="legend">${CATS.map((c) => `<span><i class="dot ${catClass(c)}"></i>${c}</span>`).join('')}<span><i class="plan-mark"></i>Planned</span></div>

  `;
  view.replaceChildren(root);

  const rerender = () => renderCalendar(view, ctx);
  const fileInput = root.querySelector('#restore-file');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      ui.pending = parseBackup(await f.text());
      rerender();
    } catch (err) {
      toast(err.message);
    }
  });

  root.addEventListener('click', async (e) => {
    const day = e.target.closest('[data-day]');
    if (day) { ctx.go('log', day.dataset.day); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'prev': ui.m--; if (ui.m < 0) { ui.m = 11; ui.y--; } rerender(); break;
      case 'next': ui.m++; if (ui.m > 11) { ui.m = 0; ui.y++; } rerender(); break;
      case 'this': ui.y = now.getFullYear(); ui.m = now.getMonth(); rerender(); break;
      case 'backup': {
        const name = `liftlog-backup-${todayKey()}.json`;
        try {
          await saveFile(name, JSON.stringify(exportData(), null, 1));
          state.settings.lastBackup = todayKey();
          save('settings');
          rerender();
          toast(`Saved ${name} to Downloads`);
        } catch (err) {
          toast('Could not save the backup: ' + err.message);
        }
        break;
      }
      case 'restore': fileInput.value = ''; fileInput.click(); break;
      case 'restore-cancel': ui.pending = null; rerender(); break;
      case 'restore-go': {
        const p2 = ui.pending;
        ui.pending = null;
        await restoreData(p2);
        rerender();
        toast('Backup restored');
        break;
      }
    }
  });
}
