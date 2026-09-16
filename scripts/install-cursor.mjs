import { readFileSync, readdirSync, rmSync, mkdtempSync, cpSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const vsix = join(repoRoot, `review-kit-${pkg.version}.vsix`);
const publisher = pkg.publisher ?? "review-kit";
const name = pkg.name ?? "review-kit";
const extFolder = `${publisher}.${name}-${pkg.version}`;
const extensionsDir =
  process.env.CURSOR_EXTENSIONS_DIR?.trim() ||
  process.env.VSCODE_EXTENSIONS?.trim() ||
  join(homedir(), ".cursor", "extensions");

execSync("npm run package", { cwd: repoRoot, stdio: "inherit" });

if (!existsSync(extensionsDir)) {
  mkdirSync(extensionsDir, { recursive: true });
}

for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  if (entry.name.startsWith(`${publisher}.${name}-`)) {
    rmSync(join(extensionsDir, entry.name), { recursive: true, force: true });
  }
}

const targetDir = join(extensionsDir, extFolder);
const extractRoot = mkdtempSync(join(tmpdir(), "review-kit-vsix-"));
try {
  execSync(`unzip -q -o ${JSON.stringify(vsix)} -d ${JSON.stringify(extractRoot)}`, {
    stdio: "inherit",
  });
  cpSync(join(extractRoot, "extension"), targetDir, { recursive: true });
} finally {
  rmSync(extractRoot, { recursive: true, force: true });
}

console.log(`\nReview Kit ${pkg.version} → ${targetDir}`);
console.log("No Cursor: Developer: Reload Window (não abre janela nova).");
