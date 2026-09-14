import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "..", "package.json"), "utf8"));
const vsix = join(root, "..", `review-kit-${pkg.version}.vsix`);

execSync("npm run package", { cwd: join(root, ".."), stdio: "inherit" });
execSync(`cursor --install-extension "${vsix}" --force`, { stdio: "inherit" });
console.log("\nReview Kit instalado. No Cursor: Developer: Reload Window");
