// Log tab: one day's workout.
import { state, save } from './store.js';
import {
  CATS, SEED, catClass, esc, uid, num, fmtNum, normName, nameKey, ICONS, toast, twoStep,
  todayKey, addDays, fmtDay, relDay, isValidKey,
} from './util.js';

const ui = { addCat: 'Other', catTouched: false, copyOpen: false, copyDate: '' };

// ---------- Data helpers ----------
const dayEx = (date) => state.days[date]?.ex || [];
function ensureDay(date) {
  if (!state.days[date]) state.days[date] = { ex: [] };
  return state.days[date];
}
function tidy(date) {
  if (state.days[date] && state.days[date].ex.length === 0) delete state.days[date];
}
const isCardio = (ex) => ex.cat === 'Cardio';
const blankSet = (ex) => (isCardio(ex) ? { mi: null, min: null } : { w: null, r: null });

export function lastSession(name, beforeDate) {
  const key = nameKey(name);
  const dates = Object.keys(state.days).filter((d) => d < beforeDate).sort().reverse();
  for (const d of dates) {
    const ex = dayEx(d).find((e) => nameKey(e.name) === key && e.sets.length);
    if (ex) return { date: d, ex };
  }
  return null;
}

function previousWorkoutDate(date) {
  return Object.keys(state.days).filter((d) => d < date && dayEx(d).length).sort().pop() || null;
}

function libraryEntries() {
  const map = new Map();
  for (const [cat, names] of Object.entries(SEED)) for (const n of names) map.set(nameKey(n), { name: n, cat, last: '' });
  for (const [k, v] of Object.entries(state.library)) map.set(k, { ...map.get(k), ...v });
  return [...map.values()];
}

function suggestions(q) {
  const all = libraryEntries();
  const query = nameKey(q);
  if (!query) {
    return all.filter((e) => e.last).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 6);
  }
  const starts = [], contains = [];
  for (const e of all) {
    const k = nameKey(e.name);
    if (k === query) continue;
    if (k.startsWith(query) || k.split(' ').some((w) => w.startsWith(query))) starts.push(e);
    else if (k.includes(query)) contains.push(e);
  }
  const byUse = (a, b) => (b.last || '').localeCompare(a.last || '') || a.name.localeCompare(b.name);
  return [...starts.sort(byUse), ...contains.sort(byUse)].slice(0, 6);
}

function remember(name, cat, date) {
  const k = nameKey(name);
  const prev = state.library[k];
  state.library[k] = { name: prev?.name || name, cat, last: !prev?.last || date > prev.last ? date : prev.last };
  save('library');
}

function prefillFor(ex, date) {
  if (ex.sets.length) return { ...ex.sets[ex.sets.length - 1] };
  const last = lastSession(ex.name, date);
  if (last) {
    const s = last.ex.sets[0];
    return isCardio(ex) ? { mi: s.mi ?? null, min: s.min ?? null } : { w: s.w ?? null, r: s.r ?? null };
  }
  return blankSet(ex);
}

function addExercise(date, rawName, cat) {
  const name = normName(rawName);
  if (!name) return null;
  const known = state.library[nameKey(name)] || libraryEntries().find((e) => nameKey(e.name) === nameKey(name));
  const ex = { id: uid(), name: known?.name || name, cat, sets: [] };
  ex.sets.push(prefillFor(ex, date));
  ensureDay(date).ex.push(ex);
  remember(ex.name, cat, date);
  save('days');
  return ex;
}

export function copyDay(fromDate, toDate) {
  const src = dayEx(fromDate);
  if (!src.length) return 0;
  const dst = ensureDay(toDate);
  for (const e of src) {
    dst.ex.push({ id: uid(), name: e.name, cat: e.cat, sets: e.sets.map((s) => ({ ...s })) });
    remember(e.name, e.cat, toDate);
  }
  save('days');
  return src.length;
}

// ---------- Rendering ----------
function setsSummary(ex) {
  return ex.sets.map((s) => (isCardio(ex) ? `${fmtNum(s.mi, 2) || '–'} mi/${fmtNum(s.min) || '–'} min` : `${fmtNum(s.w) || '–'}×${fmtNum(s.r, 0) || '–'}`)).join(', ');
}

function setRow(ex, s, i) {
  const c = isCardio(ex);
  const a = c ? ['mi', s.mi, 'mi', 'decimal', 2] : ['w', s.w, 'lb ×', 'decimal', 1];
  const b = c ? ['min', s.min, 'min', 'decimal', 1] : ['r', s.r, 'reps', 'numeric', 0];
  const input = ([f, v, , mode, dp], label) =>
    `<input class="num" data-f="${f}" inputmode="${mode}" enterkeyhint="next" autocomplete="off" aria-label="${label} set ${i + 1}" value="${esc(fmtNum(v, dp))}" placeholder="0">`;
  return `<li class="set" data-set="${i}">
    <span class="idx">${i + 1}</span>
    ${input(a, c ? 'Miles' : 'Weight')}<span class="unit">${a[2]}</span>
    ${input(b, c ? 'Minutes' : 'Reps')}<span class="unit">${b[2]}</span>
    <button class="icon-btn" data-act="del-set" aria-label="Delete set ${i + 1}">${ICONS.x}</button>
  </li>`;
}

function exCard(ex, date) {
  const last = lastSession(ex.name, date);
  return `<section class="card ex ${catClass(ex.cat)}" data-ex="${ex.id}">
    <div class="ex-head">
      <div class="grow"><div class="ex-name">${esc(ex.name)}</div></div>
      <span class="chip-cat">${esc(ex.cat)}</span>
      <button class="icon-btn" data-act="del-ex" aria-label="Delete ${esc(ex.name)}">${ICONS.trash}</button>
    </div>
    ${last ? `<div class="ex-last tabular">Last · ${esc(fmtDay(last.date, { month: 'short', day: 'numeric' }))}: ${esc(setsSummary(last.ex))}</div>` : ''}
    <ol class="sets">${ex.sets.map((s, i) => setRow(ex, s, i)).join('')}</ol>
    <div class="ex-foot"><button class="btn ghost grow" data-act="add-set">+ Add set</button></div>
  </section>`;
}

function catButtons() {
  return CATS.map((c) => `<button type="button" class="${catClass(c)}" data-cat="${c}" aria-pressed="${ui.addCat === c}"><span class="dot"></span>${c}</button>`).join('');
}

export function renderLog(view, ctx) {
  const date = ctx.date;
  const exs = dayEx(date);
  const today = todayKey();
  const prev = exs.length ? null : previousWorkoutDate(date);
  if (!isValidKey(ui.copyDate) || ui.copyDate === date) ui.copyDate = addDays(date, 1);

  // Fresh root per render so event listeners never pile up on #view.
  const root = document.createElement('div');
  root.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" data-act="prev-day" aria-label="Previous day">${ICONS.left}</button>
      <div class="title">
        <h1 class="tabular">${esc(fmtDay(date))}</h1>
        <div class="sub">${esc(relDay(date))}${exs.length ? ` · ${exs.length} exercise${exs.length > 1 ? 's' : ''}` : ''}</div>
      </div>
      <button class="icon-btn" data-act="next-day" aria-label="Next day">${ICONS.right}</button>
      <button class="pill" data-act="today" ${date === today ? 'disabled' : ''}>Today</button>
    </header>

    ${exs.length ? exs.map((e) => exCard(e, date)).join('') : `
      <div class="empty">
        <div class="big">Rest day so far</div>
        <div class="muted small">Add an exercise below${prev ? ', or repeat your last workout' : ''}.</div>
        ${prev ? `<button class="btn primary block" style="margin-top:14px" data-act="copy-prev">Copy previous workout · ${esc(fmtDay(prev))} (${dayEx(prev).length})</button>` : ''}
      </div>`}

    <div class="card add-card">
      <label class="field"><span>Add exercise</span>
        <input id="add-name" class="input" placeholder="Type any exercise…" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done">
      </label>
      <ul class="suggest" id="suggest" hidden></ul>
      <div class="cats" id="cats" role="group" aria-label="Muscle category">${catButtons()}</div>
      <button class="btn primary block" style="margin-top:10px" data-act="add-ex">Add exercise</button>
    </div>

    ${exs.length ? `
      <div class="day-actions">
        ${ui.copyOpen ? `
          <div class="card stack">
            <label class="field"><span>Copy this day's ${exs.length} exercise${exs.length > 1 ? 's' : ''} to</span>
              <input id="copy-date" class="input" type="date" value="${esc(ui.copyDate)}">
            </label>
            <div class="muted small">Adds to anything already logged on that day.</div>
            <div class="row"><button class="btn ghost grow" data-act="copy-cancel">Cancel</button><button class="btn primary grow" data-act="copy-go">Copy</button></div>
          </div>` : `<button class="btn block" data-act="copy-open">Copy to another day</button>`}
      </div>` : ''}
  `;
  view.replaceChildren(root);
  bind(root, ctx, view);
}

function renderSuggest(view) {
  const input = view.querySelector('#add-name');
  const list = view.querySelector('#suggest');
  const items = suggestions(input.value);
  list.hidden = items.length === 0 || document.activeElement !== input;
  list.innerHTML = items.map((e) => `<li><button type="button" class="${catClass(e.cat)}" data-pick="${esc(e.name)}" data-pick-cat="${esc(e.cat)}"><span class="dot"></span><span class="name">${esc(e.name)}</span><span class="chip-cat">${esc(e.cat)}</span></button></li>`).join('');
}

function setCat(view, cat) {
  ui.addCat = cat;
  view.querySelectorAll('#cats button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === cat)));
}

function bind(view, ctx, host) {
  const date = ctx.date;
  const rerender = () => renderLog(host, ctx);
  const nameInput = view.querySelector('#add-name');

  const doAdd = (name, cat) => {
    const ex = addExercise(date, name, cat);
    if (!ex) { nameInput.focus(); toast('Type an exercise name first.'); return; }
    ui.catTouched = false;
    rerender();
    const card = host.querySelector(`[data-ex="${ex.id}"]`);
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card?.querySelector('input')?.focus({ preventScroll: true });
  };

  nameInput.addEventListener('input', () => {
    const known = libraryEntries().find((e) => nameKey(e.name) === nameKey(nameInput.value));
    if (known && !ui.catTouched) setCat(view, known.cat);
    renderSuggest(view);
  });
  nameInput.addEventListener('focus', () => renderSuggest(view));
  nameInput.addEventListener('blur', () => setTimeout(() => { const l = view.querySelector('#suggest'); if (l && document.activeElement !== nameInput) l.hidden = true; }, 200));
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(nameInput.value, ui.addCat); } });

  // Set inputs: update state in place, no re-render while typing.
  view.addEventListener('input', (e) => {
    const inp = e.target.closest('.set input');
    if (!inp) return;
    const ex = dayEx(date).find((x) => x.id === inp.closest('[data-ex]').dataset.ex);
    const s = ex?.sets[+inp.closest('[data-set]').dataset.set];
    if (!s) return;
    s[inp.dataset.f] = num(inp.value);
    save('days');
  });

  view.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-pick]')) e.preventDefault(); });

  view.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { doAdd(pick.dataset.pick, pick.dataset.pickCat); return; }
    const catBtn = e.target.closest('#cats [data-cat]');
    if (catBtn) { ui.catTouched = true; setCat(view, catBtn.dataset.cat); return; }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const exEl = btn.closest('[data-ex]');
    const ex = exEl && dayEx(date).find((x) => x.id === exEl.dataset.ex);

    switch (btn.dataset.act) {
      case 'prev-day': ui.copyOpen = false; ctx.setDate(addDays(date, -1)); break;
      case 'next-day': ui.copyOpen = false; ctx.setDate(addDays(date, 1)); break;
      case 'today': ui.copyOpen = false; ctx.setDate(todayKey()); break;
      case 'add-ex': doAdd(nameInput.value, ui.addCat); break;
      case 'add-set': {
        ex.sets.push(prefillFor(ex, date));
        save('days');
        rerender();
        const rows = host.querySelectorAll(`[data-ex="${ex.id}"] .set`);
        rows[rows.length - 1]?.querySelector('input')?.focus();
        break;
      }
      case 'del-set':
        twoStep(btn, () => {
          ex.sets.splice(+btn.closest('[data-set]').dataset.set, 1);
          save('days');
          rerender();
        }, 'Delete?');
        break;
      case 'del-ex':
        twoStep(btn, () => {
          state.days[date].ex = dayEx(date).filter((x) => x.id !== ex.id);
          tidy(date);
          save('days');
          rerender();
          toast(`Deleted ${ex.name}`);
        }, 'Delete exercise?');
        break;
      case 'copy-prev': {
        const prev = previousWorkoutDate(date);
        if (!prev) return;
        const n = copyDay(prev, date);
        rerender();
        toast(`Copied ${n} exercise${n > 1 ? 's' : ''} from ${fmtDay(prev)}`);
        break;
      }
      case 'copy-open': ui.copyOpen = true; rerender(); break;
      case 'copy-cancel': ui.copyOpen = false; rerender(); break;
      case 'copy-go': {
        const target = view.querySelector('#copy-date').value;
        if (!isValidKey(target)) { toast('Pick a date first.'); return; }
        if (target === date) { toast('Pick a different day than this one.'); return; }
        ui.copyDate = target;
        const n = copyDay(date, target);
        ui.copyOpen = false;
        rerender();
        toast(`Copied ${n} exercise${n > 1 ? 's' : ''} to ${fmtDay(target)}`, { label: 'Open', run: () => ctx.setDate(target) });
        break;
      }
    }
  });
}
