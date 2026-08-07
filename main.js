const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
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
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWin.loadFile('index.html');

  // ── Ctrl/Cmd +/- /0 to zoom, handled by hand instead of relying on ──
  // Electron's invisible default menu (there's no visible menu bar here —
  // frame: false — and, separately, that default menu's "zoomIn" role binds
  // to a "Plus" key token that Chromium often fails to match against what a
  // keyboard actually sends for Ctrl+= (no Shift held), so Ctrl+- (which has
  // no such ambiguity) works while Ctrl+/Ctrl+= silently does nothing.
  // Checking input.key directly for both the unshifted and shifted glyphs
  // (main row '='/'+' and numpad Add/Subtract) sidesteps that entirely.
  const ZOOM_STEP = 0.5, ZOOM_MIN = -4, ZOOM_MAX = 6;
  mainWin.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || (!input.control && !input.meta)) return;
    const wc = mainWin.webContents;
    if (input.key === '=' || input.key === '+') {
      event.preventDefault();
      wc.setZoomLevel(Math.min(ZOOM_MAX, wc.getZoomLevel() + ZOOM_STEP));
    } else if (input.key === '-' || input.key === '_') {
      event.preventDefault();
      wc.setZoomLevel(Math.max(ZOOM_MIN, wc.getZoomLevel() - ZOOM_STEP));
    } else if (input.key === '0') {
      event.preventDefault();
      wc.setZoomLevel(0);
    }
  });
}

// ── Boot sequence ──
app.whenReady().then(async () => {
  // There's no visible menu bar (frame: false), but Electron still installs
  // an invisible default one with its own zoom/reload accelerators. Strip it
  // so the before-input-event zoom handler above is the single source of
  // truth — otherwise Ctrl+-/Ctrl+0 would double-fire against it.
  Menu.setApplicationMenu(null);

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

// ── Web Optimize (Sharp) ──
ipcMain.handle('optimize-image', async (event, { filePath, outputDir, format, quality, maxWidth, stripMeta }) => {
  try {
    const sharp = require('sharp');
    const originalSize = fs.statSync(filePath).size;
    const nameNoExt = path.parse(filePath).name;
    const outExt = format === 'jpeg' ? 'jpg' : format;
    const outFile = path.join(outputDir, `${nameNoExt}_opt.${outExt}`);

    let pipeline = sharp(filePath);

    if (maxWidth && maxWidth > 0) {
      pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
    }

    if (!stripMeta) {
      pipeline = pipeline.withMetadata();
    }

    switch (format) {
      case 'webp': pipeline = pipeline.webp({ quality, effort: 4 }); break;
      case 'jpeg': pipeline = pipeline.jpeg({ quality, mozjpeg: true, progressive: true }); break;
      case 'avif': pipeline = pipeline.avif({ quality, effort: 4 }); break;
      case 'png':  pipeline = pipeline.png({ compressionLevel: 9, effort: 9 }); break;
    }

    await pipeline.toFile(outFile);
    const finalSize = fs.statSync(outFile).size;
    return { outFile, originalSize, finalSize };
  } catch (e) {
    return { error: e.message };
  }
});

// ── Print Plotter (Sharp) ──
// Resizes one poster to the exact pixel size its physical print dimensions
// require at the given DPI. Rotation for nesting is a placement-only detail
// (see cut_list.csv) — the file itself is exported upright.
ipcMain.handle('plotter-export-poster', async (event, { filePath, name, outputDir, widthCm, heightCm, dpi }) => {
  try {
    const sharp = require('sharp');
    const printDir = path.join(outputDir, 'print_ready');
    fs.mkdirSync(printDir, { recursive: true });
    const cmToPx = cm => Math.max(1, Math.round(cm / 2.54 * dpi));
    const w = cmToPx(widthCm), h = cmToPx(heightCm);
    const nameNoExt = path.parse(name || filePath).name;
    const outFile = path.join(printDir, `${nameNoExt}_${widthCm}x${heightCm}cm_${dpi}dpi.png`);
    // 'cover' scales uniformly (no distortion) and crops any overflow, centered —
    // never stretches the source image to fit the target print size.
    await sharp(filePath).resize(w, h, { fit: 'cover', position: 'centre' }).png().toFile(outFile);
    return { outFile, widthPx: w, heightPx: h };
  } catch (e) {
    return { error: e.message };
  }
});

// Generic text file writer (used for the plotter's cut_list.csv)
ipcMain.handle('write-text-file', (_, { filePath, content }) => {
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
});

// Builds the single hand-to-the-print-shop file: one PDF page sized exactly
// to the roll width × the length actually used, with every poster embedded
// at its full source resolution, in its correct nested position and
// orientation. Page space maps 1:1 onto roll space — no transpose — so a
// piece the nester did NOT rotate is embedded upright (its own width runs
// across the page/roll width, its own height runs down the page/roll
// length — the natural, no-rotation placement), and a piece the nester DID
// rotate 90° for a tighter fit is embedded rotated 90° to match, exactly as
// it would need to be physically turned on the roll.
ipcMain.handle('plotter-export-pdf', async (event, { items, rollWidthCm, usedLengthCm, outputDir, fileName }) => {
  try {
    const PDFDocument = require('pdfkit');
    const sharp = require('sharp');
    fs.mkdirSync(outputDir, { recursive: true });
    const cmToPt = cm => (cm / 2.54) * 72;
    const pageW = cmToPt(rollWidthCm);
    const pageH = cmToPt(usedLengthCm);
    const outFile = path.join(outputDir, fileName || 'print_layout.pdf');

    const doc = new PDFDocument({ size: [pageW, pageH], margin: 0, autoFirstPage: true });
    const stream = fs.createWriteStream(outFile);
    doc.pipe(stream);

    doc.rect(0, 0, pageW, pageH).fill('#ffffff');

    const errors = [];
    let placedCount = 0;

    for (const it of items) {
      const x = cmToPt(it.xCm), y = cmToPt(it.yCm);
      const w = cmToPt(it.wCm), h = cmToPt(it.hCm);
      try {
        // Pre-rotate the actual pixel data with sharp for rotated pieces,
        // rather than using PDFKit's rotate()+save()/restore(). Measured
        // directly: repeated rotate()/restore() cycles across several image
        // placements in one PDFKit document corrupt the orientation of
        // later images — including ones that were never themselves rotated.
        // Rotating the source bytes once, up front, sidesteps that bug
        // entirely and keeps every placement a plain, unrotated embed.
        //
        // Always round-trip through sharp (not just for rotated pieces):
        // PDFKit can only embed raw JPEG/PNG data directly, so a source
        // file in any other format (WEBP, TIFF, BMP, AVIF, HEIC…) would
        // otherwise throw here and silently drop that poster. `png()`
        // guarantees a format PDFKit can always embed. `limitInputPixels:
        // false` disables sharp's default ~268-megapixel decompression-bomb
        // guard, which real large-format print sources can legitimately
        // exceed. `failOn: 'none'` tolerates minor/non-fatal file quirks
        // instead of aborting on them.
        let pipeline = sharp(it.filePath, { limitInputPixels: false, failOn: 'none' });
        if (it.rotated) pipeline = pipeline.rotate(90);
        const buf = await pipeline.png().toBuffer();
        const meta = await sharp(buf).metadata();
        const iw = meta.width, ih = meta.height;

        // Cover-fit by hand: scale to the larger of the two ratios, center, crop via clip.
        const scale = Math.max(w / iw, h / ih);
        const dw = iw * scale, dh = ih * scale;
        const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;

        doc.save();
        doc.rect(x, y, w, h).clip(); // never let a scaled-to-cover image bleed past its footprint
        doc.image(buf, dx, dy, { width: dw, height: dh });
        doc.restore();
        placedCount++;
      } catch (e) {
        console.error('[Plotter PDF] failed to place', it.filePath, e.message);
        errors.push({ file: it.filePath, message: e.message });
      }
    }

    doc.end();
    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
    return { outFile, placedCount, totalCount: items.length, errors };
  } catch (e) {
    return { error: e.message };
  }
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
ipcMain.handle('upscayl-image', async (event, payload) => {
  const { filePath: rawPath, base64, name, outputDir, model, scale, format, tileSize } = payload;
  const { bin, models } = getUpscaylPaths();

  if (!fs.existsSync(bin)) {
    return { error: 'upscayl-bin not found — see README for setup.' };
  }

  let filePath = rawPath;
  let tempFile = null;

  // If the image has no disk path, write its base64 data to a temp file
  if (!filePath && base64) {
    const ext  = name ? (path.extname(name) || '.png') : '.png';
    const stem = name ? path.parse(name).name : 'upscale_input';
    tempFile = path.join(os.tmpdir(), `foolai_${Date.now()}_${stem}${ext}`);
    const b64data = base64.includes(',') ? base64.split(',')[1] : base64;
    fs.writeFileSync(tempFile, Buffer.from(b64data, 'base64'));
    filePath = tempFile;
  }

  if (!filePath) {
    return { error: 'No file path available for this image.' };
  }

  const fileName      = name || path.basename(filePath);
  const fileNameNoExt = path.parse(name || path.basename(filePath)).name;
  const outFile       = path.join(outputDir, `${fileNameNoExt}_upscayl_${scale}x_${model}.${format}`);

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

    const cleanup = () => { if (tempFile) try { fs.unlinkSync(tempFile); } catch {} };

    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (!msg) return;
      const progress = parseFloat(msg);
      if (!isNaN(progress)) {
        if (mainWin && !mainWin.isDestroyed())
          mainWin.webContents.send('upscayl-progress', { file: fileName, progress });
      } else {
        if (mainWin && !mainWin.isDestroyed())
          mainWin.webContents.send('upscayl-log', msg);
      }
      if (msg.includes('Error') || msg.includes('failed')) {
        failed = true;
        proc.kill();
        cleanup();
        resolve({ error: msg });
      }
    });

    proc.on('error', err => { cleanup(); resolve({ error: err.message }); });
    proc.on('close', () => { cleanup(); if (!failed) resolve({ outFile }); });
  });
});
