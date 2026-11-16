import { HttpError, requireMethod } from "./http.mjs";

/**
 * Direct Windows installer download.
 *
 * The landing page links here so a visitor gets the installer, not the GitHub
 * release page. The latest release is resolved through the GitHub API and
 * cached, so shipping a new build only needs a new release, not a redeploy.
 */

const GITHUB_REPO = "luisjjj/Jotbox";
const FALLBACK_ASSET =
  "https://github.com/luisjjj/Jotbox/releases/download/v0.2.1/JotBox-Setup-0.2.1.exe";
const CACHE_MS = 10 * 60 * 1000;
const GITHUB_TIMEOUT_MS = 5000;

let cached = { at: 0, url: null };

function installerFrom(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const installer = assets.find(
    (asset) => typeof asset?.name === "string" && /\.exe$/i.test(asset.name) && asset.browser_download_url,
  );
  return installer?.browser_download_url ?? null;
}

async function latestInstallerUrl() {
  if (cached.url && Date.now() - cached.at < CACHE_MS) return cached.url;

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "JotBox-Download",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  let release = null;
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) },
    );
    if (response.ok) release = await response.json();
  } catch (error) {
    console.error("[jotbox-download] GitHub lookup failed", error);
  }

  const url = installerFrom(release) ?? FALLBACK_ASSET;
  cached = { at: Date.now(), url };
  return url;
}

export async function handleDownloadWindows(req, res) {
  requireMethod(req, ["GET"]);
  if (req.url && !req.url.startsWith("/api/download/windows")) {
    throw new HttpError(404, "Not found.");
  }
  const url = await latestInstallerUrl();
  res.statusCode = 302;
  res.setHeader("Location", url);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.end();
}
