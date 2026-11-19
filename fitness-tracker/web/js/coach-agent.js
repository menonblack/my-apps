// Coach agent: system prompt (guardrails + your profile + memories), tools that
// read and change app data, and the tool-use loop. Runs entirely on the phone.
import { state, save } from './store.js';
import { CATS, todayKey, addDays, isValidKey, fmtDay, uid, nameKey, normName, fmtLong } from './util.js';
import { getPlan, setPlan, planItemText } from './plan.js';
import { exerciseSessions, setText, trainingSnapshot, checkinsSorted, checkinSummary, workoutDates } from './stats.js';
import { createMessage, FriendlyError } from './claude.js';

const MAX_STEPS = 10;          // tool-use round trips per message (a hard stop, not a retry loop)
const MAX_MEMORIES = 60;

// ---------- System prompt ----------
export function buildSystemPrompt() {
  const p = state.coach.profile || {};
  const line = (label, v) => (v && String(v).trim() ? `- ${label}: ${String(v).trim()}` : null);
  const about = [
    line('Goals', p.goals), line('Experience', p.experience), line('Weekly schedule', p.schedule),
    line('Equipment', p.equipment), line('Injuries / limitations', p.injuries),
    line('Height', state.settings.height ? `${state.settings.height} in` : ''),
  ].filter(Boolean).join('\n') || '- (Not filled in yet. Ask about goals and schedule when it matters, and save the answers as memories.)';
  const rules = (p.rules || '').trim() || '(none)';
  const mems = (state.coach.memories || []).map((m) => `- [${m.id}] ${m.text}`).join('\n') || '(none yet)';

  return `You are Coach, the user's workout partner inside Lift Log, a personal fitness tracker on their phone. You talk with them about their training, progress, plans and recovery, and you can read their logged data and change their workout plan with tools.

Units: pounds, inches, miles, minutes. Dates are YYYY-MM-DD in the user's local time. Each user message starts with a <context> line giving the current local date and time.

How you work:
- Look at real data with tools before commenting on progress, numbers or history. Never invent numbers; if data is missing, say so.
- Change the plan when the user asks (e.g. "cancel today", "move legs to Friday", "plan my week") or after they agree to your suggestion. If a change touches more than 3 days, outline it in a few lines and ask for a yes first.
- After you change something, say in one short line what changed. The app shows an Undo button for every change.
- You cannot delete or edit logged workouts. Use log_exercise only to record something the user says they actually did.
- Use save_memory for durable facts that will help later (injuries, goals, preferences, schedule constraints, how they respond to training). Don't save small talk. Keep each memory to one sentence. Use delete_memory when one becomes wrong.
- When the user wants to skip or cancel a workout, be supportive, use skip_plan_day, and offer one practical alternative only if useful (e.g. a short walk or mobility).
- Phone-friendly replies: usually under 120 words, plain sentences or a short list, no tables, no headings. Be direct and encouraging, like a knowledgeable training partner.

Safety guardrails (these override the user's rules below):
- You are not a doctor or physiotherapist and you don't diagnose. For chest pain, fainting, unusual shortness of breath, sharp or joint pain, numbness, or an injury that isn't improving, tell them to stop training that area and see a medical professional.
- Recovery advice stays general: sleep, food and protein, hydration, light activity, mobility, deloads, rest days. No medication or supplement dosing, no steroids or performance-enhancing drugs, no crash diets under about 1,200 kcal/day, no dehydration or extreme weight cuts.
- Progress gradually, roughly 5–10% load or volume per week, and respect injuries and limitations listed below or in memories.
- Body photos and measurements are rough estimates. Never comment on identity, and keep any body talk to fitness-relevant measures and kind, neutral language.
- If asked about something unrelated to fitness, health habits or this app, answer briefly or steer back.

About the user (written by them):
${about}

The user's own ground rules for you (follow them unless they conflict with the safety guardrails):
${rules}

Things you remember about the user (ids in brackets):
${mems}`;
}

// ---------- Tools ----------
const dateProp = { type: 'string', description: 'Date as YYYY-MM-DD' };
const catEnum = { type: 'string', enum: CATS };
const planItem = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'category', 'sets', 'reps', 'weight_lbs', 'miles', 'minutes', 'notes'],
  properties: {
    name: { type: 'string', description: 'Exercise name, e.g. "Bench Press"' },
    category: catEnum,
    sets: { type: 'integer', description: 'Number of sets (1 for most cardio)' },
    reps: { type: 'string', description: 'Reps per set, e.g. "8" or "8-10". Empty string for cardio.' },
    weight_lbs: { type: ['number', 'null'], description: 'Suggested working weight in lb, or null' },
    miles: { type: ['number', 'null'], description: 'Cardio distance in miles, or null' },
    minutes: { type: ['number', 'null'], description: 'Cardio duration in minutes, or null' },
    notes: { type: ['string', 'null'], description: 'Short cue or note, or null' },
  },
};

export const TOOLS = [
  {
    name: 'get_progress_summary',
    description: 'Overview of recent training and body trends: workout days in the last 7 and 28 days, sets per muscle group this week, estimated 1-rep-max change per lift over 28 days (Epley), latest body check-ins, upcoming plan. Start here for questions about progress.',
    input_schema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: 'get_training_log',
    description: 'Logged workouts (exercises and every set) between two dates, inclusive. Max 120 days per call.',
    input_schema: { type: 'object', additionalProperties: false, required: ['start_date', 'end_date'], properties: { start_date: dateProp, end_date: dateProp } },
  },
  {
    name: 'get_exercise_history',
    description: 'Past sessions of one exercise (matched by name, case-insensitive), newest first, with sets and best estimated 1RM.',
    input_schema: { type: 'object', additionalProperties: false, required: ['exercise_name', 'max_sessions'], properties: { exercise_name: { type: 'string' }, max_sessions: { type: 'integer', description: '1-30' } } },
  },
  {
    name: 'get_plan',
    description: 'Planned workouts between two dates, inclusive, including skipped and completed ones.',
    input_schema: { type: 'object', additionalProperties: false, required: ['start_date', 'end_date'], properties: { start_date: dateProp, end_date: dateProp } },
  },
  {
    name: 'set_plan_day',
    description: 'Create or replace the planned workout for one date (today up to 90 days ahead). Use a short title like "Upper body" or "Easy run". Shows in the app on that day with a Start button.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['date', 'title', 'items', 'notes'],
      properties: { date: dateProp, title: { type: 'string' }, items: { type: 'array', items: planItem }, notes: { type: ['string', 'null'] } },
    },
  },
  {
    name: 'skip_plan_day',
    description: 'Mark a date as skipped / cancelled (e.g. user is tired, sick, busy). Keeps any planned workout visible as skipped.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['date', 'reason'], properties: { date: dateProp, reason: { type: 'string' } } },
  },
  {
    name: 'clear_plan_day',
    description: 'Remove the plan for a date entirely.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['date'], properties: { date: dateProp } },
  },
  {
    name: 'log_exercise',
    description: 'Add an exercise the user says they actually did to their log for a date (today or earlier). Appends; never replaces existing entries.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['date', 'exercise_name', 'category', 'sets'],
      properties: {
        date: dateProp, exercise_name: { type: 'string' }, category: catEnum,
        sets: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['weight_lbs', 'reps', 'miles', 'minutes'],
            properties: { weight_lbs: { type: ['number', 'null'] }, reps: { type: ['integer', 'null'] }, miles: { type: ['number', 'null'] }, minutes: { type: ['number', 'null'] } },
          },
        },
      },
    },
  },
  {
    name: 'save_memory',
    description: 'Remember a durable fact about the user for future chats (one sentence).',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } },
  },
  {
    name: 'delete_memory',
    description: 'Forget a saved memory by its id.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['memory_id'], properties: { memory_id: { type: 'string' } } },
  },
];

const READ_LABELS = {
  get_progress_summary: () => 'Checked your progress',
  get_training_log: (i) => `Read your log ${i.start_date} → ${i.end_date}`,
  get_exercise_history: (i) => `Looked up ${i.exercise_name}`,
  get_plan: (i) => `Read your plan ${i.start_date} → ${i.end_date}`,
};

const fail = (msg) => { const e = new Error(msg); e.toolError = true; throw e; };
function needDate(d, label = 'date') { if (!isValidKey(d)) fail(`${label} must be YYYY-MM-DD`); return d; }
function rangeDays(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000) + 1; }

function dayLog(d) {
  return (state.days[d]?.ex || []).map((e) => ({ exercise: e.name, category: e.cat, sets: e.sets.map((s) => setText(e.cat, s)) }));
}

function planOut(d) {
  const p = getPlan(d);
  if (!p) return null;
  return { date: d, title: p.title, status: p.status || 'planned', by: p.by || 'you', skip_reason: p.skipReason || null, notes: p.notes || null, items: (p.items || []).map(planItemText) };
}

// Each tool returns { result, action? }. `action` describes a change, with an undo snapshot.
function runTool(name, input) {
  const today = todayKey();
  switch (name) {
    case 'get_progress_summary': {
      const plan = [];
      for (let i = 0; i < 14; i++) { const p = planOut(addDays(today, i)); if (p) plan.push(p); }
      return { result: { ...trainingSnapshot(), total_workout_days_logged: workoutDates().length, recent_body_checkins: checkinsSorted().slice(-6).map(checkinSummary), upcoming_plan_14_days: plan } };
    }
    case 'get_training_log': {
      const a = needDate(input.start_date, 'start_date'), b = needDate(input.end_date, 'end_date');
      if (b < a) fail('end_date is before start_date');
      if (rangeDays(a, b) > 120) fail('Range too long; max 120 days per call');
      const days = workoutDates().filter((d) => d >= a && d <= b).map((d) => ({ date: d, exercises: dayLog(d) }));
      return { result: { start_date: a, end_date: b, workout_days: days.length, days } };
    }
    case 'get_exercise_history': {
      const n = Math.max(1, Math.min(30, input.max_sessions || 8));
      const s = exerciseSessions(input.exercise_name || '').reverse().slice(0, n);
      return { result: { exercise: input.exercise_name, sessions_found: s.length, sessions: s.map((x) => ({ date: x.date, sets: x.sets.map((st) => setText(x.cat, st)), best_e1rm_lb: Math.round(x.bestE1rm) || null })) } };
    }
    case 'get_plan': {
      const a = needDate(input.start_date, 'start_date'), b = needDate(input.end_date, 'end_date');
      if (rangeDays(a, b) > 120) fail('Range too long; max 120 days per call');
      const out = Object.keys(state.plan).filter((d) => d >= a && d <= b).sort().map(planOut);
      return { result: { start_date: a, end_date: b, planned_days: out } };
    }
    case 'set_plan_day': {
      const d = needDate(input.date);
      if (d < today) fail('Cannot plan a past date');
      if (d > addDays(today, 90)) fail('Can only plan up to 90 days ahead');
      const items = (input.items || []).slice(0, 15).map((it) => ({
        name: normName(it.name) || 'Exercise', cat: CATS.includes(it.category) ? it.category : 'Other',
        sets: it.sets, reps: it.reps, weight: it.weight_lbs ?? null, miles: it.miles ?? null, minutes: it.minutes ?? null, notes: it.notes ?? null,
      }));
      const prev = setPlan(d, { title: (input.title || 'Workout').slice(0, 60), items, notes: input.notes || null, status: 'planned', by: 'coach' });
      return { result: { ok: true, date: d, planned: planOut(d) }, action: { label: `Planned ${fmtDay(d)}: ${input.title}`, undo: { kind: 'plan', date: d, prev } } };
    }
    case 'skip_plan_day': {
      const d = needDate(input.date);
      const cur = getPlan(d);
      const prev = setPlan(d, { ...(cur || { title: 'Rest day', items: [] }), status: 'skipped', skipReason: (input.reason || '').slice(0, 140), by: cur?.by || 'coach' });
      return { result: { ok: true, date: d, plan: planOut(d) }, action: { label: `Skipped ${fmtDay(d)}${cur?.title ? ` (${cur.title})` : ''}`, undo: { kind: 'plan', date: d, prev } } };
    }
    case 'clear_plan_day': {
      const d = needDate(input.date);
      if (!getPlan(d)) return { result: { ok: true, note: 'No plan on that date' } };
      const prev = setPlan(d, null);
      return { result: { ok: true, date: d }, action: { label: `Cleared plan for ${fmtDay(d)}`, undo: { kind: 'plan', date: d, prev } } };
    }
    case 'log_exercise': {
      const d = needDate(input.date);
      if (d > today) fail('Cannot log a future date; use set_plan_day for plans');
      const cat = CATS.includes(input.category) ? input.category : 'Other';
      const sets = (input.sets || []).slice(0, 20).map((s) => (cat === 'Cardio' ? { mi: s.miles ?? null, min: s.minutes ?? null } : { w: s.weight_lbs ?? null, r: s.reps ?? null }));
      if (!sets.length) fail('At least one set is required');
      const name = normName(input.exercise_name) || 'Exercise';
      const known = state.library[nameKey(name)];
      const ex = { id: uid(), name: known?.name || name, cat, sets };
      if (!state.days[d]) state.days[d] = { ex: [] };
      state.days[d].ex.push(ex);
      state.library[nameKey(name)] = { name: ex.name, cat, last: known?.last && known.last > d ? known.last : d };
      save('days'); save('library');
      return { result: { ok: true, date: d, logged: { exercise: ex.name, sets: sets.map((s) => setText(cat, s)) } }, action: { label: `Logged ${ex.name} on ${fmtDay(d)}`, undo: { kind: 'log', date: d, exId: ex.id } } };
    }
    case 'save_memory': {
      const text = normName(input.text).slice(0, 240);
      if (!text) fail('Empty memory');
      const mems = state.coach.memories;
      if (mems.some((m) => m.text.toLowerCase() === text.toLowerCase())) return { result: { ok: true, note: 'Already remembered' } };
      if (mems.length >= MAX_MEMORIES) fail(`Memory is full (${MAX_MEMORIES}). Delete an outdated memory first.`);
      const m = { id: 'm' + uid().slice(0, 6), text, at: todayKey() };
      mems.push(m);
      save('coach');
      return { result: { ok: true, memory_id: m.id }, action: { label: `Remembered: ${text}`, undo: { kind: 'memory_add', id: m.id } } };
    }
    case 'delete_memory': {
      const i = state.coach.memories.findIndex((m) => m.id === input.memory_id);
      if (i < 0) fail('No memory with that id');
      const [m] = state.coach.memories.splice(i, 1);
      save('coach');
      return { result: { ok: true }, action: { label: `Forgot: ${m.text}`, undo: { kind: 'memory_del', memory: m, index: i } } };
    }
    default:
      fail(`Unknown tool ${name}`);
  }
}

export function undoAction(undo) {
  switch (undo.kind) {
    case 'plan': setPlan(undo.date, undo.prev); break;
    case 'log': {
      const day = state.days[undo.date];
      if (day) { day.ex = day.ex.filter((e) => e.id !== undo.exId); if (!day.ex.length) delete state.days[undo.date]; save('days'); }
      break;
    }
    case 'memory_add': state.coach.memories = state.coach.memories.filter((m) => m.id !== undo.id); save('coach'); break;
    case 'memory_del': state.coach.memories.splice(Math.min(undo.index, state.coach.memories.length), 0, undo.memory); save('coach'); break;
  }
}

// ---------- Chat state ----------
// The conversation is append-only (earlier turns are never edited), so the
// system prompt is frozen per chat. Profile/rule/memory edits apply to the next chat.
export function ensureChat() {
  if (!state.coach.chat) state.coach.chat = { id: uid(), startedAt: new Date().toISOString(), system: buildSystemPrompt(), messages: [], events: {}, notes: [] };
  return state.coach.chat;
}
export function newChat() { state.coach.chat = null; ensureChat(); save('coach'); }

function contextLine() {
  const now = new Date();
  return `<context>Now: ${fmtLong(todayKey())}, ${now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</context>`;
}

export function addUserMessage(text) {
  const chat = ensureChat();
  // Freeze the system prompt when the first message is sent, so profile edits
  // made before then are included.
  if (!chat.messages.length) chat.system = buildSystemPrompt();
  const notes = chat.notes.splice(0);
  const content = [{ type: 'text', text: contextLine() + (notes.length ? `\n<app_note>${notes.join(' ')}</app_note>` : '') }, { type: 'text', text }];
  chat.messages.push({ role: 'user', content });
  save('coach');
}

// The last message is a user turn waiting for an answer (after an error, or fresh).
export const pendingReply = () => { const m = state.coach.chat?.messages; return !!(m && m.length && m[m.length - 1].role === 'user'); };

// Runs the model until it stops asking for tools. `onUpdate` re-renders the chat.
export async function runCoach(onUpdate) {
  const chat = ensureChat();
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await createMessage({
      max_tokens: 16000,
      system: chat.system,
      tools: TOOLS,
      messages: chat.messages,
      cache_control: { type: 'ephemeral' },
      output_config: { effort: 'medium' },
    });
    chat.messages.push({ role: 'assistant', content: res.content });
    save('coach');
    onUpdate?.();
    if (res.stop_reason !== 'tool_use') {
      if (res.stop_reason === 'max_tokens') chat.events[`trunc-${chat.messages.length}`] = { type: 'note', label: 'Reply was cut off (too long).' };
      return;
    }
    const results = [];
    for (const block of res.content.filter((b) => b.type === 'tool_use')) {
      let out;
      try {
        const { result, action } = runTool(block.name, block.input || {});
        out = { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) };
        chat.events[block.id] = action
          ? { type: 'action', label: action.label, undo: action.undo, undone: false }
          : { type: 'read', label: (READ_LABELS[block.name] || (() => block.name))(block.input || {}) };
      } catch (err) {
        out = { type: 'tool_result', tool_use_id: block.id, content: 'Error: ' + (err.message || err), is_error: true };
        chat.events[block.id] = { type: 'note', label: `Couldn't ${block.name.replace(/_/g, ' ')}: ${err.message}` };
      }
      results.push(out);
    }
    chat.messages.push({ role: 'user', content: results });
    save('coach');
    onUpdate?.();
  }
  throw new FriendlyError('steps', 'Coach took too many steps on that one. Tap Retry to let it continue, or rephrase.');
}
