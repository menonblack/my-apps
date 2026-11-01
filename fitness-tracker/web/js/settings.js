// Settings: Claude API key (stored on this device only), model, height, Coach profile, rules, memories.
import { state, save, saveNow } from './store.js';
import { esc, ICONS, toast, twoStep, num, fmtNum } from './util.js';
import { MODELS, currentModel, createMessage, hasKey } from './claude.js';

const ui = { showKey: false, testing: false, testMsg: null };

const PROFILE_FIELDS = [
  ['goals', 'Goals', 'e.g. Lose 10 lb by March, bench 225, run a 5K'],
  ['experience', 'Experience', 'e.g. Lifting 2 years, new to running'],
  ['schedule', 'Weekly schedule', 'e.g. Mon/Wed/Fri gym 6am, 45 min max'],
  ['equipment', 'Equipment', 'e.g. Full gym; dumbbells to 50 lb at home'],
  ['injuries', 'Injuries / limitations', 'e.g. Left shoulder impingement, avoid overhead pressing'],
];

export function renderSettings(view, ctx) {
  const p = state.coach.profile || (state.coach.profile = {});
  const key = state.settings.apiKey || '';
  const masked = key ? key.slice(0, 7) + '…' + key.slice(-4) : '';
  const root = document.createElement('div');
  root.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" data-act="back" aria-label="Back">${ICONS.left}</button>
      <div class="title"><h1>Settings</h1></div>
      <span style="width:48px"></span>
    </header>

    <h2 class="section-title">Claude API key</h2>
    <div class="card stack">
      <div class="small muted">Used for Coach, photo estimates and progress reports. Get a key at
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> → API keys.
        The key is stored only on this phone, is never in a backup file, and is sent only to Anthropic's API.</div>
      ${key ? `<div class="row"><span class="grow tabular">Saved: <code>${esc(ui.showKey ? key : masked)}</code></span><button class="btn ghost" data-act="toggle-key">${ui.showKey ? 'Hide' : 'Show'}</button></div>` : ''}
      <label class="field"><span>${key ? 'Replace key' : 'Paste key'}</span>
        <input id="key" class="input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…">
      </label>
      <div class="row">
        <button class="btn primary grow" data-act="save-key">Save key</button>
        <button class="btn grow" data-act="test-key" ${hasKey() && !ui.testing ? '' : 'disabled'}>${ui.testing ? 'Testing…' : 'Test key'}</button>
      </div>
      ${ui.testMsg ? `<div class="notice ${ui.testMsg.ok ? '' : 'warn'} small">${esc(ui.testMsg.text)}</div>` : ''}
      ${key ? '<button class="btn danger block" data-act="remove-key">Remove key from this phone</button>' : ''}
      <label class="field"><span>Model</span>
        <select id="model" class="input">${MODELS.map((m) => `<option value="${m.id}" ${m.id === currentModel() ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      </label>
    </div>

    <h2 class="section-title">Body</h2>
    <div class="card stack">
      <label class="field"><span>Height (in)</span>
        <input id="height" class="input num" inputmode="decimal" value="${esc(fmtNum(state.settings.height))}" placeholder="e.g. 70">
      </label>
    </div>

    <h2 class="section-title">Coach: about you</h2>
    <div class="card stack">
      <div class="small muted">Coach reads this at the start of every chat. Changes apply to your next chat.</div>
      ${PROFILE_FIELDS.map(([k, label, ph]) => `<label class="field"><span>${label}</span><textarea class="input ta" data-profile="${k}" rows="2" placeholder="${esc(ph)}">${esc(p[k] || '')}</textarea></label>`).join('')}
    </div>

    <h2 class="section-title">Coach: ground rules</h2>
    <div class="card stack">
      <div class="small muted">Your own guardrails, e.g. "Never plan more than 4 days a week", "Keep workouts under 45 minutes", "Remind me to stretch". Built-in safety rules always apply.</div>
      <textarea class="input ta" data-profile="rules" rows="4" placeholder="One rule per line">${esc(p.rules || '')}</textarea>
    </div>

    <h2 class="section-title">Coach: memories (${state.coach.memories.length})</h2>
    <div class="card stack">
      <div class="small muted">Facts Coach saved to help you over time. Delete anything that's wrong.</div>
      ${state.coach.memories.length ? `<ul class="mem-list">${state.coach.memories.map((m) => `<li><span class="grow">${esc(m.text)}</span><button class="icon-btn" data-forget="${esc(m.id)}" aria-label="Delete memory">${ICONS.trash}</button></li>`).join('')}</ul>` : '<div class="muted small">None yet.</div>'}
      <div class="row"><input id="new-mem" class="input grow" placeholder="Add a memory yourself"><button class="btn" data-act="add-mem">Add</button></div>
    </div>
    <p class="muted small" style="text-align:center;margin-top:24px">Lift Log · data stays on this device</p>
  `;
  view.replaceChildren(root);
  const rerender = () => { if (ctx.tab === 'settings') renderSettings(view, ctx); };

  root.querySelector('#model').addEventListener('change', (e) => { state.settings.model = e.target.value; save('settings'); toast('Model saved'); });
  root.querySelector('#height').addEventListener('change', (e) => { const h = num(e.target.value); state.settings.height = h && h > 30 && h < 100 ? h : null; save('settings'); toast(state.settings.height ? 'Height saved' : 'Height cleared'); });
  root.querySelectorAll('[data-profile]').forEach((ta) => ta.addEventListener('input', () => { p[ta.dataset.profile] = ta.value; save('coach'); }));

  root.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-forget]');
    if (f) {
      twoStep(f, () => { state.coach.memories = state.coach.memories.filter((m) => m.id !== f.dataset.forget); save('coach'); rerender(); }, 'Delete?');
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'back': ctx.go(ctx.prevTab || 'coach'); break;
      case 'toggle-key': ui.showKey = !ui.showKey; rerender(); break;
      case 'save-key': {
        const v = root.querySelector('#key').value.trim();
        if (!v) { toast('Paste your key first.'); return; }
        if (!v.startsWith('sk-')) { toast("That doesn't look like an Anthropic key (should start with sk-ant-)."); return; }
        state.settings.apiKey = v;
        await saveNow('settings');
        ui.testMsg = null;
        rerender();
        toast('Key saved on this phone');
        break;
      }
      case 'remove-key':
        twoStep(b, async () => { delete state.settings.apiKey; await saveNow('settings'); ui.testMsg = null; rerender(); toast('Key removed'); }, 'Tap again to remove');
        break;
      case 'test-key': {
        ui.testing = true; ui.testMsg = null; rerender();
        try {
          await createMessage({ max_tokens: 200, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] });
          ui.testMsg = { ok: true, text: 'Key works. Coach is ready.' };
        } catch (err) {
          ui.testMsg = { ok: false, text: err.message };
        } finally {
          ui.testing = false;
          rerender();
        }
        break;
      }
      case 'add-mem': {
        const inp = root.querySelector('#new-mem');
        const t = inp.value.trim();
        if (!t) return;
        state.coach.memories.push({ id: 'm' + Math.random().toString(36).slice(2, 8), text: t.slice(0, 240), at: new Date().toISOString().slice(0, 10) });
        save('coach');
        rerender();
        break;
      }
    }
  });
}
