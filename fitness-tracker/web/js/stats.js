// Training and body statistics shared by the Body tab, progress report and Coach.
import { state } from './store.js';
import { todayKey, addDays, nameKey, fmtNum } from './util.js';

// Epley estimated one-rep max.
export const epley = (w, r) => (w > 0 && r > 0 ? (r === 1 ? w : w * (1 + r / 30)) : 0);

export const workoutDates = () => Object.keys(state.days).filter((d) => state.days[d]?.ex?.length).sort();

export function workoutDaysBetween(start, end) {
  return workoutDates().filter((d) => d >= start && d <= end).length;
}

// All sessions of an exercise (case-insensitive name), oldest first.
export function exerciseSessions(name) {
  const key = nameKey(name);
  const out = [];
  for (const d of workoutDates()) {
    for (const e of state.days[d].ex) {
      if (nameKey(e.name) !== key || !e.sets.length) continue;
      const best = Math.max(0, ...e.sets.map((s) => epley(s.w || 0, s.r || 0)));
      out.push({ date: d, name: e.name, cat: e.cat, sets: e.sets, bestE1rm: best });
    }
  }
  return out;
}

export function setText(cat, s) {
  return cat === 'Cardio'
    ? `${fmtNum(s.mi, 2) || '?'} mi in ${fmtNum(s.min) || '?'} min`
    : `${fmtNum(s.w) || 0} lb x ${fmtNum(s.r, 0) || 0}`;
}

// Estimated 1RM change per lift over the last `days` days (lifts with 2+ sessions in the window).
export function e1rmChanges(days = 28) {
  const start = addDays(todayKey(), -(days - 1));
  const names = new Map();
  for (const d of workoutDates()) {
    if (d < start) continue;
    for (const e of state.days[d].ex) if (e.cat !== 'Cardio') names.set(nameKey(e.name), e.name);
  }
  const rows = [];
  for (const name of names.values()) {
    const s = exerciseSessions(name).filter((x) => x.date >= start && x.bestE1rm > 0);
    if (s.length < 2) continue;
    const first = s[0], last = s[s.length - 1];
    rows.push({
      lift: name, sessions: s.length,
      first_date: first.date, first_e1rm_lb: Math.round(first.bestE1rm),
      latest_date: last.date, latest_e1rm_lb: Math.round(last.bestE1rm),
      change_lb: Math.round(last.bestE1rm - first.bestE1rm),
      change_pct: first.bestE1rm ? Math.round(((last.bestE1rm - first.bestE1rm) / first.bestE1rm) * 1000) / 10 : 0,
    });
  }
  return rows.sort((a, b) => b.sessions - a.sessions).slice(0, 12);
}

export function setsByCategory(days = 7) {
  const start = addDays(todayKey(), -(days - 1));
  const out = {};
  for (const d of workoutDates()) {
    if (d < start) continue;
    for (const e of state.days[d].ex) out[e.cat] = (out[e.cat] || 0) + e.sets.length;
  }
  return out;
}

// Waist used for trends: tape measurement beats the photo estimate.
export function effectiveWaist(c) {
  if (c.waistTape) return { value: c.waistTape, source: 'tape' };
  const est = c.est;
  if (est?.waist_in) return { value: est.waist_in, source: 'est' };
  if (Array.isArray(est?.waist_range_in) && est.waist_range_in.length === 2) return { value: (est.waist_range_in[0] + est.waist_range_in[1]) / 2, source: 'est' };
  return null;
}

export const checkinsSorted = () => [...state.checkins].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || ''));

export function checkinSummary(c) {
  const w = effectiveWaist(c);
  return {
    date: c.date,
    weight_lb: c.weight ?? null,
    waist_in: w ? Math.round(w.value * 10) / 10 : null,
    waist_source: w?.source ?? null,
    body_fat_pct_range_est: c.est?.body_fat_pct_range ?? null,
  };
}

export function trainingSnapshot() {
  const t = todayKey();
  return {
    today: t,
    workout_days_last_7: workoutDaysBetween(addDays(t, -6), t),
    workout_days_last_28: workoutDaysBetween(addDays(t, -27), t),
    last_workout: workoutDates().filter((d) => d <= t).pop() || null,
    sets_by_muscle_last_7_days: setsByCategory(7),
    e1rm_change_last_28_days: e1rmChanges(28),
  };
}
