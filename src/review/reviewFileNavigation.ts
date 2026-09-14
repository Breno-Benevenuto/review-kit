import * as vscode from "vscode";
import type { ReviewSession } from "./reviewSession";

let diffReviewOpen = false;

export function isDiffReviewOpen(): boolean {
  return diffReviewOpen;
}

export function setDiffReviewOpen(open: boolean): void {
  diffReviewOpen = open;
  void vscode.commands.executeCommand("setContext", "reviewKit.diffReviewOpen", open);
}

export function stepReviewPath(session: ReviewSession, currentPath: string, delta: number): string {
  const paths = session.cards.map((c) => c.path);
  const idx = paths.indexOf(currentPath);
  const index = idx >= 0 ? idx : 0;
  return paths[Math.max(0, Math.min(paths.length - 1, index + delta))] ?? currentPath;
}

export function reviewFilePosition(
  session: ReviewSession,
  path: string,
): { index: number; total: number; label: string } {
  const total = session.cards.length;
  const idx = session.cards.findIndex((c) => c.path === path);
  const index = idx >= 0 ? idx + 1 : 0;
  const name = path.split("/").pop() ?? path;
  return {
    index,
    total,
    label: index > 0 ? `#${index}/${total} ${name}` : name,
  };
}
