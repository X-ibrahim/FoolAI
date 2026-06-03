const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const http = require('http');

let pythonProcess = null;
let mainWin = null;

// ── Find the bundled Python backend ──
function getBackendPath() {
  // When packaged as .exe via electron-builder, extraResources lands here:
  const packed = path.join(process.resourcesPath, 'backend', 'foolai_backend.exe');
  if (fs.existsSync(packed)) return { exe: packed, args: [] };

  // Dev mode — run server.py with python/python3
  const devScript = path.join(__dirname, 'backend', 'server.py');
  if (fs.existsSync(devScript)) {
    const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
    return { exe: pyCmd, args: [devScript] };
  }
  return null;
}

// ── Start the Python/IOPaint backend ──
function startBackend() {
  const backend = getBackendPath();
  if (!backend) {
    console.log('[Backend] No backend found — watermark removal will use browser fallback only');
    return;
  }

  console.log('[Backend] Starting:', backend.exe, backend.args.join(' '));

  pythonProcess = spawn(backend.exe, backend.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true   // ← this hides the console window on Windows
  });

  pythonProcess.stdout.on('data', d => {
    const msg = d.toString().trim();
    console.log('[Backend]', msg);
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('backend-log', msg);
  });
  pythonProcess.stderr.on('data', d => {
    const msg = d.toString().trim();
    console.error('[Backend ERR]', msg);
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('backend-log', msg);
  });
  pythonProcess.on('close', code => {
    console.log('[Backend] exited with code', code);
    pythonProcess = null;
  });
  pythonProcess.on('error', err => {
    console.error('[Backend] Failed to start:', err.message);
    pythonProcess = null;
  });

  console.log('[Backend] PID:', pythonProcess.pid);
}

// ── Wait for backend to be ready (poll /api/v1/model) ──
function waitForBackend(maxWaitMs = 60000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const req = http.get('http://127.0.0.1:8080/api/v1/model', (res) => {
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - start < maxWaitMs) {
          setTimeout(check, 1000);
        } else {
          resolve(false);
        }
      });
      req.setTimeout(800, () => { req.destroy(); });
    };
    setTimeout(check, 2000); // give it 2s head start before polling
  });
}

// ── Kill backend on exit ──
function killBackend() {
  if (pythonProcess) {
    try { pythonProcess.kill('SIGTERM'); } catch(e) {}
    pythonProcess = null;
  }
}

// ── Create main window ──
function createWindow() {
  mainWin = new BrowserWindow({
    width: 1140,
    height: 920,
    minWidth: 960,
    minHeight: 820,
    frame: false,
    backgroundColor: '#0f0f0f',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWin.loadFile('index.html');
}

// ── Boot sequence ──
app.whenReady().then(async () => {
  startBackend();
  createWindow();

  // Notify renderer once backend is ready (or timed out)
  waitForBackend(600000).then(online => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('backend-status', online);
    }
  });
});

app.on('window-all-closed', () => {
  killBackend();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => killBackend());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC handlers ──
ipcMain.handle('minimize-window', () => mainWin?.minimize());
ipcMain.handle('maximize-window', () => mainWin?.isMaximized() ? mainWin.unmaximize() : mainWin?.maximize());
ipcMain.handle('close-window',    () => mainWin?.close());
ipcMain.handle('open-folder',     (_, p) => { require('electron').shell.openPath(p); });
ipcMain.handle('select-output-folder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('save-file', async (_, { defaultName, filters }) => {
  const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('read-file-base64', (_, p) => fs.readFileSync(p).toString('base64'));
ipcMain.handle('write-file-base64', (_, { filePath, base64 }) => {
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return true;
});
ipcMain.handle('ensure-dir', (_, p) => { fs.mkdirSync(p, { recursive: true }); return true; });
ipcMain.handle('check-backend', async () => {
  return new Promise(resolve => {
    const req = http.get('http://127.0.0.1:8080/api/v1/model', res => resolve(true));
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
});

// ── Upscayl binary paths (mirrors Upscayl's get-resource-paths.ts) ──
function getUpscaylPaths() {
  const isDev = !app.isPackaged;
  const base = isDev
    ? path.join(__dirname, 'resources', 'upscayl')
    : path.join(process.resourcesPath, 'upscayl');
  return {
    bin:    path.join(base, 'bin', process.platform === 'win32' ? 'upscayl-bin.exe' : 'upscayl-bin'),
    models: path.join(base, 'models'),
  };
}

// Check if binary + models are present
ipcMain.handle('check-upscale-binary', () => {
  const { bin, models } = getUpscaylPaths();
  const binExists    = fs.existsSync(bin);
  const modelsExist  = fs.existsSync(models) && fs.readdirSync(models).some(f => f.endsWith('.param'));
  return { ready: binExists && modelsExist, binExists, modelsExist, binPath: bin, modelsPath: models };
});

// Upscale a single image — mirrors Upscayl's imageUpscayl command exactly
ipcMain.handle('upscayl-image', (event, payload) => {
  const { filePath, outputDir, model, scale, format, tileSize } = payload;
  const { bin, models } = getUpscaylPaths();

  if (!fs.existsSync(bin)) {
    return { error: 'upscayl-bin not found — see README for setup.' };
  }

  const fileName     = path.basename(filePath);
  const fileNameNoExt = path.parse(fileName).name;
  const outFile      = path.join(outputDir, `${fileNameNoExt}_upscayl_${scale}x_${model}.${format}`);

  // Build CLI args exactly as Upscayl does in get-arguments.ts
  const args = [
    '-i', filePath,
    '-o', outFile,
    '-m', models,
    '-n', model,
    '-f', format,
    '-c', '0',
  ];
  if (tileSize)            args.push('-t', String(tileSize));
  // -s only when the model scale (always 4) differs from requested scale
  if (String(scale) !== '4') args.push('-s', String(scale));

  console.log('[Upscayl] Spawning:', bin, args.join(' '));

  return new Promise(resolve => {
    const proc = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let failed = false;

    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      const progress = parseFloat(msg);
      if (!isNaN(progress)) {
        if (mainWin && !mainWin.isDestroyed())
          mainWin.webContents.send('upscayl-progress', { file: fileName, progress });
      }
      if (msg.includes('Error') || msg.includes('failed')) {
        failed = true;
        proc.kill();
        resolve({ error: msg });
      }
    });

    proc.on('error', err => resolve({ error: err.message }));
    proc.on('close', code => {
      if (!failed) resolve({ outFile });
    });
  });
});
