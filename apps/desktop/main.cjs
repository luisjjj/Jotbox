const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PROD_URL = "https://jotbox-eight.vercel.app";
const DEV_URL = "http://localhost:5173";
const SMOKE = process.argv.includes("--smoke-test");
const DEV = process.argv.includes("--dev");

// Keep smoke runs away from an installed JotBox that already holds the lock.
if (SMOKE) app.setPath("userData", path.join(os.tmpdir(), "jotbox-smoke"));

const BASE_URL = (
  SMOKE
    ? process.env.JOTBOX_SMOKE_URL || "http://localhost:4173"
    : process.env.JOTBOX_DESKTOP_URL || (DEV ? DEV_URL : PROD_URL)
).replace(/\/+$/, "");

const APP_ORIGIN = new URL(BASE_URL).origin;
const ISLAND_WIDTH = 460;
const ISLAND_HEIGHT = 220;
const SPLASH_WIDTH = 400;
const SPLASH_HEIGHT = 240;
const ALLOWED_PERMISSIONS = new Set([
  "media",
  "display-capture",
  "notifications",
  "clipboard-sanitized-write",
  "fullscreen",
]);
const ASSETS = path.join(__dirname, "assets");

let mainWindow = null;
let islandWindow = null;
let islandShown = false;
let splashWindow = null;
let splashDone = false;
let splashOpenedAt = 0;
let splashTimer = null;
let pickerWindow = null;
let pickerSources = [];
let pickerResolver = null;
let tray = null;
let trayLabel = "";
let quitting = false;
let autoUpdater = null;
let updatePrompted = false;
let blankTimer = null;
let blankReloads = 0;
let loadRetries = 0;
let lastState = {
  status: "idle",
  elapsed: 0,
  title: "",
  interim: "",
  lines: [],
  captions: false,
  kind: "meeting",
  at: 0,
};

function sameOrigin(url) {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function trusted(content) {
  return Boolean(content) && sameOrigin(content.getURL());
}

function appMenu() {
  return Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [{ role: "quit", label: "Quit JotBox" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
  ]);
}

function islandBounds() {
  const display =
    mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(mainWindow.getBounds())
      : screen.getPrimaryDisplay();
  const area = display.workArea;
  return {
    width: ISLAND_WIDTH,
    height: ISLAND_HEIGHT,
    x: Math.round(area.x + (area.width - ISLAND_WIDTH) / 2),
    y: Math.round(area.y + 6),
  };
}

function guardNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!sameOrigin(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
}

function hardenSession() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((content, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && trusted(content));
  });

  ses.setPermissionCheckHandler((content, permission) => {
    if (!ALLOWED_PERMISSIONS.has(permission)) return false;
    return !content || trusted(content);
  });

  // On Windows, loopback audio captures the same sound the room hears, which
  // includes the call, without asking the browser for tab audio.
  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const source = await chooseDisplaySource();
        if (!source) {
          callback({});
          return;
        }
        callback(request.audioRequested ? { video: source, audio: "loopback" } : { video: source });
      } catch {
        callback({});
      }
    },
    { useSystemPicker: false },
  );
}

async function clearShellCaches() {
  try {
    await session.defaultSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] });
  } catch (error) {
    console.warn("JotBox could not clear its web cache:", error?.message || error);
  }
}

async function pageIsBlank() {
  if (!mainWindow || mainWindow.isDestroyed()) return true;
  try {
    const state = await mainWindow.webContents.executeJavaScript(
      `(() => {
        const root = document.getElementById("root");
        return {
          nodes: root ? root.childElementCount : 0,
          text: document.body ? document.body.innerText.trim().length : 0,
        };
      })()`,
    );
    return state.nodes === 0 && state.text < 40;
  } catch {
    return true;
  }
}

function watchShellPage() {
  clearTimeout(blankTimer);
  blankTimer = setTimeout(async () => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    if (!(await pageIsBlank())) {
      blankReloads = 0;
      return;
    }
    if (blankReloads >= 2) {
      blankReloads = 0;
      const { response } = await showDialog({
        type: "warning",
        title: "JotBox came up empty",
        message: "The window loaded but the page stayed blank.",
        detail: "Check your connection, then try again.",
        buttons: ["Try again", "Quit"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (response === 0) {
        await reloadShell(true);
      } else {
        quitting = true;
        app.quit();
      }
      return;
    }
    blankReloads += 1;
    console.warn(`[jotbox-shell] page is blank, reloading (attempt ${blankReloads})`);
    await reloadShell(true);
  }, 8000);
}

async function reloadShell(hard) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (hard) await clearShellCaches();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (hard) mainWindow.webContents.reloadIgnoringCache();
  else mainWindow.webContents.reload();
  watchShellPage();
}

function chooseDisplaySource() {
  if (pickerResolver) return Promise.resolve(null);

  return (async () => {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 360, height: 202 },
      fetchWindowIcons: true,
    });
    pickerSources = sources;

    return new Promise((resolve) => {
      pickerResolver = resolve;
      const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const win = new BrowserWindow({
        width: 780,
        height: 600,
        parent,
        modal: Boolean(parent),
        show: false,
        title: "Choose what JotBox should hear",
        backgroundColor: "#0e1611",
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, "picker-preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      pickerWindow = win;
      win.setMenu(null);
      win.loadFile(path.join(__dirname, "picker.html"));
      win.once("ready-to-show", () => {
        if (!win.isDestroyed()) win.show();
      });
      win.webContents.on("did-finish-load", () => {
        win.webContents.send(
          "picker:sources",
          sources.map((source) => ({
            id: source.id,
            name: source.name,
            screen: source.id.startsWith("screen:"),
            thumbnail: source.thumbnail.isEmpty() ? "" : source.thumbnail.toDataURL(),
            icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : "",
          })),
        );
      });
      win.on("closed", () => {
        if (pickerWindow === win) pickerWindow = null;
        const pending = pickerResolver;
        pickerResolver = null;
        if (pending) pending(null);
      });
    });
  })();
}

function createSplashWindow() {
  splashOpenedAt = Date.now();
  const win = new BrowserWindow({
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    title: "JotBox",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  splashWindow = win;
  win.setAlwaysOnTop(true, "screen-saver");
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });
  win.on("closed", () => {
    if (splashWindow === win) splashWindow = null;
  });
  void win.loadFile(path.join(__dirname, "splash.html"));
}

function finishSplash() {
  if (splashDone) return;
  splashDone = true;
  clearTimeout(splashTimer);
  const remaining = Math.max(0, 900 - (Date.now() - splashOpenedAt));
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    splashWindow = null;
    showMain();
  }, remaining);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 360,
    minHeight: 560,
    show: false,
    title: "JotBox",
    icon: path.join(ASSETS, "icon.png"),
    backgroundColor: "#f5f4ef",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!sameOrigin(mainWindow.webContents.getURL())) return;
    loadRetries = 0;
    watchShellPage();
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    console.warn(`JotBox could not load ${url}: ${description} (${code})`);
    if (loadRetries < 2) {
      loadRetries += 1;
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(`${BASE_URL}/auth`);
      }, 1500 * loadRetries);
      return;
    }
    finishSplash();
    watchShellPage();
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.warn(`[jotbox-shell] renderer stopped: ${details.reason}`);
    if (quitting) return;
    setTimeout(() => {
      void reloadShell(true);
    }, 600);
  });

  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  guardNavigation(mainWindow);
  // The desktop shell skips the marketing site and opens the sign-in screen.
  void mainWindow.loadURL(`${BASE_URL}/auth`);
}

function createIslandWindow() {
  const win = new BrowserWindow({
    ...islandBounds(),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: "JotBox Island",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  islandWindow = win;
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on("did-finish-load", () => {
    win.webContents.send("island:state", lastState);
  });
  guardNavigation(win);
  void win.loadURL(`${BASE_URL}/island`);
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  finishSplash();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleListening() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("island:command", "toggle-listen");
}

function updateTrayMenu() {
  if (!tray) return;
  const label =
    lastState.status === "recording" || lastState.status === "paused" ? "Stop listening" : "Start listening";
  if (label === trayLabel) return;
  trayLabel = label;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open JotBox", click: showMain },
      {
        label,
        click: () => {
          toggleListening();
        },
      },
      { type: "separator" },
      {
        label: "Reload JotBox",
        click: () => {
          showMain();
          void reloadShell(true);
        },
      },
      ...(updatesEnabled()
        ? [
            {
              label: "Check for updates",
              click: () => {
                void checkForUpdates({ manual: true });
              },
            },
          ]
        : []),
      {
        label: "Quit JotBox",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  const image = nativeImage
    .createFromPath(path.join(ASSETS, "tray.png"))
    .resize({ width: 16, height: 16, quality: "best" });
  tray = new Tray(image);
  tray.setToolTip("JotBox");
  tray.on("click", showMain);
  trayLabel = "";
  updateTrayMenu();
}

function registerShortcuts() {
  const main = globalShortcut.register("CommandOrControl+Shift+J", showMain);
  const listen = globalShortcut.register("CommandOrControl+Shift+L", toggleListening);
  if (!main || !listen) {
    console.warn("JotBox could not register one of its shortcuts. Another app may be using it.");
  }
}

function updatesEnabled() {
  return app.isPackaged && !DEV && !SMOKE && process.env.JOTBOX_DISABLE_UPDATES !== "1";
}

function showDialog(options) {
  const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null;
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

async function checkForUpdates({ manual = false } = {}) {
  if (!autoUpdater) {
    if (manual) {
      await showDialog({
        type: "info",
        title: "Updates",
        message: "Updates are available in the installed app.",
        detail: "This development build does not check for updates.",
      });
    }
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!manual) return;
    if (result?.updateInfo && result.updateInfo.version !== app.getVersion()) {
      await showDialog({
        type: "info",
        title: "Updates",
        message: `JotBox ${result.updateInfo.version} is downloading.`,
        detail: "You can keep working. JotBox will ask you to restart when it is ready.",
      });
      return;
    }
    await showDialog({
      type: "info",
      title: "Updates",
      message: "JotBox is up to date.",
      detail: `You are on version ${app.getVersion()}.`,
    });
  } catch (error) {
    console.warn("[jotbox-update] check failed", error?.message || error);
    if (manual) {
      await showDialog({
        type: "warning",
        title: "Updates",
        message: "Could not check for updates.",
        detail: "Check your connection and try again.",
      });
    }
  }
}

function setupUpdates() {
  if (!updatesEnabled()) return;
  autoUpdater = require("electron-updater").autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (error) => {
    console.warn("[jotbox-update]", error?.message || error);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    if (updatePrompted) return;
    updatePrompted = true;
    if (lastState.status === "recording" || lastState.status === "paused") {
      console.log("[jotbox-update] ready; installing on quit because a capture is live");
      return;
    }
    const { response } = await showDialog({
      type: "info",
      title: "Update ready",
      message: `JotBox ${info.version} is ready to install.`,
      detail: "Restart now to finish, or keep working and it will install when you quit.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) {
      quitting = true;
      autoUpdater.quitAndInstall(false, true);
    }
  });

  setTimeout(() => {
    void checkForUpdates();
  }, 15_000);
  setInterval(() => {
    void checkForUpdates();
  }, 6 * 60 * 60 * 1000);
}

function watchedChannels() {
  ipcMain.on("desktop:version", (event) => {
    event.returnValue = app.getVersion();
  });

  ipcMain.on("shell:ready", (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) finishSplash();
  });

  ipcMain.on("island:state", (event, state) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    if (!state || typeof state !== "object") return;
    lastState = state;
    if (!islandWindow || islandWindow.isDestroyed()) return;
    islandWindow.webContents.send("island:state", state);

    if (SMOKE) return;
    if (state.status === "idle") {
      if (islandShown) {
        islandWindow.hide();
        islandShown = false;
      }
    } else if (!islandShown) {
      islandWindow.setBounds(islandBounds());
      islandWindow.setAlwaysOnTop(true, "screen-saver");
      islandWindow.showInactive();
      islandShown = true;
    }
    updateTrayMenu();
  });

  ipcMain.on("island:interactive", (event, interactive) => {
    if (!islandWindow || event.sender !== islandWindow.webContents) return;
    islandWindow.setIgnoreMouseEvents(!interactive, { forward: true });
  });

  ipcMain.on("island:command", (event, command) => {
    if (!islandWindow || event.sender !== islandWindow.webContents) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const allowed = new Set(["pause", "resume", "stop", "toggle-listen"]);
    if (!allowed.has(command)) return;
    mainWindow.webContents.send("island:command", command);
  });

  ipcMain.on("main:open", (event) => {
    if (!islandWindow || event.sender !== islandWindow.webContents) return;
    showMain();
  });

  ipcMain.on("picker:pick", (event, id) => {
    if (!pickerWindow || event.sender !== pickerWindow.webContents) return;
    const source = pickerSources.find((item) => item.id === id) ?? null;
    const resolve = pickerResolver;
    pickerResolver = null;
    pickerWindow.close();
    pickerWindow = null;
    if (resolve) resolve(source);
  });

  ipcMain.on("picker:cancel", (event) => {
    if (!pickerWindow || event.sender !== pickerWindow.webContents) return;
    pickerWindow.close();
  });
}

async function runSmoke() {
  const win = new BrowserWindow({
    width: ISLAND_WIDTH,
    height: ISLAND_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      partition: "jotbox-smoke",
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.log(`SMOKE console: ${message}`);
  });

  let interactiveCalls = 0;
  const onInteractive = (_event, value) => {
    if (value) interactiveCalls += 1;
  };
  ipcMain.on("island:interactive", onInteractive);

  const shotDir = path.join(__dirname, "..", "..", ".shots");
  fs.mkdirSync(shotDir, { recursive: true });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const measure = `(() => {
    const pill = document.querySelector('[role="region"]');
    const rect = pill ? pill.getBoundingClientRect() : null;
    return {
      width: rect ? Math.round(rect.width) : 0,
      height: rect ? Math.round(rect.height) : 0,
      open: Boolean(pill && pill.classList.contains("is-open")),
    };
  })()`;

  try {
    await win.loadURL(`${BASE_URL}/island?preview=1&open=1`);
    await wait(1000);
    const open = await win.webContents.executeJavaScript(
      `(() => {
        const root = document.querySelector("[data-island-root]");
        const pill = document.querySelector('[role="region"]');
        const rect = pill ? pill.getBoundingClientRect() : null;
        return {
          root: Boolean(root),
          status: root ? root.getAttribute("data-island-status") : null,
          width: rect ? Math.round(rect.width) : 0,
          height: rect ? Math.round(rect.height) : 0,
          surface: getComputedStyle(document.documentElement).backgroundColor,
          text: document.body.innerText.replace(/\\s+/g, " ").slice(0, 160),
        };
      })()`,
    );
    fs.writeFileSync(path.join(shotDir, "desktop-island-open.png"), (await win.capturePage()).toPNG());

    await win.loadURL(`${BASE_URL}/island?preview=1`);
    await wait(700);
    const closed = await win.webContents.executeJavaScript(measure);
    fs.writeFileSync(path.join(shotDir, "desktop-island-pill.png"), (await win.capturePage()).toPNG());

    await win.webContents.executeJavaScript(
      `(() => {
        const pill = document.querySelector('[role="region"]');
        pill.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
        return true;
      })()`,
    );
    await wait(600);
    const hovered = await win.webContents.executeJavaScript(measure);
    fs.writeFileSync(path.join(shotDir, "desktop-island-hover.png"), (await win.capturePage()).toPNG());

    await win.webContents.executeJavaScript(
      `(() => {
        const pill = document.querySelector('[role="region"]');
        pill.dispatchEvent(
          new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: document.body }),
        );
        return true;
      })()`,
    );
    await wait(600);
    const returned = await win.webContents.executeJavaScript(measure);

    const shell = new BrowserWindow({
      width: 1180,
      height: 820,
      show: false,
      frame: false,
      transparent: true,
      title: "JotBox shell smoke",
      backgroundColor: "#00000000",
      webPreferences: {
        partition: "jotbox-smoke",
        offscreen: true,
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    await shell.loadFile(path.join(__dirname, "splash.html"));
    shell.setSize(SPLASH_WIDTH, SPLASH_HEIGHT);
    await wait(400);
    shell.webContents.invalidate();
    await wait(200);
    const splash = await shell.webContents.executeJavaScript(
      `(() => {
        const card = document.querySelector(".splash");
        return { card: Boolean(card), text: document.body.innerText.replace(/\\s+/g, " ").trim().slice(0, 120) };
      })()`,
    );
    fs.writeFileSync(path.join(shotDir, "desktop-splash.png"), (await shell.capturePage()).toPNG());

    shell.setSize(1180, 820);
    await shell.loadURL(`${BASE_URL}/auth`);
    await wait(2500);
    await shell.webContents.executeJavaScript(
      `(() => {
        const style = document.createElement("style");
        style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}";
        document.head.appendChild(style);
        return true;
      })()`,
    );
    await wait(150);
    shell.webContents.invalidate();
    await wait(250);
    const auth = await shell.webContents.executeJavaScript(
      `(() => {
        const card = document.querySelector("[data-desktop-auth]");
        const panel = document.querySelector(".desktop-auth-card");
        const rect = panel ? panel.getBoundingClientRect() : null;
        const style = panel ? getComputedStyle(panel) : null;
        return {
          desktop: Boolean(card),
          email: Boolean(document.querySelector("#auth-email")),
          heading: card ? card.querySelector("h1").textContent.trim() : "",
          visible: document.visibilityState,
          panel: rect
            ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                opacity: style.opacity,
                display: style.display,
                visibility: style.visibility,
                background: style.backgroundColor,
                animation: style.animationName,
              }
            : null,
        };
      })()`,
    );
    const authShot = await shell.capturePage();
    const authBitmap = authShot.getBitmap();
    const authSize = authShot.getSize();
    const centerIndex = (Math.floor(authSize.height / 2) * authSize.width + Math.floor(authSize.width / 2)) * 4;
    const authCenter = [authBitmap[centerIndex + 2], authBitmap[centerIndex + 1], authBitmap[centerIndex]];
    fs.writeFileSync(path.join(shotDir, "desktop-auth.png"), authShot.toPNG());

    shell.setSize(380, 700);
    await wait(400);
    shell.webContents.invalidate();
    await wait(250);
    const narrow = await shell.webContents.executeJavaScript(
      `({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 })`,
    );
    fs.writeFileSync(path.join(shotDir, "desktop-auth-narrow.png"), (await shell.capturePage()).toPNG());

    console.log(`SMOKE ${JSON.stringify({ open, closed, hovered, returned, interactiveCalls, splash, auth, narrow, authCenter })}`);
    const pass =
      open.root &&
      open.status === "recording" &&
      open.width > 380 &&
      open.height > 120 &&
      open.surface === "rgba(0, 0, 0, 0)" &&
      closed.width > 300 &&
      closed.width < 380 &&
      closed.open === false &&
      hovered.open === true &&
      returned.open === false &&
      interactiveCalls > 0 &&
      splash.card &&
      auth.desktop &&
      auth.email &&
      auth.heading.length > 0 &&
      authCenter.every((channel) => channel > 200) &&
      !narrow.overflow;
    ipcMain.removeListener("island:interactive", onInteractive);
    app.exit(pass ? 0 : 1);
  } catch (error) {
    console.error(`SMOKE could not load ${BASE_URL}: ${error instanceof Error ? error.message : error}`);
    app.exit(1);
  }
}

async function boot() {
  app.setAppUserModelId("com.jotbox.desktop");
  Menu.setApplicationMenu(appMenu());
  hardenSession();
  watchedChannels();

  if (SMOKE) {
    await runSmoke();
    return;
  }

  // The shell always reads the live app from the server, so a service worker
  // cached for an older deploy only ever serves bundles that no longer exist.
  // Start each launch from a clean worker and cache, which is what turns a
  // stale cache into an empty window after an update.
  await clearShellCaches();

  createSplashWindow();
  splashTimer = setTimeout(finishSplash, 10000);
  createMainWindow();
  createIslandWindow();
  createTray();
  registerShortcuts();
  setupUpdates();
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showMain);
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
  app.on("window-all-closed", () => {
    // The app lives in the tray until the user quits it from there.
  });
  app.whenReady().then(boot).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}
