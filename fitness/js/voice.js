// Voice in and out using the phone's own speech services (free; nothing extra is
// sent to Claude — speech becomes text before it is sent).
const SR = self.SpeechRecognition || self.webkitSpeechRecognition;

export const canListen = () => !!SR;
export const canSpeak = () => 'speechSynthesis' in self;

let rec = null;

// Start listening. Calls onText(fullText, isFinal) as words arrive and onEnd(finalText) when done.
export function listen({ onText, onEnd, onError }) {
  if (!SR) { onError?.('Voice input is not supported in this browser. Use the mic on your keyboard instead.'); return; }
  stopSpeaking();
  stopListening();
  rec = new SR();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  let failed = false;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onText?.((finalText + ' ' + interim).replace(/\s+/g, ' ').trim(), !interim);
  };
  rec.onerror = (e) => {
    failed = true;
    const msg = {
      'not-allowed': 'Microphone is blocked. In Chrome: ⋮ → Settings → Site settings → Microphone → allow this site.',
      'service-not-allowed': 'Microphone is blocked for this app. Allow it in your phone settings.',
      'no-speech': "Didn't hear anything. Tap the mic and try again.",
      'audio-capture': 'No microphone found.',
      network: 'Voice typing needs an internet connection.',
      aborted: '',
    }[e.error];
    if (msg !== '') onError?.(msg || 'Voice input stopped: ' + e.error);
  };
  rec.onend = () => { rec = null; onEnd?.(failed ? '' : finalText.trim()); };
  try { rec.start(); } catch (err) { rec = null; onError?.('Could not start the microphone: ' + err.message); }
}

export function stopListening() { try { rec?.stop(); } catch { /* ignore */ } }
export const isListening = () => !!rec;

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
