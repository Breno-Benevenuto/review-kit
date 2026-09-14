import * as vscode from "vscode";
import {
  escapeHtml,
  type FileReviewCard,
} from "../review/diffPresentation";
import { renderEditorReviewSummaryHtml } from "../review/editorReviewSummary";
import { getReviewDrafts, isDraftExpanded } from "../review/reviewDrafts";
import { renderMrDescriptionHtml } from "../review/mrDescriptionHtml";
import { renderMrFlowSvg } from "../graph/mrFlowDiagram";

type PanelState = {
  session: ReviewSession;
  activePath: string;
  reviewedPaths: Set<string>;
  onSourceBranch: boolean;
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
      { session, activePath: startPath, reviewedPaths: new Set(reviewedPaths), onSourceBranch: false },
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

  private render(): void {
    const { session, activePath, reviewedPaths } = this.state;
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
.toolbar button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
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
  </div>
</header>
<main>
  <section class="queue">${queueHtml}</section>
  <section class="detail">
    ${overviewHtml}
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
