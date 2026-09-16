import type { MrDiscussionThreadView } from "../gitlab/types";
import type { DraftComment } from "./reviewDrafts";
import { escapeHtml } from "./diffPresentation";
import { parseLineAnchorKey } from "./lineDiscussionIndex";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function renderDraftNotes(drafts: DraftComment[]): string {
  return drafts
    .map(
      (d) => `<div class="inline-thread-note draft">
  <div class="inline-thread-meta"><strong>Fila</strong> · pendente</div>
  <div class="inline-thread-body">${escapeHtml(d.body)}</div>
</div>`,
    )
    .join("");
}

function renderThreadNotes(thread: MrDiscussionThreadView): string {
  return thread.notes
    .map((n) => {
      const who = n.isCurrentUser ? "Você" : escapeHtml(n.authorName);
      return `<div class="inline-thread-note ${n.isCurrentUser ? "mine" : "theirs"}">
  <div class="inline-thread-meta"><strong>${who}</strong> · ${formatWhen(n.createdAt)}</div>
  <div class="inline-thread-body">${escapeHtml(n.body)}</div>
</div>`;
    })
    .join("");
}

function previewText(body: string, max = 72): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) {
    return flat;
  }
  return `${flat.slice(0, max - 1)}…`;
}

function renderDiscussionThread(thread: MrDiscussionThreadView): string {
  const notes = renderThreadNotes(thread);
  if (thread.resolved) {
    const first = thread.notes[0];
    const who = first ? (first.isCurrentUser ? "Você" : escapeHtml(first.authorName)) : "?";
    const preview = first ? escapeHtml(previewText(first.body)) : "";
    const count = thread.notes.length;
    const countLabel = count === 1 ? "1 mensagem" : `${count} mensagens`;
    return `<details class="inline-discussion is-resolved" data-discussion-id="${escapeHtml(thread.id)}">
  <summary class="inline-discussion-summary"><span class="inline-resolved-badge">Resolvido</span> <span class="inline-discussion-preview"><strong>${who}</strong> · ${preview} · ${countLabel}</span></summary>
  <div class="inline-discussion-body">${notes}</div>
</details>`;
  }
  const reply = `<form class="inline-reply-form" data-discussion-id="${escapeHtml(thread.id)}">
  <textarea class="inline-reply-input" rows="2" placeholder="Responder…"></textarea>
  <div class="inline-composer-actions">
    <button type="submit" class="primary">Responder</button>
  </div>
</form>`;
  return `<div class="inline-discussion" data-discussion-id="${escapeHtml(thread.id)}">${notes}${reply}</div>`;
}

export function renderInlineThreadPanel(
  anchors: string[],
  threadsByLine: Map<string, MrDiscussionThreadView[]>,
  draftsByLine: Map<string, DraftComment[]>,
): string {
  const sections: string[] = [];
  for (const anchor of anchors) {
    const threads = threadsByLine.get(anchor) ?? [];
    const drafts = draftsByLine.get(anchor) ?? [];
    if (threads.length === 0 && drafts.length === 0) {
      continue;
    }
    const parsed = parseLineAnchorKey(anchor);
    const label = parsed
      ? `${parsed.side === "new" ? "Head" : "Base"} · L${parsed.line}`
      : anchor;
    const body = `${renderDraftNotes(drafts)}${threads.map(renderDiscussionThread).join("")}`;
    sections.push(`<div class="inline-thread-anchor" data-anchor="${escapeHtml(anchor)}">
  <div class="inline-thread-anchor-label">${escapeHtml(label)}</div>
  ${body}
</div>`);
  }
  if (sections.length === 0) {
    return "";
  }
  return `<div class="diff-inline-thread collapsed">${sections.join("")}</div>`;
}
