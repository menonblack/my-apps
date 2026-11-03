// Coach tab: chat with Claude as your workout partner.
import { state, save } from './store.js';
import { esc, ICONS, toast, twoStep } from './util.js';
import { hasKey, currentModel, MODELS, usageSummary } from './claude.js';
import { canListen, canSpeak, listen, stopListening, isListening, speak, stopSpeaking } from './voice.js';
import { ensureChat, newChat, addUserMessage, runCoach, pendingReply, undoAction } from './coach-agent.js';

const ui = { busy: false, error: null, draft: '', listening: false };

const MIC = '<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9z"/></svg>';
const SPEAKER_ON = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>';
const SEND = '<svg viewBox="0 0 24 24"><path d="M3 20.5 21 12 3 3.5V10l12 2-12 2z"/></svg>';

const STARTERS = [
  'How am I progressing?',
  'Plan my training for this week',
  'Cancel my workout today',
  "I'm sore. How should I recover?",
];

function mdLite(text) {
  // Minimal formatting: paragraphs, bullet lists, **bold**.
  const lines = esc(text).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const l = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${m[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (l.trim()) html += `<p>${l}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

function renderMessages(chat) {
  const out = [];
  for (const msg of chat.messages) {
    const blocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
    if (msg.role === 'user') {
      // Skip the hidden <context> block; show what the user typed.
      const typed = blocks.filter((b) => b.type === 'text' && !b.text.startsWith('<context>')).map((b) => b.text).join('\n');
      if (typed) out.push(`<div class="msg me">${mdLite(typed)}</div>`);
      continue;
    }
    for (const b of blocks) {
      if (b.type === 'text' && b.text.trim()) out.push(`<div class="msg bot">${mdLite(b.text)}</div>`);
      if (b.type === 'tool_use') {
        const ev = chat.events[b.id];
        if (!ev) continue;
        if (ev.type === 'action') {
          out.push(`<div class="action ${ev.undone ? 'undone' : ''}"><span class="grow">${ev.undone ? 'Undone: ' : '✓ '}${esc(ev.label)}</span>${ev.undone ? '' : `<button class="pill" data-undo="${esc(b.id)}">Undo</button>`}</div>`);
        } else {
          out.push(`<div class="tool-note">${esc(ev.label)}</div>`);
        }
      }
    }
  }
  for (const [k, ev] of Object.entries(chat.events)) if (k.startsWith('trunc-')) out.push(`<div class="tool-note">${esc(ev.label)}</div>`);
  return out.join('');
}

function lastReplyText(chat) {
  const m = [...chat.messages].reverse().find((x) => x.role === 'assistant');
  return (m?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ');
}

export function renderCoach(view, ctx) {
  const chat = ensureChat();
  const model = MODELS.find((m) => m.id === currentModel());
  const long = chat.messages.length > 80;
  const speakOn = !!state.settings.speakReplies;
  const usage = usageSummary();
  const root = document.createElement('div');
  root.className = 'coach';
  root.innerHTML = `
    <header class="topbar">
      <div class="title" style="text-align:left"><h1>Coach</h1><div class="sub tabular">${esc(model.label.split(' · ')[0].replace('Claude ', ''))} · ${esc(usage.monthText)} this month</div></div>
      ${canSpeak() ? `<button class="icon-btn ${speakOn ? 'on' : ''}" data-act="speak" aria-pressed="${speakOn}" aria-label="Read replies aloud">${speakOn ? SPEAKER_ON : SPEAKER_OFF}</button>` : ''}
      <button class="pill" data-act="new" ${chat.messages.length && !ui.busy ? '' : 'disabled'}>New</button>
      <button class="icon-btn" data-act="settings" aria-label="Settings">${ICONS.gear}</button>
    </header>

    ${!hasKey() ? `
      <div class="card stack">
        <strong>Connect Claude to start chatting</strong>
        <div class="muted small">Paste your own Anthropic API key in Settings. It stays on this phone. Log, Calendar and Body work without it.</div>
        <button class="btn primary block" data-act="settings">Open Settings</button>
      </div>` : ''}

    <div class="chat" id="chat">
      ${chat.messages.length ? renderMessages(chat) : `
        <div class="msg bot"><p>Hi! I'm your workout partner. I can see your log, plan and check-ins. Ask about your progress, have me plan your week, cancel today's session, or ask how to recover.</p></div>
        <div class="starters">${STARTERS.map((s) => `<button class="chip" data-starter="${esc(s)}">${esc(s)}</button>`).join('')}</div>`}
      ${ui.busy ? '<div class="msg bot typing"><span></span><span></span><span></span></div>' : ''}
      ${ui.error ? `<div class="notice warn stack"><div>${esc(ui.error.message)}</div><div class="row">${ui.error.retryable || pendingReply() ? '<button class="btn primary grow" data-act="retry">Retry</button>' : ''}${['missing_key', 'auth', 'model'].includes(ui.error.kind) ? '<button class="btn grow" data-act="settings">Settings</button>' : ''}</div></div>` : ''}
      ${long ? '<div class="notice small">This chat is getting long. Start a <strong>New chat</strong> to keep replies fast and cheap. Your memories and plans carry over.</div>' : ''}
    </div>

    <form class="composer" id="composer">
      <textarea id="msg" rows="1" placeholder="${!hasKey() ? 'Add your API key in Settings to chat' : ui.listening ? 'Listening…' : 'Message your coach…'}" enterkeyhint="send" ${hasKey() ? '' : 'disabled'}>${esc(ui.draft)}</textarea>
      ${canListen() ? `<button class="round-btn mic ${ui.listening ? 'rec' : ''}" type="button" data-act="mic" ${hasKey() && !ui.busy ? '' : 'disabled'} aria-label="${ui.listening ? 'Stop listening' : 'Speak a message'}">${MIC}</button>` : ''}
      <button class="round-btn send" type="submit" ${ui.busy || !hasKey() ? 'disabled' : ''} aria-label="Send">${SEND}</button>
    </form>
    ${ui.listening ? '<div class="listening-hint small muted">Listening… tap the mic to stop. Then check the text and tap send.</div>' : ''}
  `;
  view.replaceChildren(root);
  const rerender = () => { if (ctx.tab === 'coach') renderCoach(view, ctx); };

  const ta = root.querySelector('#msg');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
  ta.addEventListener('input', () => { ui.draft = ta.value; grow(); });
  // Enter sends (Shift+Enter for a new line), like a messaging app.
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(ta.value); } });
  grow();
  requestAnimationFrame(() => root.querySelector('#chat').lastElementChild?.scrollIntoView({ block: 'end' }));

  const go = async () => {
    ui.busy = true; ui.error = null; rerender();
    try {
      await runCoach(rerender);
      if (state.settings.speakReplies) speak(lastReplyText(chat));
    } catch (err) {
      ui.error = err;
    } finally {
      ui.busy = false;
      rerender();
    }
  };
  const send = (text) => {
    text = text.trim();
    if (!text || ui.busy) return;
    if (!hasKey()) { ui.error = { kind: 'missing_key', message: 'Add your Claude API key in Settings first.' }; rerender(); return; }
    ui.draft = '';
    stopSpeaking();
    if (isListening()) stopListening();
    addUserMessage(text);
    go();
  };

  root.querySelector('#composer').addEventListener('submit', (e) => { e.preventDefault(); send(ta.value); });

  root.addEventListener('click', (e) => {
    const st = e.target.closest('[data-starter]');
    if (st) { send(st.dataset.starter); return; }
    const u = e.target.closest('[data-undo]');
    if (u) {
      const ev = chat.events[u.dataset.undo];
      if (ev && !ev.undone) {
        undoAction(ev.undo);
        ev.undone = true;
        chat.notes.push(`The user tapped Undo on: "${ev.label}".`);
        save('coach');
        toast('Undone');
        rerender();
      }
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'settings': ctx.go('settings'); break;
      case 'retry': go(); break;
      case 'speak':
        state.settings.speakReplies = !state.settings.speakReplies;
        save('settings');
        if (!state.settings.speakReplies) stopSpeaking();
        toast(state.settings.speakReplies ? 'Coach will read replies aloud' : 'Replies are silent');
        rerender();
        break;
      case 'mic': {
        if (ui.listening) { stopListening(); return; }
        const before = ta.value.trim();
        ui.listening = true;
        rerender();
        listen({
          onText: (t) => {
            ui.draft = (before ? before + ' ' : '') + t;
            const box = view.querySelector('#msg');
            if (box) { box.value = ui.draft; box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, 140) + 'px'; }
          },
          onEnd: (finalText) => {
            ui.listening = false;
            const autoSend = state.settings.voiceAutoSend === true;
            if (finalText && autoSend) send(ui.draft);
            else rerender();
          },
          onError: (msg) => { ui.listening = false; toast(msg); rerender(); },
        });
        break;
      }
      case 'new': twoStep(b, () => { newChat(); ui.error = null; rerender(); toast('New chat started. Memories kept.'); }, 'Start over?'); break;
    }
  });
}
