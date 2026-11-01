// Body tab: check-ins (photo, weight, waist), Claude photo estimates, trends and progress report.
import { state, save } from './store.js';
import { esc, ICONS, toast, twoStep, num, fmtNum, todayKey, fmtDay, isValidKey, uid } from './util.js';
import { createMessage, jsonOf, textOf, downscale, hasKey, FriendlyError, currentModel } from './claude.js';
import { checkinsSorted, effectiveWaist, checkinSummary, trainingSnapshot } from './stats.js';

const ui = { photo: null, weight: '', waist: '', date: '', est: null, estBusy: false, estError: null, repBusy: false, repError: null };

// ---------- Claude calls ----------
const EST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['waist_in', 'waist_range_in', 'body_fat_pct_range', 'confidence', 'observations', 'photo_tip'],
  properties: {
    waist_in: { type: ['number', 'null'], description: 'Best single estimate of waist circumference at the navel, inches, or null if not visible' },
    waist_range_in: { type: ['array', 'null'], items: { type: 'number' }, description: '[low, high] inches' },
    body_fat_pct_range: { type: ['array', 'null'], items: { type: 'number' }, description: '[low, high] percent' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    observations: { type: 'array', items: { type: 'string' }, description: '2-4 short, neutral, fitness-relevant observations' },
    photo_tip: { type: 'string', description: 'One tip to make the next photo easier to estimate from' },
  },
};

const range = (r, lo, hi) => (Array.isArray(r) && r.length >= 2 && r.every((x) => Number.isFinite(x)) ? [Math.max(lo, Math.min(r[0], r[1])), Math.min(hi, Math.max(r[0], r[1]))] : null);

async function estimateFromPhoto() {
  if (!ui.photo) throw new FriendlyError('no_photo', 'Add a photo first.', false);
  const height = num(state.settings.height);
  const weight = num(ui.weight);
  const waist = num(ui.waist);
  const res = await createMessage({
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: EST_SCHEMA } },
    system: 'You give rough body-measurement estimates from a single photo for a personal fitness log. Never identify the person, guess who they are, or comment on attractiveness. You cannot measure weight from a photo; weight always comes from the user. Use honest, wide ranges and low confidence when clothing, angle, lighting or distance make it unclear. Respond with JSON only.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: ui.photo.base64 } },
        { type: 'text', text: `Estimate waist circumference (at the navel, inches) and a body-fat percentage range from this photo.\nHeight: ${height ? height + ' in' : 'unknown'}\nWeight (entered by user): ${weight ? weight + ' lb' : 'unknown'}\nTape-measured waist: ${waist ? waist + ' in' : 'not given'}\nReturn JSON with waist_in (or null), waist_range_in, body_fat_pct_range, confidence, observations, photo_tip.` },
      ],
    }],
  });
  const j = jsonOf(res);
  if (typeof j !== 'object' || !j) throw new FriendlyError('bad_json', "Claude's answer came back in an unexpected format. Tap Retry.");
  return {
    waist_in: Number.isFinite(j.waist_in) && j.waist_in > 15 && j.waist_in < 80 ? Math.round(j.waist_in * 10) / 10 : null,
    waist_range_in: range(j.waist_range_in, 15, 80),
    body_fat_pct_range: range(j.body_fat_pct_range, 2, 70),
    confidence: ['low', 'medium', 'high'].includes(j.confidence) ? j.confidence : 'low',
    observations: Array.isArray(j.observations) ? j.observations.filter((x) => typeof x === 'string').slice(0, 5) : [],
    photo_tip: typeof j.photo_tip === 'string' ? j.photo_tip : '',
    model: res.model || currentModel(),
    at: new Date().toISOString(),
  };
}

async function writeReport() {
  const checkins = checkinsSorted().slice(-12).map(checkinSummary);
  const data = { today: todayKey(), height_in: state.settings.height || null, goals: state.coach.profile?.goals || null, body_checkins: checkins, training: trainingSnapshot() };
  const res = await createMessage({
    max_tokens: 3000,
    output_config: { effort: 'low' },
    system: 'You write short progress reports for a personal fitness tracker. Under 170 words total. Exactly three sections, each starting with its heading alone on a line: "Body", "Training", "Next two weeks". Plain text; "- " bullets are fine; no other markdown. Weight is user-entered. Waist values marked "est" come from photo estimates and are rough; "tape" values are reliable and win when they disagree. Estimated 1RM uses the Epley formula. Be specific with numbers from the data, encouraging and honest. If data is thin, say what to log next. Never comment on identity or appearance.',
    messages: [{ role: 'user', content: 'My data (JSON):\n' + JSON.stringify(data) }],
  });
  const text = textOf(res);
  if (!text) throw new FriendlyError('bad_json', 'Claude returned an empty report. Tap Retry.');
  return { text, at: new Date().toISOString(), model: res.model || currentModel() };
}

// ---------- Rendering helpers ----------
function sparkline(values) {
  if (values.length < 2) return '<svg class="spark" viewBox="0 0 100 30" aria-hidden="true"></svg>';
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 98 + 1},${28 - ((v - min) / span) * 26 + 1}`).join(' ');
  const last = pts.split(' ').pop().split(',');
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="currentColor"/></svg>`;
}

function tile(label, unit, series, estFlag) {
  if (!series.length) return `<div class="card tile"><div class="tile-label">${label}</div><div class="tile-val muted">–</div><div class="small muted">No data yet</div></div>`;
  const first = series[0].v, last = series[series.length - 1].v;
  const d = last - first;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  return `<div class="card tile">
    <div class="tile-label">${label}${estFlag ? ' <span class="est">est.</span>' : ''}</div>
    <div class="tile-val tabular">${fmtNum(last)}<small> ${unit}</small></div>
    <div class="small muted tabular">${series.length > 1 ? `${sign}${fmtNum(Math.abs(d))} ${unit} since ${esc(fmtDay(series[0].date, { month: 'short', day: 'numeric' }))}` : 'First check-in'}</div>
    ${sparkline(series.map((x) => x.v))}
  </div>`;
}

const rangeText = (r, unit) => (r ? `${fmtNum(r[0])}–${fmtNum(r[1])}${unit}` : '');

function estBlock(est) {
  if (!est) return '';
  return `<div class="notice stack small">
    <div><strong>Photo estimate</strong> <span class="est">est.</span> · ${esc(est.confidence)} confidence</div>
    <div class="tabular">Waist: ${est.waist_in ? `~${fmtNum(est.waist_in)} in` : 'not visible'}${est.waist_range_in ? ` (${rangeText(est.waist_range_in, ' in')})` : ''}</div>
    <div class="tabular">Body fat: ${est.body_fat_pct_range ? rangeText(est.body_fat_pct_range, '%') : 'not estimated'}</div>
    ${est.observations.length ? `<ul>${est.observations.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
    ${est.photo_tip ? `<div class="muted">Tip: ${esc(est.photo_tip)}</div>` : ''}
    <div class="muted">Rough guide only. Weight comes from you; a tape measurement overrides this in trends.</div>
  </div>`;
}

function reportHtml(text) {
  return text.split('\n').map((l) => {
    const t = l.trim();
    if (!t) return '';
    if (/^(body|training|next two weeks):?$/i.test(t.replace(/[#*]/g, '').trim())) return `<h3 class="rep-h">${esc(t.replace(/[#*:]/g, '').trim())}</h3>`;
    if (/^[-•]\s+/.test(t)) return `<div class="rep-li">• ${esc(t.replace(/^[-•]\s+/, ''))}</div>`;
    return `<p>${esc(t)}</p>`;
  }).join('');
}

function errorBox(err, act) {
  if (!err) return '';
  return `<div class="notice warn stack small"><div>${esc(err.message)}</div><div class="row">
    ${err.kind === 'no_photo' ? '' : `<button class="btn grow" data-act="${act}">Retry</button>`}
    ${['missing_key', 'auth', 'model'].includes(err.kind) ? '<button class="btn grow" data-act="settings">Settings</button>' : ''}</div></div>`;
}

// ---------- View ----------
export function renderBody(view, ctx) {
  if (!isValidKey(ui.date)) ui.date = todayKey();
  const list = checkinsSorted();
  const weights = list.filter((c) => c.weight).map((c) => ({ date: c.date, v: c.weight }));
  const waists = list.map((c) => ({ c, w: effectiveWaist(c) })).filter((x) => x.w).map((x) => ({ date: x.c.date, v: x.w.value, src: x.w.source }));
  const waistLatestEst = waists.length && waists[waists.length - 1].src === 'est';
  const rep = state.report;

  const root = document.createElement('div');
  root.innerHTML = `
    <header class="topbar">
      <div class="title" style="text-align:left"><h1>Body</h1><div class="sub">${list.length} check-in${list.length === 1 ? '' : 's'}</div></div>
      <button class="icon-btn" data-act="settings" aria-label="Settings">${ICONS.gear}</button>
    </header>

    <div class="tiles">
      ${tile('Weight', 'lb', weights, false)}
      ${tile('Waist', 'in', waists, waistLatestEst)}
    </div>

    <h2 class="section-title">New check-in</h2>
    <div class="card stack">
      <div class="photo-row">
        ${ui.photo ? `<img class="photo-preview" src="${ui.photo.dataUrl}" alt="Check-in photo preview">` : '<div class="photo-preview empty">No photo</div>'}
        <div class="stack grow">
          <button class="btn block" data-act="camera">Take photo</button>
          <button class="btn block" data-act="gallery">From gallery</button>
          ${ui.photo ? '<button class="btn ghost block" data-act="clear-photo">Remove photo</button>' : ''}
        </div>
      </div>
      <input type="file" id="cam" accept="image/*" capture="environment" hidden>
      <input type="file" id="gal" accept="image/*" hidden>
      <div class="grid2">
        <label class="field"><span>Weight (lb)</span><input id="weight" class="input num" inputmode="decimal" value="${esc(ui.weight)}" placeholder="e.g. 182.4"></label>
        <label class="field"><span>Height (in)</span><input id="height" class="input num" inputmode="decimal" value="${esc(fmtNum(state.settings.height))}" placeholder="e.g. 70"></label>
        <label class="field"><span>Waist, tape (in) · optional</span><input id="waist" class="input num" inputmode="decimal" value="${esc(ui.waist)}" placeholder="e.g. 34"></label>
        <label class="field"><span>Date</span><input id="date" class="input" type="date" value="${esc(ui.date)}"></label>
      </div>
      <button class="btn block" data-act="estimate" ${ui.photo && !ui.estBusy ? '' : 'disabled'}>${ui.estBusy ? 'Estimating…' : 'Estimate from photo'}</button>
      ${!hasKey() && ui.photo ? '<div class="small muted">Photo estimates need your Claude API key (Settings). You can still save the check-in.</div>' : ''}
      ${errorBox(ui.estError, 'estimate')}
      ${estBlock(ui.est)}
      <button class="btn primary block" data-act="save">Save check-in</button>
      <div class="small muted">Only a small thumbnail is kept; the full photo is discarded.</div>
    </div>

    <h2 class="section-title">Progress report</h2>
    <div class="card stack">
      ${rep ? `<div class="report">${reportHtml(rep.text)}</div><div class="small muted">Written ${esc(new Date(rep.at).toLocaleString())}</div>` : '<div class="small muted">Claude reads your check-ins and training (workout days in the last 28 days, estimated 1RM change per lift) and writes a short report.</div>'}
      <button class="btn block" data-act="report" ${ui.repBusy ? 'disabled' : ''}>${ui.repBusy ? 'Writing…' : rep ? 'Write a new report' : 'Write progress report'}</button>
      ${errorBox(ui.repError, 'report')}
    </div>

    <h2 class="section-title">Past check-ins</h2>
    ${list.length ? `<div class="card checkins">${[...list].reverse().map((c) => {
      const w = effectiveWaist(c);
      return `<div class="ci">
        ${c.thumb ? `<img src="${c.thumb}" alt="" class="ci-thumb">` : '<div class="ci-thumb empty"></div>'}
        <div class="grow">
          <div class="ci-date">${esc(fmtDay(c.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</div>
          <div class="small tabular">${c.weight ? `${fmtNum(c.weight)} lb` : '–'}${w ? ` · waist ${w.source === 'est' ? '~' : ''}${fmtNum(w.value)} in${w.source === 'est' ? ' <span class="est">est.</span>' : ' (tape)'}` : ''}</div>
          ${c.est?.body_fat_pct_range ? `<div class="small muted tabular">Body fat ${rangeText(c.est.body_fat_pct_range, '%')} <span class="est">est.</span></div>` : ''}
        </div>
        <button class="icon-btn" data-del="${esc(c.id)}" aria-label="Delete check-in">${ICONS.trash}</button>
      </div>`;
    }).join('')}</div>` : '<div class="card muted small">No check-ins yet.</div>'}
  `;
  view.replaceChildren(root);
  const rerender = () => { if (ctx.tab === 'body') renderBody(view, ctx); };

  const bindVal = (id, k) => root.querySelector('#' + id).addEventListener('input', (e) => { ui[k] = e.target.value; });
  bindVal('weight', 'weight'); bindVal('waist', 'waist'); bindVal('date', 'date');
  root.querySelector('#height').addEventListener('change', (e) => { const h = num(e.target.value); state.settings.height = h && h > 30 && h < 100 ? h : null; save('settings'); });

  const onFile = async (input) => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      ui.photo = await downscale(f, 1280, 0.85);
      ui.est = null; ui.estError = null;
      rerender();
    } catch (err) {
      toast(err.message || 'Could not read that photo.');
    }
  };
  root.querySelector('#cam').addEventListener('change', (e) => onFile(e.target));
  root.querySelector('#gal').addEventListener('change', (e) => onFile(e.target));

  root.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      twoStep(del, () => { state.checkins = state.checkins.filter((c) => c.id !== del.dataset.del); save('checkins'); rerender(); toast('Check-in deleted'); }, 'Delete?');
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'settings': ctx.go('settings'); break;
      case 'camera': root.querySelector('#cam').click(); break;
      case 'gallery': root.querySelector('#gal').click(); break;
      case 'clear-photo': ui.photo = null; ui.est = null; ui.estError = null; rerender(); break;
      case 'estimate': {
        ui.estBusy = true; ui.estError = null; rerender();
        try { ui.est = await estimateFromPhoto(); } catch (err) { ui.estError = err; } finally { ui.estBusy = false; rerender(); }
        break;
      }
      case 'report': {
        ui.repBusy = true; ui.repError = null; rerender();
        try { state.report = await writeReport(); save('report'); } catch (err) { ui.repError = err; } finally { ui.repBusy = false; rerender(); }
        break;
      }
      case 'save': {
        const weight = num(ui.weight), waist = num(ui.waist);
        if (!weight || weight < 50 || weight > 800) { toast('Enter your weight in lb.'); root.querySelector('#weight').focus(); return; }
        if (ui.waist && (!waist || waist < 15 || waist > 80)) { toast('Waist should be in inches, e.g. 34.'); return; }
        if (!isValidKey(ui.date)) { toast('Pick a date.'); return; }
        let thumb = null;
        if (ui.photo) { try { thumb = (await downscale(await (await fetch(ui.photo.dataUrl)).blob(), 240, 0.7)).dataUrl; } catch { /* save without thumb */ } }
        state.checkins.push({ id: uid(), date: ui.date, createdAt: new Date().toISOString(), weight, height: state.settings.height || null, waistTape: waist || null, est: ui.est || null, thumb });
        save('checkins');
        Object.assign(ui, { photo: null, weight: '', waist: '', est: null, estError: null, date: todayKey() });
        rerender();
        toast('Check-in saved');
        break;
      }
    }
  });
}
