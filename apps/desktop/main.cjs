const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const PROD_URL = "https://jotbox-eight.vercel.app";
const DEV_URL = "http://localhost:5173";
const SMOKE = process.argv.includes("--smoke-test");
const DEV = process.argv.includes("--dev");

const BASE_URL = (
  SMOKE
    ? process.env.JOTBOX_SMOKE_URL || "http://localhost:4173"
    : process.env.JOTBOX_DESKTOP_URL || (DEV ? DEV_URL : PROD_URL)
).replace(/\/+$/, "");

const APP_ORIGIN = new URL(BASE_URL).origin;
const ISLAND_WIDTH = 460;
const ISLAND_HEIGHT = 220;
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
let pickerWindow = null;
let pickerSources = [];
let pickerResolver = null;
let tray = null;
let trayLabel = "";
let quitting = false;
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

  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  guardNavigation(mainWindow);
  void mainWindow.loadURL(BASE_URL);
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

function watchedChannels() {
  ipcMain.on("desktop:version", (event) => {
    event.returnValue = app.getVersion();
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

    console.log(`SMOKE ${JSON.stringify({ open, closed, hovered, returned, interactiveCalls })}`);
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
      interactiveCalls > 0;
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

  createMainWindow();
  createIslandWindow();
  createTray();
  registerShortcuts();
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
