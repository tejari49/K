# K
Kalender

## Android APK (Capacitor)

Diese App besteht aus einer einzigen HTML-Datei. Für eine Android-APK wird Capacitor genutzt.

### Voraussetzungen
- Node.js (>=20)
- Android Studio + SDK

### Setup
```bash
npm install
```

### Android-Projekt erzeugen
```bash
npx cap add android
npx cap copy
```

### APK bauen
```bash
cd android
./gradlew assembleDebug
```

Das APK liegt anschließend unter `android/app/build/outputs/apk/debug/`.

Windows:
```bash
cd android
gradlew.bat assembleDebug
```
