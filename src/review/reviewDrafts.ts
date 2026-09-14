import * as vscode from "vscode";
import type { LineCommentSide } from "./mrComments";

export type DraftComment = {
  id: string;
  filePath: string;
  line: number;
  side: LineCommentSide;
  body: string;
};

let draftMode = false;
const drafts: DraftComment[] = [];
const expandedDraftIds = new Set<string>();
const onChangeEmitter = new vscode.EventEmitter<void>();

export const onReviewDraftsChanged = onChangeEmitter.event;

export function isReviewDraftMode(): boolean {
  return draftMode;
}

export function startReviewDraftMode(): void {
  draftMode = true;
  void vscode.commands.executeCommand("setContext", "reviewKit.reviewDraftMode", true);
  onChangeEmitter.fire();
}

export function stopReviewDraftMode(): void {
  draftMode = false;
  void vscode.commands.executeCommand("setContext", "reviewKit.reviewDraftMode", false);
  onChangeEmitter.fire();
}

export function getReviewDraftById(id: string): DraftComment | undefined {
  return drafts.find((d) => d.id === id);
}

export function isDraftExpanded(id: string): boolean {
  return expandedDraftIds.has(id);
}

export function expandDraft(id: string): void {
  if (expandedDraftIds.has(id)) {
    return;
  }
  expandedDraftIds.add(id);
  onChangeEmitter.fire();
}

export function collapseDraft(id: string): boolean {
  if (!expandedDraftIds.delete(id)) {
    return false;
  }
  onChangeEmitter.fire();
  return true;
}

export function toggleDraftExpanded(id: string): boolean {
  if (expandedDraftIds.has(id)) {
    collapseDraft(id);
    return false;
  }
  expandDraft(id);
  return true;
}

export function getReviewDrafts(): readonly DraftComment[] {
  return drafts;
}

export function addReviewDraft(
  filePath: string,
  line: number,
  side: LineCommentSide,
  body: string,
): DraftComment {
  const entry: DraftComment = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    filePath,
    line,
    side,
    body: body.trim(),
  };
  drafts.push(entry);
  onChangeEmitter.fire();
  return entry;
}

export function removeReviewDraft(id: string): void {
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx >= 0) {
    drafts.splice(idx, 1);
    expandedDraftIds.delete(id);
    onChangeEmitter.fire();
  }
}

export function clearReviewDrafts(): void {
  drafts.length = 0;
  expandedDraftIds.clear();
  onChangeEmitter.fire();
}

export function discardReviewDraftSession(): void {
  clearReviewDrafts();
  stopReviewDraftMode();
}
