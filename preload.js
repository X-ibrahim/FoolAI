const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow:   ()        => ipcRenderer.invoke('minimize-window'),
  maximizeWindow:   ()        => ipcRenderer.invoke('maximize-window'),
  closeWindow:      ()        => ipcRenderer.invoke('close-window'),
  // Folder / file
  selectOutputFolder: ()      => ipcRenderer.invoke('select-output-folder'),
  openFolder:       (p)       => ipcRenderer.invoke('open-folder', p),
  saveFile:         (opts)    => ipcRenderer.invoke('save-file', opts),
  readFileBase64:   (p)       => ipcRenderer.invoke('read-file-base64', p),
  writeFileBase64:  (opts)    => ipcRenderer.invoke('write-file-base64', opts),
  ensureDir:        (p)       => ipcRenderer.invoke('ensure-dir', p),
  // Backend (IOPaint / watermark)
  checkBackend:     ()        => ipcRenderer.invoke('check-backend'),
  onBackendStatus:  (cb)      => ipcRenderer.on('backend-status', (_, online) => cb(online)),
  onBackendLog:     (cb)      => ipcRenderer.on('backend-log', (_, msg) => cb(msg)),
  // Upscayl binary
  checkUpscaylBinary: ()      => ipcRenderer.invoke('check-upscale-binary'),
  upscaylImage:     (payload) => ipcRenderer.invoke('upscayl-image', payload),
  onUpscaylProgress:(cb)      => ipcRenderer.on('upscayl-progress', (_, d) => cb(d)),
  onUpscaylLog:     (cb)      => ipcRenderer.on('upscayl-log', (_, msg) => cb(msg)),
  // Web Optimize
  optimizeImage:    (payload) => ipcRenderer.invoke('optimize-image', payload),
  // Print Plotter
  plotterExportPoster: (payload) => ipcRenderer.invoke('plotter-export-poster', payload),
  plotterExportPdf: (payload) => ipcRenderer.invoke('plotter-export-pdf', payload),
  writeTextFile:    (opts)    => ipcRenderer.invoke('write-text-file', opts),
  // File path resolution (replaces deprecated file.path)
  getFilePath:      (file)    => webUtils.getPathForFile(file),
  // Platform info — e.g. flagging Windows-only features (Upscayl) on macOS/Linux
  platform:         process.platform,
});
