const { execFileSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CERT_SUBJECT = "CN=JotBox Self-Signed";
const SIGNING_DIR = path.join(__dirname, "signing");
const PFX = path.join(SIGNING_DIR, "jotbox-self-signed.pfx");
const CER = path.join(SIGNING_DIR, "jotbox-self-signed.cer");
const PASSWORD_FILE = path.join(SIGNING_DIR, "password.txt");

const CERT_ONLY = process.argv.includes("--cert-only");
const BUILD_ARGS = process.argv.slice(2).filter((arg) => arg !== "--cert-only");

function quote(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function ensureCertificate() {
  fs.mkdirSync(SIGNING_DIR, { recursive: true });

  let password = fs.existsSync(PASSWORD_FILE) ? fs.readFileSync(PASSWORD_FILE, "utf8").trim() : "";
  if (!password) {
    password = crypto.randomBytes(24).toString("base64url");
    fs.writeFileSync(PASSWORD_FILE, password, "utf8");
  }

  if (fs.existsSync(PFX)) {
    console.log(`Using the existing self-signed certificate at ${PFX}`);
    return password;
  }

  const script = `
    $ErrorActionPreference = "Stop"
    $subject = ${quote(CERT_SUBJECT)}
    $cert = Get-ChildItem Cert:\\CurrentUser\\My |
      Where-Object { $_.Subject -eq $subject -and $_.HasPrivateKey } |
      Select-Object -First 1
    if (-not $cert) {
      $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -FriendlyName "JotBox self-signed" -CertStoreLocation "Cert:\\CurrentUser\\My" -NotAfter (Get-Date).AddYears(3) -KeyUsage DigitalSignature -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
    }
    $secure = ConvertTo-SecureString -String ${quote(password)} -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath ${quote(PFX)} -Password $secure | Out-Null
    Export-Certificate -Cert $cert -FilePath ${quote(CER)} | Out-Null
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
    stdio: "inherit",
  });

  if (!fs.existsSync(PFX)) throw new Error("The self-signed certificate was not created.");
  console.log(`Created ${PFX}`);
  console.log(`Created ${CER}`);
  return password;
}

const password = ensureCertificate();

if (CERT_ONLY) {
  console.log(`\nTrust it on this PC with:`);
  console.log(
    `  Import-Certificate -FilePath "${CER}" -CertStoreLocation Cert:\\CurrentUser\\Root`,
  );
  process.exit(0);
}

const electronBuilder = path.join(
  path.dirname(require.resolve("electron-builder/package.json")),
  "cli.js",
);
const args = BUILD_ARGS.length > 0 ? BUILD_ARGS : ["--win", "nsis"];

console.log(`Building a signed Windows package with ${CERT_SUBJECT}...`);
const result = spawnSync(process.execPath, [electronBuilder, ...args], {
  cwd: __dirname,
  stdio: "inherit",
  env: { ...process.env, CSC_LINK: PFX, CSC_KEY_PASSWORD: password },
});
process.exit(result.status ?? 1);
