# FoolAI v3 — Build Guide

## How it works
When you open FoolAI, it automatically starts the LaMa AI backend in the background.
No terminal. No setup. Users just double-click and go.

---

## To run in dev mode (for testing)

Requirements:
- Node.js  →  https://nodejs.org
- Python 3.10+  →  https://python.org

```
npm install
pip install iopaint
npm start
```

The app will auto-launch the Python backend on startup.

---

## To build the full .exe (for distribution)

### Step 1 — Build the Python backend into an exe

```
pip install pyinstaller iopaint
pyinstaller --onefile --noconsole --name foolai_backend backend/server.py
mkdir backend_dist
copy dist\foolai_backend.exe backend_dist\
```

This bundles Python + IOPaint + LaMa launcher into a single `foolai_backend.exe`.

### Step 2 — Build the Electron app

```
npm install
npm run build:win
```

The final portable `.exe` lands in `dist/`.
It includes the Python backend inside — no install required for end users.

---

## For end users
- Double-click `FoolAI.exe`
- On first use of LaMa, it downloads model weights (~300MB) once
- After that it's instant

---

## GPU acceleration (optional)
Edit `backend/server.py` and change:
```
--device=cpu
```
to:
```
--device=cuda
```
Then rebuild the backend exe. Requires NVIDIA GPU + CUDA.
