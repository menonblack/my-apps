// Coach tab: chat with Claude as your workout partner.
import { state, save } from './store.js';
import { esc, ICONS, toast, twoStep } from './util.js';
import { hasKey, currentModel, MODELS } from './claude.js';
import { ensureChat, newChat, addUserMessage, runCoach, pendingReply, undoAction } from './coach-agent.js';

const ui = { busy: false, error: null, draft: '' };

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

export function renderCoach(view, ctx) {
  const chat = ensureChat();
  const model = MODELS.find((m) => m.id === currentModel());
  const long = chat.messages.length > 80;
  const root = document.createElement('div');
  root.className = 'coach';
  root.innerHTML = `
    <header class="topbar">
      <div class="title" style="text-align:left"><h1>Coach</h1><div class="sub">${esc(model.label.split(' · ')[0])} · knows your log, plan &amp; check-ins</div></div>
      <button class="pill" data-act="new" ${chat.messages.length && !ui.busy ? '' : 'disabled'}>New chat</button>
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
      <textarea id="msg" rows="1" placeholder="${hasKey() ? 'Message your coach…' : 'Add your API key in Settings to chat'}" enterkeyhint="send" ${hasKey() ? '' : 'disabled'}>${esc(ui.draft)}</textarea>
      <button class="btn primary" type="submit" ${ui.busy || !hasKey() ? 'disabled' : ''} aria-label="Send">Send</button>
    </form>
  `;
  view.replaceChildren(root);
  const rerender = () => { if (ctx.tab === 'coach') renderCoach(view, ctx); };

  const ta = root.querySelector('#msg');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
  ta.addEventListener('input', () => { ui.draft = ta.value; grow(); });
  grow();
  requestAnimationFrame(() => root.querySelector('#chat').lastElementChild?.scrollIntoView({ block: 'end' }));

  const go = async () => {
    ui.busy = true; ui.error = null; rerender();
    try {
      await runCoach(rerender);
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
      case 'new': twoStep(b, () => { newChat(); ui.error = null; rerender(); toast('New chat started. Memories kept.'); }, 'Start over?'); break;
    }
  });
}
