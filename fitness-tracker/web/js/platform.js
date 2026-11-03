// Platform glue: Chrome (installed web app) vs the Android app (Capacitor APK).

export const isNative = () => !!self.Capacitor?.isNativePlatform?.();
export const nativePlugin = (name) => (isNative() ? self.Capacitor?.Plugins?.[name] || null : null);

// Save a text file to the device.
// - Chrome: a normal download into Downloads.
// - Android app: written to Documents, then the share sheet opens so you can
//   also send it to Drive, email, etc.
export async function saveFile(filename, text, mime = 'application/json') {
  const fs = nativePlugin('Filesystem');
  if (fs) {
    let res, where = 'Documents';
    try {
      res = await fs.writeFile({ path: filename, data: text, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
    } catch {
      // Some Android versions block shared Documents; keep a private copy and rely on the share sheet.
      res = await fs.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8', recursive: true });
      where = 'the share sheet';
    }
    const share = nativePlugin('Share');
    if (share) {
      try { await share.share({ title: filename, files: [res.uri], dialogTitle: 'Save or send your backup' }); } catch { /* user closed the sheet */ }
    }
    return where;
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'Downloads';
}
