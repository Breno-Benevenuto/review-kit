import * as vscode from "vscode";
import {
  escapeHtml,
  type FileReviewCard,
} from "../review/diffPresentation";
import { renderEditorReviewSummaryHtml } from "../review/editorReviewSummary";
import { getReviewDrafts, isDraftExpanded } from "../review/reviewDrafts";
import { renderMrDescriptionHtml } from "../review/mrDescriptionHtml";
import { renderMrFlowSvg } from "../graph/mrFlowDiagram";
import type { MrDiscussionThreadView } from "../gitlab/types";
import { renderMrDiscussionsSection } from "../review/mrDiscussionsPanel";
import { setDiffReviewOpen } from "../review/reviewFileNavigation";
import type { ReviewSession } from "../review/reviewSession";

type PanelState = {
  session: ReviewSession;
  activePath: string;
  reviewedPaths: Set<string>;
  onSourceBranch: boolean;
  discussions: MrDiscussionThreadView[];
  discussionsLoading: boolean;
  discussionsError?: string;
};

export class VisualReviewPanel {
  static current: VisualReviewPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private state: PanelState;

  private constructor(
    panel: vscode.WebviewPanel,
    state: PanelState,
    private readonly onMessage: (msg: WebviewRequest) => void,
  ) {
    this.panel = panel;
    this.state = state;
    panel.onDidDispose(() => {
      VisualReviewPanel.current = undefined;
      setDiffReviewOpen(false);
    });
    panel.webview.onDidReceiveMessage((msg: WebviewRequest) => this.onMessage(msg));
  }

  static open(
    session: ReviewSession,
    startPath: string,
    reviewedPaths: Set<string>,
    onMessage: (msg: WebviewRequest) => void,
  ): VisualReviewPanel {
    if (VisualReviewPanel.current) {
      VisualReviewPanel.current.state = {
        session,
        activePath: startPath,
        reviewedPaths: new Set(reviewedPaths),
        onSourceBranch: VisualReviewPanel.current.state.onSourceBranch,
        discussions: VisualReviewPanel.current.state.discussions,
        discussionsLoading: VisualReviewPanel.current.state.discussionsLoading,
        discussionsError: VisualReviewPanel.current.state.discussionsError,
      };
      VisualReviewPanel.current.render();
      VisualReviewPanel.current.panel.reveal(vscode.ViewColumn.One);
      return VisualReviewPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      "reviewKit.visualReview",
      `Review !${session.mr.iid}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const instance = new VisualReviewPanel(
      panel,
      { session, activePath: startPath, reviewedPaths: new Set(reviewedPaths), onSourceBranch: false, discussions: [], discussionsLoading: true },
      onMessage,
    );
    VisualReviewPanel.current = instance;
    instance.render();
    return instance;
  }

  setActivePath(path: string): void {
    this.state.activePath = path;
    this.render();
  }

  setOnSourceBranch(onSourceBranch: boolean): void {
    this.state.onSourceBranch = onSourceBranch;
    this.render();
  }

  setReviewed(paths: Set<string>): void {
    this.state.reviewedPaths = new Set(paths);
    this.render();
  }

  getActivePath(): string {
    return this.state.activePath;
  }

  getSession(): ReviewSession {
    return this.state.session;
  }

  refresh(): void {
    this.render();
  }

  setDiscussionsLoading(loading: boolean): void {
    this.state.discussionsLoading = loading;
    if (loading) {
      this.state.discussionsError = undefined;
    }
    this.render();
  }

  setDiscussions(threads: MrDiscussionThreadView[], error?: string): void {
    this.state.discussions = threads;
    this.state.discussionsLoading = false;
    this.state.discussionsError = error;
    this.render();
  }

  private render(): void {
    const { session, activePath, reviewedPaths, discussions, discussionsLoading, discussionsError } =
      this.state;
    const activeChange = session.changeByPath.get(activePath);
    const previewHtml = activeChange
      ? renderEditorReviewSummaryHtml(
          activePath,
          activeChange.diff ?? "",
          false,
          session.mr.source_branch,
        )
      : "";

    const queueHtml = session.cards
      .map((card) => renderQueueItem(card, card.path === activePath, reviewedPaths.has(card.path)))
      .join("");

    const progress = reviewedPaths.size;
    const total = session.cards.length;
    const drafts = getReviewDrafts();
    const draftsHtml = renderDraftsSection(drafts);
    const overviewHtml = renderMrOverview(session, activePath);
    const discussionsHtml = renderMrDiscussionsSection(
      discussions,
      discussionsLoading,
      discussionsError,
    );

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); height: 100vh; display: flex; flex-direction: column; }
header { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
header h1 { font-size: 13px; margin: 0; flex: 1; min-width: 200px; }
.progress { font-size: 12px; opacity: 0.85; }
.toolbar button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.toolbar button.danger { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); }
.toolbar button.approve { background: var(--vscode-gitDecoration-addedResourceForeground, #2ea043); color: var(--vscode-button-foreground, #fff); }
main { flex: 1; display: grid; grid-template-columns: 300px 1fr; min-height: 0; }
.queue { border-right: 1px solid var(--vscode-panel-border); overflow: auto; padding: 8px; }
.queue-item { width: 100%; text-align: left; border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); color: inherit; border-radius: 8px; padding: 8px; margin-bottom: 8px; cursor: pointer; }
.queue-item.active { outline: 2px solid var(--vscode-focusBorder); }
.queue-item.done { opacity: 0.75; }
.idx { font-weight: 700; margin-right: 6px; }
.layer { display: inline-block; font-size: 10px; padding: 2px 6px; border-radius: 999px; margin-right: 6px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.name { font-size: 12px; font-weight: 600; word-break: break-all; }
.meta { font-size: 11px; opacity: 0.8; margin-top: 4px; }
.detail { display: flex; flex-direction: column; min-height: 0; overflow: auto; }
.detail-head { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
.path { font-family: var(--vscode-editor-font-family); font-size: 12px; word-break: break-all; }
.risks { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.risks.ok { font-size: 12px; opacity: 0.8; }
.risk-tag { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); border: 1px solid var(--vscode-inputValidation-warningBorder); padding: 2px 8px; border-radius: 999px; font-size: 11px; }
.legend { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 11px; }
.chip { padding: 2px 8px; border-radius: 999px; font-weight: 600; }
.chip.add { background: var(--vscode-diffEditor-insertedTextBackground, rgba(46,160,67,.35)); color: var(--vscode-editor-foreground); }
.chip.mod { background: var(--vscode-editor-wordHighlightStrongBackground, rgba(255,193,7,.25)); }
.chip.del { background: var(--vscode-diffEditor-removedTextBackground, rgba(248,81,73,.25)); }
.hint { padding: 12px 12px 0; font-size: 12px; line-height: 1.45; margin: 0; }
.hint.ok code, .hint.warn code { font-size: 11px; }
.hint.warn { color: var(--vscode-inputValidation-warningForeground); }
.howto { margin: 8px 12px 12px; padding-left: 18px; font-size: 12px; line-height: 1.5; opacity: .92; }
.removed-mini { padding: 0 12px 12px; }
.section-title { font-size: 11px; font-weight: 600; margin-bottom: 6px; opacity: .85; }
.removed-line { display: block; width: 100%; text-align: left; margin-bottom: 4px; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--vscode-diffEditor-removedTextBorder, rgba(248,81,73,.4)); background: var(--vscode-diffEditor-removedTextBackground, rgba(248,81,73,.12)); color: inherit; cursor: pointer; font-family: var(--vscode-editor-font-family); font-size: 11px; }
.removed-line:hover { outline: 1px solid var(--vscode-focusBorder); }
.more { font-size: 11px; opacity: .7; margin-top: 4px; }
.editor-banner { margin: 12px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--vscode-focusBorder); background: var(--vscode-editor-inactiveSelectionBackground); font-size: 12px; }
.drafts { margin: 12px; padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-sideBar-background); }
.drafts h2 { font-size: 12px; margin: 0 0 8px; }
.draft-item { font-size: 11px; padding: 8px 0; border-bottom: 1px solid var(--vscode-panel-border); }
.draft-item:last-child { border-bottom: 0; }
.draft-item.open .draft-body { display: block; }
.draft-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.draft-actions button { font-size: 11px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
.draft-actions button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
.draft-open-tag { font-size: 10px; opacity: .85; margin-left: 6px; }
.draft-meta { opacity: .85; font-family: var(--vscode-editor-font-family); word-break: break-all; }
.draft-body { margin-top: 4px; }
.draft-empty { font-size: 12px; opacity: .8; }
.mode-on { color: var(--vscode-gitDecoration-addedResourceForeground); font-weight: 600; }
.mr-overview { padding: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
.mr-overview h2 { font-size: 12px; margin: 0 0 8px; font-weight: 600; }
.mr-overview h2:not(:first-child) { margin-top: 16px; }
.mr-description-body { font-size: 12px; line-height: 1.55; opacity: 0.95; }
.mr-description-body.markdown-body { font-size: 13px; line-height: 1.6; }
.markdown-body > :first-child { margin-top: 0; }
.markdown-body > :last-child { margin-bottom: 0; }
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 {
  margin: 1em 0 0.5em; font-weight: 600; line-height: 1.3;
}
.markdown-body h1 { font-size: 1.35em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 0.25em; }
.markdown-body h2 { font-size: 1.2em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 0.2em; }
.markdown-body h3 { font-size: 1.08em; }
.markdown-body h4, .markdown-body h5, .markdown-body h6 { font-size: 1em; opacity: 0.95; }
.markdown-body p { margin: 0.6em 0; }
.markdown-body ul, .markdown-body ol { margin: 0.5em 0; padding-left: 1.4em; }
.markdown-body li + li { margin-top: 0.25em; }
.markdown-body li.task-list-item { list-style: none; margin-left: -1.4em; padding-left: 1.4em; }
.markdown-body input[type="checkbox"] { margin-right: 0.4em; vertical-align: middle; pointer-events: none; }
.markdown-body blockquote {
  margin: 0.75em 0; padding: 0.4em 0.8em;
  border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-focusBorder));
  background: var(--vscode-textBlockQuote-background, var(--vscode-editor-inactiveSelectionBackground));
  color: var(--vscode-editor-foreground); opacity: 0.92;
}
.markdown-body code {
  font-family: var(--vscode-editor-font-family); font-size: 0.92em;
  background: var(--vscode-textCodeBlock-background, var(--vscode-textBlockQuote-background));
  padding: 0.15em 0.35em; border-radius: 4px;
}
.markdown-body pre {
  margin: 0.75em 0; padding: 10px 12px; overflow: auto; border-radius: 6px;
  background: var(--vscode-textCodeBlock-background, rgba(0,0,0,.2));
  border: 1px solid var(--vscode-panel-border);
}
.markdown-body pre code { background: none; padding: 0; font-size: 11px; line-height: 1.45; }
.markdown-body a.md-link { color: var(--vscode-textLink-foreground); text-decoration: underline; cursor: pointer; }
.markdown-body a.md-link:hover { color: var(--vscode-textLink-activeForeground); }
.markdown-body hr { border: 0; border-top: 1px solid var(--vscode-panel-border); margin: 1em 0; }
.markdown-body table { border-collapse: collapse; width: 100%; margin: 0.75em 0; font-size: 12px; display: block; overflow-x: auto; }
.markdown-body th, .markdown-body td { border: 1px solid var(--vscode-panel-border); padding: 6px 8px; text-align: left; }
.markdown-body th { background: var(--vscode-editor-inactiveSelectionBackground); font-weight: 600; }
.markdown-body img { max-width: 100%; height: auto; border-radius: 4px; margin: 0.5em 0; }
.markdown-body del { opacity: 0.75; }
.mr-description-body h3, .mr-description-body h4, .mr-description-body h5 { margin: 8px 0 4px; font-size: 12px; }
.mr-description-body ul { margin: 6px 0; padding-left: 18px; }
.mr-description-body code { font-family: var(--vscode-editor-font-family); font-size: 11px; background: var(--vscode-textBlockQuote-background); padding: 1px 4px; border-radius: 3px; }
.mr-description-body a { color: var(--vscode-textLink-foreground); }
.mr-desc-empty { font-size: 12px; opacity: 0.75; margin: 0; }
.flow-wrap { overflow: auto; padding: 8px 0; color: var(--vscode-editor-foreground); }
.flow-wrap svg { max-width: 100%; height: auto; display: block; }
.flow-node { cursor: pointer; }
.flow-node:hover rect { stroke: var(--vscode-focusBorder); stroke-width: 2; }
.flow-hint { font-size: 11px; opacity: 0.75; margin: 6px 0 0; }
.file-section { padding: 0 12px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
.file-section .path { padding-top: 10px; }
.discussions { margin: 12px; padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-sideBar-background); }
.discussions-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.discussions-head h2 { font-size: 12px; margin: 0; flex: 1; }
.discussions-refresh { font-size: 11px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--vscode-panel-border); cursor: pointer; }
.discussions-status, .discussions-error { font-size: 12px; opacity: 0.85; margin: 0; }
.discussions-error { color: var(--vscode-inputValidation-errorForeground); }
.thread-card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 8px; margin-bottom: 10px; }
.thread-card.has-reply { border-color: var(--vscode-focusBorder); }
.thread-card-head { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
.thread-loc { font-size: 11px; font-family: var(--vscode-editor-font-family); word-break: break-all; flex: 1; }
.thread-badge { font-size: 10px; padding: 2px 6px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.thread-badge.reply { background: var(--vscode-inputValidation-infoBackground); color: var(--vscode-inputValidation-infoForeground); }
.thread-note { margin-bottom: 8px; padding: 6px 8px; border-radius: 6px; background: var(--vscode-editor-background); }
.thread-note.mine { border-left: 3px solid var(--vscode-gitDecoration-addedResourceForeground); }
.thread-note.theirs { border-left: 3px solid var(--vscode-textLink-foreground); }
.thread-note-meta { font-size: 10px; opacity: 0.85; margin-bottom: 4px; }
.thread-note-body { font-size: 12px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.thread-goto { font-size: 11px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--vscode-panel-border); cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(session.mr.title)}</h1>
  <div class="progress">${progress}/${total} revisados</div>
  <div class="toolbar">
    <button onclick="post('commentLine')">Comentar linha</button>
    <button class="secondary" onclick="post('prev')">← Anterior</button>
    <button class="secondary" onclick="post('next')">Próximo →</button>
    <button onclick="post('toggleReviewed')">Marcar revisado</button>
    <button onclick="post('submitAllDrafts')" ${drafts.length === 0 ? "disabled" : ""}>Enviar fila (${drafts.length})</button>
    <button class="secondary" onclick="post('cancelDrafts')" ${drafts.length === 0 ? "disabled" : ""}>Limpar fila</button>
    <button class="approve" onclick="post('approveMr')">Aprovar MR</button>
    <button class="danger" onclick="post('rejectMr')">Rejeitar MR</button>
  </div>
</header>
<main>
  <section class="queue">${queueHtml}</section>
  <section class="detail">
    ${overviewHtml}
    ${discussionsHtml}
    <div class="file-section">
      <div class="path">${escapeHtml(activePath)}</div>
    </div>
    ${draftsHtml}
    ${previewHtml}
  </section>
</main>
<script>
const vscode = acquireVsCodeApi();
function post(type, path) {
  vscode.postMessage({ type, path: path || ${JSON.stringify(activePath)} });
}
document.querySelectorAll('[data-path]').forEach(el => {
  el.addEventListener('click', () => post('select', el.getAttribute('data-path')));
  el.addEventListener('dblclick', (e) => {
    e.preventDefault();
    post('openDiff', el.getAttribute('data-path'));
  });
});
document.querySelectorAll('.removed-line').forEach(btn => {
  btn.addEventListener('click', () => {
    const oldLine = Number(btn.getAttribute('data-old-line'));
    if (oldLine) vscode.postMessage({ type: 'commentLineRemoved', path: ${JSON.stringify(activePath)}, oldLine });
  });
});
document.querySelectorAll('[data-draft-id]').forEach(el => {
  el.querySelector('.draft-goto')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = el.getAttribute('data-draft-id');
    if (id) vscode.postMessage({ type: 'goToDraft', id });
  });
  el.querySelector('.draft-toggle')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = el.getAttribute('data-draft-id');
    if (id) vscode.postMessage({ type: 'toggleDraft', id });
  });
});
document.querySelectorAll('.flow-node').forEach(node => {
  node.addEventListener('click', () => {
    const path = node.getAttribute('data-path');
    if (path) post('select', path);
  });
});
document.querySelector('.discussions-refresh')?.addEventListener('click', () => post('refreshDiscussions'));
document.querySelector('.mr-description-body')?.addEventListener('click', (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a.md-link');
  if (!anchor) return;
  e.preventDefault();
  const href = anchor.getAttribute('href');
  if (href && href !== '#') vscode.postMessage({ type: 'openExternalLink', href });
});
document.querySelectorAll('.thread-goto').forEach(btn => {
  btn.addEventListener('click', () => {
    const path = btn.getAttribute('data-path');
    if (!path) return;
    const line = btn.getAttribute('data-line');
    const side = btn.getAttribute('data-side') || 'new';
    if (line) {
      vscode.postMessage({ type: 'goToThread', path, line: Number(line), side });
    } else {
      post('select', path);
    }
  });
});
</script>
</body>
</html>`;
  }
}

function renderQueueItem(card: FileReviewCard, active: boolean, reviewed: boolean): string {
  return `<button class="queue-item ${active ? "active" : ""} ${reviewed ? "done" : ""}" data-path="${escapeHtml(card.path)}">
    <span class="idx">#${card.index}</span>
    <span class="layer">${escapeHtml(card.layer)}</span>
    <div class="name">${escapeHtml(card.fileName)}</div>
    <div class="meta">${escapeHtml(card.summary)}${reviewed ? " · ✓ revisado" : ""}</div>
  </button>`;
}

export type WebviewRequest =
  | { type: "select"; path: string }
  | { type: "openDiff"; path?: string }
  | { type: "prev" }
  | { type: "next" }
  | { type: "toggleReviewed" }
  | { type: "commentMr" }
  | { type: "commentLine" }
  | { type: "submitAllDrafts" }
  | { type: "cancelDrafts" }
  | { type: "removeDraft"; id: string }
  | { type: "goToDraft"; id: string }
  | { type: "toggleDraft"; id: string }
  | { type: "approveMr" }
  | { type: "rejectMr" }
  | { type: "refreshDiscussions" }
  | { type: "goToThread"; path: string; line: number; side: "new" | "old" }
  | { type: "openExternalLink"; href: string }
  | { type: "commentLineRemoved"; path?: string; oldLine?: number };

function renderDraftsSection(drafts: ReturnType<typeof getReviewDrafts>): string {
  if (drafts.length === 0) {
    return "";
  }
  const items = drafts
    .map((d) => {
      const open = isDraftExpanded(d.id);
      const toggleLabel = open ? "Fechar no diff" : "Abrir no diff";
      return `<div class="draft-item ${open ? "open" : ""}" data-draft-id="${escapeHtml(d.id)}">
      <div class="draft-meta">${escapeHtml(d.filePath)} · L${d.line} (${d.side})${
        open ? '<span class="draft-open-tag">· aberto no diff</span>' : ""
      }</div>
      <div class="draft-body">${escapeHtml(d.body)}</div>
      <div class="draft-actions">
        <button type="button" class="draft-goto primary">Ir à linha</button>
        <button type="button" class="draft-toggle">${escapeHtml(toggleLabel)}</button>
      </div>
    </div>`;
    })
    .join("");
  return `<section class="drafts"><h2>Fila (${drafts.length})</h2>${items}</section>`;
}

function renderMrOverview(session: ReviewSession, activePath: string): string {
  const descHtml = renderMrDescriptionHtml(session.mrDescription);
  const flowSvg = renderMrFlowSvg(session.flowGraph);
  const branch = `${escapeHtml(session.mr.source_branch)} → ${escapeHtml(session.mr.target_branch)}`;
  const author = escapeHtml(session.mr.author?.name ?? session.mr.author?.username ?? "");
  return `<section class="mr-overview">
  <h2>Descrição</h2>
  ${descHtml}
  <p class="flow-hint">${branch}${author ? ` · ${author}` : ""}</p>
  <h2>Fluxo do MR</h2>
  <div class="flow-wrap">${flowSvg}</div>
  <p class="flow-hint">Colunas = camada (controller → flow → service…). Setas = imports entre arquivos alterados. Clique em um bloco para selecionar na fila${
    activePath ? ` · ativo: ${escapeHtml(activePath.split("/").pop() ?? activePath)}` : ""
  }.</p>
</section>`;
}
