// Claude API access via the official Anthropic SDK (bundled in vendor/).
// The API key is pasted by the user in Settings and stays in this device's storage.
// It is never in the code or the repo. Fine for a personal app; a shared app would
// need a small server proxy so the key never reaches the browser.
import Anthropic from '../vendor/anthropic-sdk.js';
import { state } from './store.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 · smartest (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 · faster, about half the cost' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 · fastest, cheapest' },
];
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const currentModel = () => (MODELS.some((m) => m.id === state.settings.model) ? state.settings.model : DEFAULT_MODEL);
export const hasKey = () => !!(state.settings.apiKey || '').trim();

// A plain-language error the UI can show with a Retry button.
export class FriendlyError extends Error {
  constructor(kind, message, retryable = true) {
    super(message);
    this.kind = kind;
    this.retryable = retryable;
  }
}

function client() {
  const apiKey = (state.settings.apiKey || '').trim();
  if (!apiKey) throw new FriendlyError('missing_key', 'Add your Claude API key in Settings first.', false);
  // maxRetries: 0 — the app never retries on its own; the user taps Retry.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 120_000 });
}

function friendly(err) {
  if (err instanceof FriendlyError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new FriendlyError('auth', 'Claude did not accept your API key. Check it in Settings.', false);
  if (err instanceof Anthropic.PermissionDeniedError) return new FriendlyError('permission', 'Your Anthropic account is not allowed to make this request. Check billing and permissions in the Anthropic Console.', false);
  if (err instanceof Anthropic.NotFoundError) return new FriendlyError('model', 'That Claude model is not available to your key. Pick another model in Settings.', false);
  if (err instanceof Anthropic.RateLimitError) return new FriendlyError('rate_limit', 'Rate limit reached. Wait a minute, then tap Retry.');
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new FriendlyError('network', 'Claude took too long to answer. Check your connection, then tap Retry.');
  if (err instanceof Anthropic.APIConnectionError) return new FriendlyError('network', "Can't reach Claude. Check your internet connection, then tap Retry.");
  if (err instanceof Anthropic.InternalServerError) return new FriendlyError('busy', 'Claude is busy or having trouble right now. Tap Retry in a moment.');
  if (err instanceof Anthropic.BadRequestError) {
    if (err.error?.error?.type === 'billing_error' || err.status === 402) return new FriendlyError('billing', 'Your Anthropic account is out of credit. Add credit in the Anthropic Console.', false);
    return new FriendlyError('bad_request', 'Claude rejected the request: ' + (err.error?.error?.message || err.message), false);
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 402) return new FriendlyError('billing', 'Your Anthropic account is out of credit. Add credit in the Anthropic Console.', false);
    if (err.status === 529) return new FriendlyError('busy', 'Claude is overloaded right now. Tap Retry in a moment.');
    return new FriendlyError('api', `Claude returned an error (${err.status ?? 'unknown'}). Tap Retry.`);
  }
  if (!navigator.onLine) return new FriendlyError('network', "You're offline. Connect to the internet, then tap Retry.");
  return new FriendlyError('unknown', 'Something went wrong talking to Claude: ' + (err?.message || err));
}

// Refusal fallbacks: on Opus/Sonnet, ask the API to re-run a declined request on
// Anthropic's recommended fallback model instead of returning a refusal.
let fallbackSupported = true;

export async function createMessage(params) {
  const c = client();
  const model = params.model || currentModel();
  const body = { ...params, model };
  try {
    if (fallbackSupported && model !== 'claude-haiku-5-5') {
      try {
        return check(await c.beta.messages.create({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }));
      } catch (err) {
        // One-time compatibility fallback (not a retry loop): if this account or
        // model doesn't accept the fallbacks option, send the same request without it.
        if (err instanceof Anthropic.BadRequestError && /fallback/i.test(err.error?.error?.message || err.message)) {
          fallbackSupported = false;
        } else throw err;
      }
    }
    return check(await c.messages.create(body));
  } catch (err) {
    throw friendly(err);
  }
}

function check(res) {
  if (res.stop_reason === 'refusal') {
    const e = new FriendlyError('refusal', 'Claude declined to answer that request.', false);
    e.response = res;
    throw e;
  }
  return res;
}

export const textOf = (res) => (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

// Parse a JSON answer (structured output); a parse failure becomes a friendly "bad JSON" error.
export function jsonOf(res) {
  const t = textOf(res).replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(t);
  } catch {
    throw new FriendlyError('bad_json', "Claude's answer came back in an unexpected format. Tap Retry.");
  }
}

// Downscale an image file to a JPEG (max side `max` px). Returns { base64, dataUrl, width, height }.
export async function downscale(fileOrBlob, max = 1280, quality = 0.85) {
  let bmp;
  try {
    bmp = await createImageBitmap(fileOrBlob, { imageOrientation: 'from-image' });
  } catch {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = URL.createObjectURL(fileOrBlob);
    });
  }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { dataUrl, base64: dataUrl.split(',')[1], width: w, height: h };
}
