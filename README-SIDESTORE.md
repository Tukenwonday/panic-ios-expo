# Panic Button — iOS app for SideStore

One fullscreen button that fires your PC panic server:

```
POST http://<PC-IP>:8080/panic
→ "Panic routine executed successfully."
```

The PC (`MyScript.exe` → Start Server) stays the server. This app is only the remote.

## 0. What you need

- Windows PC with Node 22+ (you have it)
- Free GitHub account
- iPhone with SideStore already set up + your free Apple ID
- iPhone + PC on the **same Wi-Fi**
- PC server showing `Status: Running` + URL like `http://192.168.1.10:8080/panic`
- Windows Firewall inbound rule allowing `8080` (or test with firewall off briefly)

## 1. Run it first in Expo Go (optional, instant check)

```bat
cd panic-ios
npm ci
npx expo start
```

Scan the QR with iPhone camera → opens in Expo Go. If POST fails here it will also fail as IPA — fix IP/firewall first.

> Note: Expo Go uses its own bundle ID/plist, so LAN http may behave slightly
> differently than the final build. Final build sets
> `NSAllowsArbitraryLoads=true` + `NSLocalNetworkUsageDescription`.

## 2. Build the unsigned IPA (free, no Mac, no $99)

This folder **is** the repo. Push it to GitHub as repo root:

```bat
cd panic-ios
git init
git add -A
git commit -m "panic ios v1"
git branch -M main
git remote add origin https://github.com/YOU/panic-button.git
git push -u origin main
```

Then:

1. GitHub → Actions → `iOS unsigned IPA (SideStore)` → Run workflow
2. Wait ~8–15 min (cloud Mac: prebuild → pod install → xcodebuild archive unsigned)
3. Download artifact `Panic-unsigned-ipa` → `Panic-unsigned.ipa`

What the workflow does: `expo prebuild` (applies `app.json` ATS + bundle ID
`com.myscript.panicbutton`) → `pod install` → `xcodebuild archive
CODE_SIGNING_ALLOWED=NO` → zip `Payload/*.app` → `.ipa`. No Apple cert needed
at build time.

## 3. Install via SideStore

1. Send `Panic-unsigned.ipa` to iPhone (iCloud Drive / Files / Discord / USB).
2. SideStore → My Apps → `+` → pick the `.ipa` → signs with your Apple ID.
3. iOS `Settings → General → VPN & Device Management` → Trust your Apple ID.
4. Open **Panic** → ⚙ → set PC IP (default `192.168.1.10`) + port `8080` → Save.
5. Tap anywhere red → `Sending…` → `✓ Panic routine executed successfully.`
   PC status flips to `Done:…` proving `DoActions()` ran.

Free Apple ID limits: **3 sideloaded apps, 7-day expiry**. Keep SideStore's
VPN/background refresh on + same Wi-Fi or re-refresh manually.

## 4. Troubleshooting

| Symptom | Fix |
|---|---|
| `Unreachable` in app | Same Wi-Fi? `Start Server` green? `curl -X POST http://<IP>:8080/panic` from PC works? Firewall inbound 8080? IP changed? (router DHCP — update in ⚙) |
| `Timed out` | PC asleep? Server stopped? VPN on iPhone routing LAN away? |
| Build fails `scheme not found` | Workflow auto-detects scheme; check Actions log `xcodebuild -list` output |
| `pod install` fails | Re-run (CocoaPods CDN flake). Expo SDK 57 needs Xcode 26.4+ — workflow auto-selects latest |
| SideStore `Unable to install` | Free ID already has 3 apps? Delete one. Expired cert? Refresh. Trust profile? |
| Button works in Expo Go but not IPA | IPA ATS? We set `NSAllowsArbitraryLoads`. Rebuild after `app.json` change |

## 5. Files

- `App.js` — fullscreen gradient button + settings sheet + POST logic
- `lib/panic.js` — pure `buildPanicUrl/normalizeIp/normalizePort` (unit-tested)
- `app.json` — `com.myscript.panicbutton`, ATS arbitrary loads, local-network string
- `.github/workflows/ios-unsigned-ipa.yml` — unsigned cloud build
