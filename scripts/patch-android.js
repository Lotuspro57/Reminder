// Runs in CI after `cap add android` and before `cap sync`.
// 1) manifest permissions  2) notification small icon  3) alarm tone WAV files
const fs = require('fs');
const path = require('path');

const MAIN = 'android/app/src/main';

/* ---------- 1. Manifest permissions ---------- */
const manifestPath = path.join(MAIN, 'AndroidManifest.xml');
let m = fs.readFileSync(manifestPath, 'utf8');
const perms = ['POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM', 'USE_EXACT_ALARM', 'VIBRATE', 'RECEIVE_BOOT_COMPLETED', 'WAKE_LOCK', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'];
let add = '';
for (const x of perms) {
  if (!m.includes('android.permission.' + x)) add += '    <uses-permission android:name="android.permission.' + x + '" />\n';
}
m = m.replace('<application', add + '    <application');
fs.writeFileSync(manifestPath, m);

/* ---------- 2. Small notification icon (white bell vector) ---------- */
const drawable = path.join(MAIN, 'res/drawable');
fs.mkdirSync(drawable, { recursive: true });
fs.writeFileSync(path.join(drawable, 'ic_stat_limit.xml'),
`<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFFFF"
      android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.9,2 2,2zM18,16v-5c0,-3.07 -1.63,-5.64 -4.5,-6.32V4c0,-0.83 -0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.64,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z"/>
</vector>
`);

/* ---------- 3. Alarm tones ---------- */
const SR = 22050;
function wav(samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 30000), 44 + i * 2);
  }
  return b;
}
function tone(freq, dur, o = {}) {
  const vol = o.vol ?? 0.6, decay = o.decay ?? 4, harm = o.harm ?? [1];
  const n = Math.floor(SR * dur), out = new Array(n), norm = harm.reduce((a, c) => a + c, 0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    harm.forEach((h, k) => { v += h * Math.sin(2 * Math.PI * freq * (k + 1) * t); });
    const env = Math.exp(-decay * i / n) * Math.min(1, i / 150) * Math.min(1, (n - i) / 300);
    out[i] = (v / norm) * vol * env;
  }
  return out;
}
const rest = d => new Array(Math.floor(SR * d)).fill(0);
const cat = (...a) => [].concat(...a);
const repeat = (parts, k) => cat(...Array.from({ length: k }, () => cat(...parts)));

const sounds = {
  chime: cat(tone(1046, 0.45, { decay: 5 }), tone(1318, 0.45, { decay: 5 }), tone(1568, 1.0, { decay: 5 })),
  bell: tone(880, 2.0, { harm: [1, 0.5, 0.3, 0.2], decay: 3 }),
  beep: repeat([tone(1000, 0.18, { decay: 0.3, vol: 0.5 }), rest(0.12)], 4),
  alarm: repeat([tone(880, 0.25, { decay: 0.3, vol: 0.7 }), tone(660, 0.25, { decay: 0.3, vol: 0.7 })], 5)
};

const dirs = [path.join(MAIN, 'res/raw'), 'www/sounds'];
dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));
for (const [name, samples] of Object.entries(sounds)) {
  const buf = wav(samples);
  dirs.forEach(d => fs.writeFileSync(path.join(d, name + '.wav'), buf));
}
/* ---------- 4. Native plugin: open phone settings pages ---------- */
const javaDir = path.join(MAIN, 'java/com/limitbell/app');
fs.mkdirSync(javaDir, { recursive: true });

fs.writeFileSync(path.join(javaDir, 'MainActivity.java'),
`package com.limitbell.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SettingsOpener.class);
        super.onCreate(savedInstanceState);
    }
}
`);

fs.writeFileSync(path.join(javaDir, 'SettingsOpener.java'),
`package com.limitbell.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SettingsOpener")
public class SettingsOpener extends Plugin {

    private boolean start(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private Uri pkgUri() {
        return Uri.parse("package:" + getContext().getPackageName());
    }

    private boolean openAutostart() {
        String[][] list = {
            {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
            {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
            {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
            {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
            {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
            {"com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"}
        };
        for (String[] x : list) {
            Intent i = new Intent();
            i.setComponent(new ComponentName(x[0], x[1]));
            if (start(i)) return true;
        }
        return false;
    }

    @PluginMethod
    public void open(PluginCall call) {
        String target = call.getString("target", "app");
        String pkg = getContext().getPackageName();
        boolean ok = false;

        switch (target) {
            case "notif": {
                if (Build.VERSION.SDK_INT >= 26) {
                    Intent i = new Intent("android.settings.APP_NOTIFICATION_SETTINGS");
                    i.putExtra("android.provider.extra.APP_PACKAGE", pkg);
                    ok = start(i);
                }
                break;
            }
            case "exact": {
                if (Build.VERSION.SDK_INT >= 31) {
                    ok = start(new Intent("android.settings.REQUEST_SCHEDULE_EXACT_ALARM", pkgUri()));
                }
                break;
            }
            case "battery": {
                if (Build.VERSION.SDK_INT >= 23) {
                    ok = start(new Intent("android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", pkgUri()));
                    if (!ok) ok = start(new Intent("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS"));
                }
                break;
            }
            case "autostart": {
                ok = openAutostart();
                break;
            }
            default:
                break;
        }

        boolean direct = ok;
        if (!ok) {
            ok = start(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri()));
        }

        JSObject r = new JSObject();
        r.put("opened", ok);
        r.put("direct", direct);
        call.resolve(r);
    }

    @PluginMethod
    public void status(PluginCall call) {
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= 23) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            ignoring = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        }
        JSObject r = new JSObject();
        r.put("batteryUnrestricted", ignoring);
        call.resolve(r);
    }
}
`);

console.log('Android project patched (manifest, icon, sounds, settings plugin)');
