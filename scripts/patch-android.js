// Adds the permissions needed for exact, reliable reminders to the generated Android manifest.
const fs = require('fs');
const p = 'android/app/src/main/AndroidManifest.xml';
let m = fs.readFileSync(p, 'utf8');
const perms = [
  'POST_NOTIFICATIONS',
  'SCHEDULE_EXACT_ALARM',
  'USE_EXACT_ALARM',
  'VIBRATE',
  'RECEIVE_BOOT_COMPLETED',
  'WAKE_LOCK'
];
let add = '';
for (const x of perms) {
  if (!m.includes('android.permission.' + x)) {
    add += '    <uses-permission android:name="android.permission.' + x + '" />\n';
  }
}
m = m.replace('<application', add + '    <application');
fs.writeFileSync(p, m);
console.log('Manifest patched');
