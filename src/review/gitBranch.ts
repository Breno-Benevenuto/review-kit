import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let branchCache: { cwd: string; branch: string | undefined; at: number } | undefined;
const BRANCH_TTL_MS = 15_000;

export async function getCurrentGitBranch(cwd: string): Promise<string | undefined> {
  const now = Date.now();
  if (branchCache && branchCache.cwd === cwd && now - branchCache.at < BRANCH_TTL_MS) {
    return branchCache.branch;
  }
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    const branch = stdout.trim();
    const resolved = branch === "HEAD" ? undefined : branch;
    branchCache = { cwd, branch: resolved, at: now };
    return resolved;
  } catch {
    branchCache = { cwd, branch: undefined, at: now };
    return undefined;
  }
}
