// Shared helpers: dates, categories, HTML escaping, toast, two-step confirm.

export const CATS = ['Chest', 'Back', 'Shoulders', 'Legs', 'Arms', 'Abs', 'Cardio', 'Other'];
export const catClass = (c) => 'cat-' + String(c || 'Other').toLowerCase();

export const SEED = {
  Chest: ['Bench Press', 'Incline Bench Press', 'Dumbbell Bench Press', 'Incline Dumbbell Press', 'Chest Fly', 'Cable Crossover', 'Push-up', 'Dip', 'Machine Chest Press'],
  Back: ['Deadlift', 'Pull-up', 'Chin-up', 'Lat Pulldown', 'Barbell Row', 'Dumbbell Row', 'Seated Cable Row', 'T-Bar Row', 'Face Pull'],
  Shoulders: ['Overhead Press', 'Dumbbell Shoulder Press', 'Lateral Raise', 'Front Raise', 'Rear Delt Fly', 'Arnold Press', 'Upright Row', 'Shrug'],
  Legs: ['Squat', 'Front Squat', 'Leg Press', 'Romanian Deadlift', 'Lunge', 'Bulgarian Split Squat', 'Leg Extension', 'Leg Curl', 'Calf Raise', 'Hip Thrust', 'Goblet Squat'],
  Arms: ['Barbell Curl', 'Dumbbell Curl', 'Hammer Curl', 'Preacher Curl', 'Tricep Pushdown', 'Skull Crusher', 'Overhead Tricep Extension', 'Close-Grip Bench Press'],
  Abs: ['Plank', 'Crunch', 'Hanging Leg Raise', 'Cable Crunch', 'Russian Twist', 'Ab Wheel Rollout', 'Sit-up'],
  Cardio: ['Running', 'Walking', 'Cycling', 'Rowing', 'Elliptical', 'Stair Climber', 'Treadmill'],
};

// ---------- Dates (local time, keys are YYYY-MM-DD) ----------
const pad = (n) => String(n).padStart(2, '0');
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const todayKey = () => toKey(new Date());
export const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
export const isValidKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k || '') && !isNaN(fromKey(k));
export const fmtDay = (k, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => fromKey(k).toLocaleDateString(undefined, opts);
export const fmtLong = (k) => fmtDay(k, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export function relDay(k) {
  const t = todayKey();
  if (k === t) return 'Today';
  if (k === addDays(t, -1)) return 'Yesterday';
  if (k === addDays(t, 1)) return 'Tomorrow';
  return fromKey(k).toLocaleDateString(undefined, { weekday: 'long' });
}

// ---------- Misc ----------
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
export const fmtNum = (n, dp = 1) => (n == null || !Number.isFinite(n) ? '' : String(Math.round(n * 10 ** dp) / 10 ** dp));
export const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ');
export const nameKey = (s) => normName(s).toLowerCase();

export const ICONS = {
  left: '<svg viewBox="0 0 24 24"><path d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M8.6 18.6 10 20l8-8-8-8-1.4 1.4 6.6 6.6z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7zm4 2v8h2v-8zm4 0v8h-2v-8z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm8.4 2.3-1.8-.3a6.8 6.8 0 0 0-.7-1.7l1-1.5-1.7-1.7-1.5 1a6.8 6.8 0 0 0-1.7-.7L13.7 4h-2.4L11 5.9a6.8 6.8 0 0 0-1.7.7l-1.5-1-1.7 1.7 1 1.5a6.8 6.8 0 0 0-.7 1.7l-1.8.3v2.4l1.8.3c.2.6.4 1.2.7 1.7l-1 1.5 1.7 1.7 1.5-1c.5.3 1.1.5 1.7.7l.3 1.8h2.4l.3-1.8c.6-.2 1.2-.4 1.7-.7l1.5 1 1.7-1.7-1-1.5c.3-.5.5-1.1.7-1.7l1.8-.3z"/></svg>',
};

// ---------- Toast ----------
let toastTimer;
export function toast(msg, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span class="grow">${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3000);
}

// ---------- In-page two-step confirm (never alert()/confirm()) ----------
// First tap arms the button ("Tap to confirm"); second tap within 4s runs the action.
export function twoStep(btn, run, armedLabel = 'Tap again to delete') {
  if (btn.dataset.armed === '1') {
    clearTimeout(btn._t);
    run();
    return;
  }
  btn.dataset.armed = '1';
  btn._orig = btn.innerHTML;
  btn.classList.add('armed');
  btn.textContent = armedLabel;
  btn._t = setTimeout(() => {
    btn.dataset.armed = '';
    btn.classList.remove('armed');
    btn.innerHTML = btn._orig;
  }, 4000);
}
