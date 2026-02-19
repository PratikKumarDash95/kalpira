const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow;
let nextProcess;
let serverProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // For simple migration
      enableRemoteModule: true,
    },
    // icon: path.join(__dirname, '../public/favicon.ico'), // TODO: Add icon
  });

  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';
  
  // Wait for the server to be ready before loading
  // In dev, wait-on handles this. In prod, we might need a small delay or retry logic.
  if (app.isPackaged) {
    // Retry loading URL
    const loadURL = () => {
      mainWindow.loadURL(startUrl).catch((err) => {
        console.log('Waiting for Next.js server...', err);
        setTimeout(loadURL, 1000);
      });
    };
    loadURL();
  } else {
    mainWindow.loadURL(startUrl);
  }

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', async () => {
  // Start backend server
  // Ensure we point to the correct server file
  // In dev: locate relative to this file. In prod: resourcesPath
  const serverPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'server/server.js')
    : path.join(__dirname, '../server/server.js');

  console.log('Starting Express server at:', serverPath);
  
  serverProcess = fork(serverPath, [], {
    env: { ...process.env, PORT: '3001' },
    stdio: 'inherit' 
  });

  // Start Next.js server (only if packaged, or if user wants full stack in one command)
  // Standard dev flow usually runs `next dev` separately.
  if (app.isPackaged) {
    const nextPath = path.join(__dirname, 'start-next.js'); // This file is in 'electron' folder which is copied
    console.log('Starting Next.js server at:', nextPath);
    
    nextProcess = fork(nextPath, [], {
        env: { ...process.env, NODE_ENV: 'production' },
        stdio: 'inherit'
    });
  }

  createWindow();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('will-quit', () => {
    if (serverProcess) serverProcess.kill();
    if (nextProcess) nextProcess.kill();
});
