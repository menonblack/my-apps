// Planned workouts (written by you or by Coach). Stored per date in state.plan.
import { state, save } from './store.js';
import { uid, nameKey, CATS } from './util.js';

export const getPlan = (date) => state.plan[date] || null;

export function setPlan(date, plan) {
  const prev = state.plan[date] ? structuredClone(state.plan[date]) : null;
  if (plan) state.plan[date] = { ...plan, updatedAt: new Date().toISOString() };
  else delete state.plan[date];
  save('plan');
  return prev;
}

// Turn a planned day into logged exercises with prefilled sets.
export function startPlan(date) {
  const p = getPlan(date);
  if (!p?.items?.length) return 0;
  if (!state.days[date]) state.days[date] = { ex: [] };
  for (const it of p.items) {
    const cat = CATS.includes(it.cat) ? it.cat : 'Other';
    const n = Math.max(1, Math.min(10, parseInt(it.sets, 10) || 1));
    const reps = parseInt(String(it.reps || '').match(/\d+/)?.[0], 10) || null;
    const sets = [];
    for (let i = 0; i < n; i++) sets.push(cat === 'Cardio' ? { mi: it.miles ?? null, min: it.minutes ?? null } : { w: it.weight ?? null, r: reps });
    state.days[date].ex.push({ id: uid(), name: it.name, cat, sets });
    const k = nameKey(it.name);
    state.library[k] = { name: state.library[k]?.name || it.name, cat, last: date };
  }
  state.plan[date] = { ...p, status: 'done', updatedAt: new Date().toISOString() };
  save('days'); save('library'); save('plan');
  return p.items.length;
}

export function planItemText(it) {
  if (it.cat === 'Cardio') {
    const bits = [it.miles ? `${it.miles} mi` : '', it.minutes ? `${it.minutes} min` : ''].filter(Boolean).join(' · ');
    return `${it.name}${bits ? ' — ' + bits : ''}`;
  }
  return `${it.name} — ${it.sets || '?'}×${it.reps || '?'}${it.weight ? ` @ ${it.weight} lb` : ''}`;
}
