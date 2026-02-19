# TimeRoster – GitHub Pages PWA + Firebase Push (FCM)

## 1) GitHub Pages Hosting
1. Repository erstellen (oder vorhandenes nutzen).
2. Diese Dateien in den Repo-Root legen:
   - index.html
   - sw.js
   - manifest.webmanifest
   - icons/...
   - .nojekyll
3. GitHub → Settings → Pages:
   - Source: Deploy from a branch
   - Branch: main / (root)
4. URL: https://tejari49.github.io/Meal/

## 2) Push aktivieren (FCM)
Wichtig: Push benötigt **Firebase Cloud Functions** (Admin-SDK), GitHub Pages kann nicht selbst Push senden.

### A) VAPID Key setzen
Firebase Console → Project Settings → Cloud Messaging → **Web Push certificates**
- Public key (VAPID) kopieren
- In der App: Einstellungen → Benachrichtigungen → **FCM VAPID Key** einfügen → Speichern → Push aktivieren

### B) Functions deployen
Voraussetzung: Firebase CLI installiert und eingeloggt.

Im Projektordner (Repo-Root):
```bash
firebase use calender-rai
cd functions
npm install
cd ..
firebase deploy --only functions
```

## 3) Neutraler Text
Alle Push/Local Benachrichtigungen sind absichtlich neutral:
- Titel: **Kalender aktualisiert**
- Text: **Es gibt neue Updates.**
