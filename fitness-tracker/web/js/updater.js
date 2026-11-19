// Live updates for the Android app (APK).
// Every website deploy also publishes bundle.zip + bundle.json. When the app
// opens (or comes back to the screen) it checks bundle.json; if there is a newer
// build it downloads it, verifies the checksum, and switches to it. The app keeps
// the same storage, so all your data stays. If a new build fails to start, the
// plugin rolls back to the previous one automatically.
import { nativePlugin } from './platform.js';
import { flush } from './store.js';
import { toast } from './util.js';

const REMOTE = 'https://menonblack.github.io/my-apps/fitness/bundle.json';
const LU = () => nativePlugin('LiveUpdate');
let checking = false;
let lastCheck = 0;

export async function currentBuildId() {
  try {
    const r = await fetch('build.json', { cache: 'no-store' });
    if (r.ok) return (await r.json()).id || null;
  } catch { /* not present in the bundled copy */ }
  return null;
}

const busy = () => {
  const a = document.activeElement;
  return self.__liftlogBusy || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value);
};

// Returns 'none' | 'updated' | 'pending' | 'error:<msg>'
export async function checkForUpdate({ manual = false } = {}) {
  const lu = LU();
  if (!lu || checking) return 'none';
  checking = true;
  lastCheck = Date.now();
  try {
    const res = await fetch(REMOTE + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('update server returned ' + res.status);
    const remote = await res.json();
    if (!remote?.id || !remote?.url) throw new Error('bad update info');
    const mine = await currentBuildId();
    if (remote.id === mine) return 'none';
    const { bundleIds = [] } = await lu.getBundles().catch(() => ({}));
    if (!bundleIds.includes(remote.id)) {
      if (manual) toast('Downloading update…');
      await lu.downloadBundle({ bundleId: remote.id, url: remote.url, checksum: remote.sha256 });
    }
    await lu.setNextBundle({ bundleId: remote.id });
    if (busy()) return 'pending'; // applied next time the app opens
    await flush();
    try { sessionStorage.setItem('liftlog:updated', '1'); } catch { /* ignore */ }
    await lu.reload();
    return 'updated';
  } catch (err) {
    return 'error:' + (err?.message || err);
  } finally {
    checking = false;
  }
}

export async function initLiveUpdates() {
  const lu = LU();
  if (!lu) return;
  // Tell the plugin this build started fine (otherwise it rolls back).
  try {
    const r = await lu.ready();
    if (r?.rollback) toast('The last update had a problem, so the previous version was restored.');
  } catch { /* ignore */ }
  try { if (sessionStorage.getItem('liftlog:updated')) { sessionStorage.removeItem('liftlog:updated'); toast('Updated to the latest version'); } } catch { /* ignore */ }
  checkForUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60_000) checkForUpdate();
  });
}
