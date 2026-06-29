# Installing Quantum Law Group (Windows)

Quantum Law Group is a self-contained desktop app. **No administrator rights are required** — it installs into your user profile.

## Option 1 — Easy install (recommended)

1. Unzip `Quantum-Law-Group-<version>-win-arm64.zip` anywhere (e.g. your Downloads folder).
2. Open the unzipped `Quantum-Law-Group` folder.
3. Double-click **`Install Quantum Law Group.bat`**.
   - If Windows SmartScreen warns you, click **More info → Run anyway** (the app is unsigned).
4. When it finishes, launch **Quantum Law Group** from the Start Menu or the Desktop shortcut.

This copies the app to `%LOCALAPPDATA%\Programs\Quantum Law Group` and creates Start Menu + Desktop shortcuts.

## Option 2 — Command line install

If you can't run the `.bat` (e.g. locked-down policy, or you prefer a terminal):

```powershell
# from inside the unzipped Quantum-Law-Group folder
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install.ps1"
```

## Option 3 — Portable (no install at all)

Just run it in place — no install step needed:

```powershell
# from inside the unzipped folder
& ".\Quantum Law Group\Quantum Law Group.exe"
```

You can also double-click `Quantum Law Group\Quantum Law Group.exe` directly.

## First run

1. Open **Settings** (left sidebar).
2. Paste your **Anthropic API key** (from <https://console.anthropic.com>) and click **Save**. It's encrypted on your machine with Windows DPAPI and never leaves your computer.
3. Pick a workflow from the launchpad and go.

Your matters, drafts, and settings live in `%APPDATA%\quantumlawgroup`.

## Uninstall

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\uninstall.ps1"
```

(or delete `%LOCALAPPDATA%\Programs\Quantum Law Group` and the two shortcuts.)

## Notes

- This build targets **Windows on ARM (arm64)**. For Intel/AMD machines, rebuild with `--arch=x64`.
- The app is **not code-signed**, so SmartScreen will prompt on first run — this is expected for an in-house build.
