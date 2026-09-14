import type { MrEditorReviewController } from "./mrEditorReview";

let controller: MrEditorReviewController | undefined;

export function setMrEditorReviewController(next: MrEditorReviewController | undefined): void {
  controller = next;
}

export function getMrEditorReviewController(): MrEditorReviewController | undefined {
  return controller;
}
