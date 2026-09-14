import type { MrDiscussionThreadView } from "../gitlab/types";
import { escapeHtml } from "./diffPresentation";

export function renderMrDiscussionsSection(
  threads: MrDiscussionThreadView[],
  loading: boolean,
  error?: string,
): string {
  const head = `<div class="discussions-head">
    <h2>Respostas aos seus comentários</h2>
    <button type="button" class="secondary discussions-refresh" data-action="refreshDiscussions">Atualizar</button>
  </div>`;

  if (loading) {
    return `<section class="discussions">${head}<p class="discussions-status">Carregando threads do GitLab…</p></section>`;
  }
  if (error) {
    return `<section class="discussions">${head}<p class="discussions-error">${escapeHtml(error)}</p></section>`;
  }

  const mine = threads.filter((t) => t.involvesCurrentUser);
  if (mine.length === 0) {
    return `<section class="discussions">${head}<p class="discussions-status">Você ainda não tem comentários neste MR (ou só notas de sistema).</p></section>`;
  }

  const items = mine
    .map((thread) => {
      const loc =
        thread.anchorPath && thread.anchorLine !== undefined
          ? `${thread.anchorPath} · L${thread.anchorLine}${thread.anchorSide ? ` (${thread.anchorSide})` : ""}`
          : thread.anchorPath ?? "Nota no MR";
      const goto =
        thread.anchorPath && thread.anchorLine !== undefined && thread.anchorSide
          ? `<button type="button" class="thread-goto" data-path="${escapeHtml(thread.anchorPath)}" data-line="${thread.anchorLine}" data-side="${thread.anchorSide}">Ir à linha</button>`
          : thread.anchorPath
            ? `<button type="button" class="thread-goto" data-path="${escapeHtml(thread.anchorPath)}">Abrir arquivo</button>`
            : "";
      const badge = thread.hasReplyFromOthers
        ? `<span class="thread-badge reply">Nova resposta</span>`
        : `<span class="thread-badge">Sem resposta</span>`;
      const notesHtml = thread.notes
        .map((n) => {
          const who = n.isCurrentUser ? "Você" : escapeHtml(n.authorName);
          const when = formatWhen(n.createdAt);
          return `<div class="thread-note ${n.isCurrentUser ? "mine" : "theirs"}">
  <div class="thread-note-meta"><strong>${who}</strong> · ${when}</div>
  <div class="thread-note-body">${escapeHtml(n.body)}</div>
</div>`;
        })
        .join("");
      return `<article class="thread-card ${thread.hasReplyFromOthers ? "has-reply" : ""}">
  <div class="thread-card-head">
    <div class="thread-loc">${escapeHtml(loc)}</div>
    ${badge}
  </div>
  <div class="thread-notes">${notesHtml}</div>
  <div class="thread-actions">${goto}</div>
</article>`;
    })
    .join("");

  return `<section class="discussions">${head}${items}</section>`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
