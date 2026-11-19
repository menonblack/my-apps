// Voice in and out.
// - In the Android app (APK): Android's built-in speech recognizer (the Google
//   voice dialog), via the Capacitor speech-recognition plugin.
// - In Chrome (installed web app): the browser's speech recognition, kept open
//   until you tap stop.
// Either way speech becomes text on the phone before anything goes to Claude.
import { isNative, nativePlugin } from './platform.js';

const SR = self.SpeechRecognition || self.webkitSpeechRecognition;
const NativeSR = () => nativePlugin('SpeechRecognition');

export const canListen = () => !!(NativeSR() || SR);
export const canSpeak = () => 'speechSynthesis' in self;
export const usesNativeVoice = () => !!NativeSR();

let session = null; // { stop() }

export const isListening = () => !!session;
export function stopListening() { session?.stop(); }

// listen({ onText(text), onEnd(finalText), onError(msg) })
export function listen(handlers) {
  stopSpeaking();
  stopListening();
  if (NativeSR()) return listenNative(handlers);
  if (SR) return listenWeb(handlers);
  handlers.onError?.('Voice input is not available here. Use the mic on your keyboard instead.');
}

// ---------- Android native (APK) ----------
async function listenNative({ onText, onEnd, onError }) {
  const P = NativeSR();
  let ended = false;
  const finish = (t) => { if (ended) return; ended = true; session = null; onEnd?.(t); };
  session = { stop: () => { P.stop?.().catch?.(() => {}); } };
  try {
    const avail = await P.available();
    if (!avail?.available) { session = null; onError?.('Speech recognition is not available on this phone. Use the mic on your keyboard.'); return; }
    const perm = await P.checkPermissions().catch(() => ({}));
    if (perm.speechRecognition !== 'granted') {
      const req = await P.requestPermissions();
      if (req.speechRecognition !== 'granted') { session = null; onError?.('Microphone permission is off. Allow it for Lift Log in Android Settings → Apps → Lift Log → Permissions.'); return; }
    }
    // popup: true shows Android's own Google voice-typing dialog.
    const res = await P.start({ language: navigator.language || 'en-US', maxResults: 1, prompt: 'Talk to your coach', partialResults: false, popup: true });
    const text = (res?.matches?.[0] || '').trim();
    if (text) onText?.(text, true);
    finish(text);
  } catch (err) {
    const m = String(err?.message || err);
    if (/no match|cancel|didn.?t understand|7|no speech/i.test(m)) { session = null; ended = true; onEnd?.(''); return; }
    session = null; ended = true;
    onError?.('Voice input stopped: ' + m);
  }
}

// ---------- Browser (installed web app) ----------
// Chrome stops recognising after a short pause, so we restart it until you tap
// stop (or after 8 seconds of silence), collecting the words as we go.
function listenWeb({ onText, onEnd, onError }) {
  let finals = '';
  let interim = '';
  let stopped = false;
  let failed = false;
  let rec = null;
  let silenceTimer = null;
  const SILENCE_MS = 8000;

  const text = () => (finals + ' ' + interim).replace(/\s+/g, ' ').trim();
  const armSilence = () => { clearTimeout(silenceTimer); silenceTimer = setTimeout(() => { stopped = true; rec?.stop(); }, SILENCE_MS); };

  const startOne = () => {
    rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false; // one utterance per run; Android Chrome repeats words in continuous mode
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += ' ' + r[0].transcript;
        else interim += r[0].transcript;
      }
      armSilence();
      onText?.(text(), !interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // just restart
      failed = true; stopped = true;
      const msg = {
        'not-allowed': 'Microphone is blocked. In Chrome: ⋮ → Settings → Site settings → Microphone → allow this site.',
        'service-not-allowed': 'Microphone is blocked for this app. Allow it in your phone settings.',
        'audio-capture': 'No microphone found.',
        network: 'Voice typing needs an internet connection.',
      }[e.error] || 'Voice input stopped: ' + e.error;
      onError?.(msg);
    };
    rec.onend = () => {
      if (interim) { finals += ' ' + interim; interim = ''; }
      if (!stopped) { try { startOne(); return; } catch { /* fall through */ } }
      clearTimeout(silenceTimer);
      session = null;
      onEnd?.(failed ? '' : text());
    };
    rec.start();
  };

  session = { stop: () => { stopped = true; try { rec?.stop(); } catch { /* ignore */ } } };
  armSilence();
  try { startOne(); } catch (err) { session = null; onError?.('Could not start the microphone: ' + err.message); }
}

// ---------- Read replies aloud ----------
export function speak(text) {
  if (!canSpeak() || !text) return;
  stopSpeaking();
  const clean = text.replace(/\*\*/g, '').replace(/^\s*[-*•]\s+/gm, '').replace(/\s+/g, ' ').trim();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = navigator.language || 'en-US';
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

export function stopSpeaking() { try { if (canSpeak()) speechSynthesis.cancel(); } catch { /* ignore */ } }
