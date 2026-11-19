// Customises the freshly generated Capacitor Android project (android/):
// version, permissions, icons and splash. Run after `npx cap add android`.
// Usage: node scripts/prepare-android.mjs <versionCode> <versionName>
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [versionCode = '1', versionName = '1.0.0'] = process.argv.slice(2);
const root = new URL('..', import.meta.url).pathname;
const app = join(root, 'android/app');
const res = join(app, 'src/main/res');

const edit = (file, fn) => { const s = readFileSync(file, 'utf8'); const t = fn(s); if (t === s) throw new Error('No change made to ' + file); writeFileSync(file, t); };

// 1. Version (versionCode must grow for installs over the top).
edit(join(app, 'build.gradle'), (s) => s
  .replace(/versionCode \d+/, `versionCode ${parseInt(versionCode, 10)}`)
  .replace(/versionName "[^"]*"/, `versionName "${versionName}"`));

// 2. Camera for "Take photo" (Capacitor asks at runtime). Microphone comes from the
//    speech-recognition plugin's own manifest.
edit(join(app, 'src/main/AndroidManifest.xml'), (s) => s.replace('</manifest>', `    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <queries>
        <intent><action android:name="android.media.action.IMAGE_CAPTURE" /></intent>
        <intent><action android:name="android.speech.RecognitionService" /></intent>
    </queries>
</manifest>`));

// 3. Launcher icons.
for (const dir of readdirSync(join(root, 'resources'))) {
  const src = join(root, 'resources', dir);
  if (!statSync(src).isDirectory()) continue;
  for (const f of readdirSync(src)) copyFileSync(join(src, f), join(res, dir, f));
}
const bgFile = join(res, 'values/ic_launcher_background.xml');
if (existsSync(bgFile)) writeFileSync(bgFile, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0E1116</color>\n</resources>\n');

// 4. Splash screen: replace every generated splash.png with ours.
let n = 0;
for (const dir of readdirSync(res)) {
  const f = join(res, dir, 'splash.png');
  if (existsSync(f)) { copyFileSync(join(root, 'resources/splash.png'), f); n++; }
}
console.log(`Prepared Android project: versionCode ${versionCode}, versionName ${versionName}, ${n} splash images replaced.`);
