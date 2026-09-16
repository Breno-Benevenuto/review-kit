import * as vscode from "vscode";
import {
  escapeHtml,
  type FileReviewCard,
} from "../review/diffPresentation";
import { getReviewDrafts, isDraftExpanded } from "../review/reviewDrafts";
import { renderMrDescriptionHtml } from "../review/mrDescriptionHtml";
import { renderMrFlowSvg } from "../graph/mrFlowDiagram";
import type { MrDiscussionThreadView } from "../gitlab/types";
import { setDiffReviewOpen } from "../review/reviewFileNavigation";
import type { ReviewSession } from "../review/reviewSession";
import { renderSideBySideDiffHtml } from "../review/sideBySideDiffHtml";
import { type SymbolRefSummary, renderSymbolRefsHtml } from "../review/changedSymbolRefs";
import { detectRisks } from "../review/diffPresentation";
import { pinActiveEditorTab } from "../review/pinReviewTab";

type PanelState = {
  session: ReviewSession;
  activePath: string;
  reviewedPaths: Set<string>;
  onSourceBranch: boolean;
  discussions: MrDiscussionThreadView[];
  discussionsLoading: boolean;
  discussionsError?: string;
  symbolRefs: SymbolRefSummary[];
  symbolRefsLoading: boolean;
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
        symbolRefs: VisualReviewPanel.current.state.symbolRefs,
        symbolRefsLoading: VisualReviewPanel.current.state.symbolRefsLoading,
      };
      VisualReviewPanel.current.render();
      VisualReviewPanel.current.panel.reveal(vscode.ViewColumn.One);
      void pinActiveEditorTab();
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
      {
        session,
        activePath: startPath,
        reviewedPaths: new Set(reviewedPaths),
        onSourceBranch: false,
        discussions: [],
        discussionsLoading: true,
        symbolRefs: [],
        symbolRefsLoading: true,
      },
      onMessage,
    );
    VisualReviewPanel.current = instance;
    instance.render();
    void pinActiveEditorTab();
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

  updateSession(session: ReviewSession, reviewedPaths: Set<string>): void {
    this.state.session = session;
    this.state.reviewedPaths = new Set(reviewedPaths);
    this.render();
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

  setSymbolRefsLoading(loading: boolean): void {
    this.state.symbolRefsLoading = loading;
    if (loading) {
      this.state.symbolRefs = [];
    }
    this.render();
  }

  setSymbolRefs(refs: SymbolRefSummary[]): void {
    this.state.symbolRefs = refs;
    this.state.symbolRefsLoading = false;
    this.render();
  }

  private render(): void {
    const { session, activePath, reviewedPaths, discussions, discussionsLoading, discussionsError } =
      this.state;
    const drafts = getReviewDrafts();
    const activeChange = session.changeByPath.get(activePath);
    const activeDiff = activeChange?.diff ?? "";
    const diffHtml = activeChange
      ? renderSideBySideDiffHtml(activePath, activeDiff, {
          filePath: activePath,
          threads: discussions,
          drafts,
        })
      : "";
    const risks = detectRisks(activeDiff);
    const risksHtml =
      risks.length > 0
        ? `<div class="risks">${risks.map((r) => `<span class="risk-tag">${escapeHtml(r)}</span>`).join("")}</div>`
        : `<div class="risks ok">Nenhum padrão de risco automático neste arquivo.</div>`;
    const refsHtml = this.state.symbolRefsLoading
      ? `<p class="refs-loading">Carregando referências LSP…</p>`
      : renderSymbolRefsHtml(this.state.symbolRefs);

    const queueHtml = session.cards
      .map((card) => renderQueueItem(card, card.path === activePath, reviewedPaths.has(card.path)))
      .join("");

    const progress = reviewedPaths.size;
    const total = session.cards.length;
    const draftsHtml = renderDraftsSection(drafts);
    const overviewHtml = renderMrOverviewCollapsed(session, activePath);
    const discussionsStatusHtml =
      discussionsLoading
        ? `<p class="diff-comment-hint loading">Carregando comentários do GitLab…</p>`
        : discussionsError
          ? `<p class="diff-comment-hint error">${escapeHtml(discussionsError)}</p>`
          : `<p class="diff-comment-hint">Duplo clique na linha para comentar · clique no indicador ou na linha com thread para expandir</p>`;

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
.toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.toolbar button {
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: filter 0.12s ease, transform 0.08s ease;
}
.toolbar button:hover:not(:disabled) { filter: brightness(1.08); }
.toolbar button:active:not(:disabled) { transform: translateY(1px); }
.toolbar button:disabled { opacity: 0.45; cursor: default; }
.toolbar button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.toolbar button.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border-color: var(--vscode-panel-border);
}
.toolbar button.ghost {
  background: transparent;
  color: var(--vscode-foreground);
  border-color: var(--vscode-panel-border);
}
.toolbar button.danger {
  background: var(--vscode-inputValidation-errorBackground);
  color: var(--vscode-inputValidation-errorForeground);
  border-color: var(--vscode-inputValidation-errorBorder, transparent);
}
.toolbar button.approve {
  background: var(--vscode-gitDecoration-addedResourceForeground, #2ea043);
  color: var(--vscode-editor-background, #fff);
}
.toolbar .sep { width: 1px; height: 22px; background: var(--vscode-panel-border); margin: 0 2px; }
main { flex: 1; display: grid; grid-template-columns: 300px 1fr; min-height: 0; }
.queue { border-right: 1px solid var(--vscode-panel-border); overflow: auto; padding: 8px; }
.queue-item { width: 100%; text-align: left; border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); color: inherit; border-radius: 8px; padding: 8px; margin-bottom: 8px; cursor: pointer; }
.queue-item.active { outline: 2px solid var(--vscode-focusBorder); }
.queue-item.done { opacity: 0.75; }
.idx { font-weight: 700; margin-right: 6px; }
.layer { display: inline-block; font-size: 10px; padding: 2px 6px; border-radius: 999px; margin-right: 6px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.name { font-size: 12px; font-weight: 600; word-break: break-all; }
.meta { font-size: 11px; opacity: 0.8; margin-top: 4px; }
.detail { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
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
.drafts { flex: 0 0 auto; margin: 0 12px 12px; padding: 10px; max-height: min(180px, 22vh); overflow: auto; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-sideBar-background); }
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
.mr-overview { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
.mr-overview details { margin-bottom: 8px; }
.mr-overview summary { cursor: pointer; font-size: 12px; font-weight: 600; padding: 4px 0; }
.diff-panel { padding: 0 12px 12px; flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.diff-panel-head { flex: 0 0 auto; padding: 10px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 8px; }
.diff-empty, .refs-loading, .refs-empty { font-size: 12px; opacity: 0.85; }
.diff-comment-hint { font-size: 11px; opacity: 0.85; margin: 0 0 8px; }
.diff-comment-hint.error { color: var(--vscode-inputValidation-errorForeground); }
.diff-split-head { display: grid; grid-template-columns: 24px 1fr 1fr; gap: 0; font-size: 11px; font-weight: 600; opacity: 0.85; margin-bottom: 4px; padding: 0 0 0 4px; }
.diff-head-marker { width: 24px; }
.diff-split { font-family: var(--vscode-editor-font-family); font-size: 11px; line-height: 1.45; overflow: auto; flex: 1; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background); }
.diff-hunk { padding: 4px 8px; opacity: 0.75; background: var(--vscode-editor-inactiveSelectionBackground); font-size: 10px; }
.diff-line-block { border-bottom: 1px solid transparent; }
.diff-line-block.thread-open { background: var(--vscode-editor-inactiveSelectionBackground); }
.diff-row { display: grid; grid-template-columns: 24px 1fr 1fr; align-items: stretch; }
.diff-row.has-comments .diff-marker { border-left: 3px solid var(--vscode-textLink-foreground); }
.diff-row.resolved-only .diff-marker { border-left-color: var(--vscode-descriptionForeground); }
.diff-marker { display: flex; align-items: center; justify-content: center; padding: 0 2px; }
.thread-pin { width: 14px; height: 14px; padding: 0; border: 2px solid var(--vscode-textLink-foreground); border-radius: 50%; background: transparent; cursor: pointer; }
.thread-pin.empty { border: 0; cursor: default; }
.diff-row.has-open-threads .thread-pin { background: var(--vscode-textLink-foreground); }
.diff-row.resolved-only .thread-pin { border-color: var(--vscode-descriptionForeground); background: var(--vscode-descriptionForeground); opacity: 0.55; }
.diff-row.has-resolved-threads:not(.resolved-only) .thread-pin { box-shadow: inset 0 0 0 3px var(--vscode-editor-background); background: linear-gradient(135deg, var(--vscode-textLink-foreground) 50%, var(--vscode-descriptionForeground) 50%); }
.inline-discussion.is-resolved { margin-bottom: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background); }
.inline-discussion.is-resolved:last-child { margin-bottom: 0; }
.inline-discussion-summary { list-style: none; cursor: pointer; padding: 8px 10px; font-size: 11px; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.inline-discussion.is-resolved > summary { list-style: none; }
.inline-discussion.is-resolved > summary::-webkit-details-marker { display: none; }
.inline-resolved-badge { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); opacity: 0.9; }
.inline-discussion-preview { opacity: 0.88; flex: 1; min-width: 0; }
.inline-discussion-body { padding: 0 10px 10px; border-top: 1px solid var(--vscode-panel-border); }
.diff-cell { display: flex; gap: 4px; padding: 0 6px; border-bottom: 1px solid var(--vscode-panel-border); min-height: 1.45em; }
.diff-cell.commentable { cursor: text; }
.diff-cell.commentable:hover { box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }
.diff-cell code { flex: 1; white-space: pre-wrap; word-break: break-word; }
.diff-cell.left.del, .diff-cell.right.add, .diff-cell.right.mod { background: var(--vscode-diffEditor-insertedLineBackground, rgba(46,160,67,.12)); }
.diff-cell.left.del { background: var(--vscode-diffEditor-removedLineBackground, rgba(248,81,73,.12)); }
.diff-cell.left.del.only { background: var(--vscode-diffEditor-removedLineBackground, rgba(248,81,73,.12)); }
.gutter { flex: 0 0 36px; text-align: right; padding: 0 4px; color: var(--vscode-descriptionForeground); font-family: inherit; font-size: 10px; user-select: none; }
.gutter.empty { flex: 0 0 36px; }
.diff-inline-thread { padding: 8px 10px 10px 34px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
.diff-inline-thread.collapsed { display: none; }
.inline-thread-anchor { margin-bottom: 10px; }
.inline-thread-anchor:last-child { margin-bottom: 0; }
.inline-thread-anchor-label { font-size: 10px; font-weight: 600; opacity: 0.8; margin-bottom: 6px; }
.inline-thread-note { margin-bottom: 8px; padding: 8px 10px; border-radius: 8px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); }
.inline-thread-note.mine { border-left: 3px solid var(--vscode-gitDecoration-addedResourceForeground); }
.inline-thread-note.theirs { border-left: 3px solid var(--vscode-textLink-foreground); }
.inline-thread-note.draft { border-left: 3px solid var(--vscode-inputValidation-warningBorder); }
.inline-thread-meta { font-size: 10px; opacity: 0.85; margin-bottom: 4px; }
.inline-thread-body { font-size: 12px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.inline-composer { margin: 0; padding: 8px 10px 10px 34px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
.inline-composer textarea, .inline-reply-input { width: 100%; font-family: inherit; font-size: 12px; padding: 8px; border-radius: 6px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); resize: vertical; }
.inline-composer-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.inline-composer-actions button { font-family: inherit; font-size: 11px; padding: 5px 10px; border-radius: 6px; border: 1px solid var(--vscode-panel-border); cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.inline-composer-actions button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
.inline-reply-form { margin-top: 8px; }
.tok-kw { color: var(--vscode-symbolIcon-keywordForeground, #c586c0); }
.tok-str { color: var(--vscode-symbolIcon-stringForeground, #ce9178); }
.tok-com { opacity: 0.7; }
.tok-type { color: var(--vscode-symbolIcon-classForeground, #4ec9b0); }
.symbol-refs { flex: 0 0 auto; margin: 0 0 8px; padding: 10px; max-height: min(160px, 20vh); overflow: auto; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-sideBar-background); }
.symbol-refs h3 { font-size: 12px; margin: 0 0 8px; }
.ref-card { margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
.ref-card:last-child { border-bottom: 0; margin-bottom: 0; padding-bottom: 0; }
.ref-head { font-size: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.ref-kind, .ref-line, .ref-count { font-size: 10px; opacity: 0.8; }
.ref-list { margin: 6px 0 0; padding-left: 18px; font-size: 11px; }
.ref-list .muted { opacity: 0.7; list-style: none; margin-left: -18px; }
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
.discussions { flex: 0 0 auto; margin: 0 0 8px; padding: 8px 10px; max-height: min(220px, 28vh); overflow: auto; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-sideBar-background); }
.discussions .thread-card:last-child { margin-bottom: 0; }
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
    <button class="ghost" onclick="post('prev')">← Anterior</button>
    <button class="ghost" onclick="post('next')">Próximo →</button>
    <span class="sep"></span>
    <button class="primary" onclick="post('commentLine')">Comentar linha</button>
    <button class="secondary" onclick="post('toggleReviewed')">Marcar revisado</button>
    <button class="secondary" onclick="post('openEditorDiff')">Diff no editor</button>
    <span class="sep"></span>
    <button class="primary" onclick="post('submitAllDrafts')" ${drafts.length === 0 ? "disabled" : ""}>Enviar fila (${drafts.length})</button>
    <button class="ghost" onclick="post('cancelDrafts')" ${drafts.length === 0 ? "disabled" : ""}>Limpar fila</button>
    <span class="sep"></span>
    <button class="approve" onclick="post('approveMr')">Aprovar</button>
    <button class="danger" onclick="post('rejectMr')">Rejeitar</button>
  </div>
</header>
<main>
  <section class="queue">${queueHtml}</section>
  <section class="detail">
    ${overviewHtml}
    <div class="diff-panel">
      <div class="diff-panel-head">
        <div class="path">${escapeHtml(activePath)}</div>
        ${risksHtml}
        ${discussionsStatusHtml}
      </div>
      ${refsHtml}
      ${diffHtml}
    </div>
    ${draftsHtml}
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
    const path = el.getAttribute('data-path');
    if (path) vscode.postMessage({ type: 'openFile', path });
  });
});
const activeFilePath = ${JSON.stringify(activePath)};
const diffSplit = document.querySelector('.diff-split');
let suppressLineClick = false;
function lineBlockHasThread(block) {
  return !!block?.querySelector('.diff-inline-thread .inline-thread-note, .diff-inline-thread .inline-discussion, .diff-inline-thread details.inline-discussion');
}
function toggleThreadBlock(block, open) {
  const panel = block?.querySelector('.diff-inline-thread');
  if (!panel) return;
  const shouldOpen = open ?? panel.classList.contains('collapsed');
  panel.classList.toggle('collapsed', !shouldOpen);
  block?.classList.toggle('thread-open', shouldOpen);
}
function closeInlineComposer() {
  document.querySelectorAll('.inline-composer').forEach((el) => el.remove());
}
function mountInlineComposer(block, side, line) {
  closeInlineComposer();
  const wrap = document.createElement('div');
  wrap.className = 'inline-composer';
  wrap.dataset.side = side;
  wrap.dataset.line = String(line);
  wrap.innerHTML = '<textarea class="inline-comment-input" rows="3" placeholder="Escreva um comentário…"></textarea>' +
    '<div class="inline-composer-actions">' +
    '<button type="button" class="primary" data-action="send">Comentar</button>' +
    '<button type="button" data-action="queue">Salvar na fila</button>' +
    '<button type="button" data-action="cancel">Cancelar</button></div>';
  const row = block.querySelector('.diff-row');
  const thread = block.querySelector('.diff-inline-thread');
  if (thread) {
    thread.classList.remove('collapsed');
    block.classList.add('thread-open');
    row?.insertAdjacentElement('afterend', wrap);
  } else {
    row?.insertAdjacentElement('afterend', wrap);
  }
  const ta = wrap.querySelector('textarea');
  ta?.focus();
  wrap.querySelector('[data-action="cancel"]')?.addEventListener('click', () => wrap.remove());
  wrap.querySelector('[data-action="send"]')?.addEventListener('click', () => {
    const body = ta?.value?.trim();
    if (!body) return;
    vscode.postMessage({ type: 'submitInlineComment', path: activeFilePath, line: Number(line), side, body, action: 'send' });
  });
  wrap.querySelector('[data-action="queue"]')?.addEventListener('click', () => {
    const body = ta?.value?.trim();
    if (!body) return;
    vscode.postMessage({ type: 'submitInlineComment', path: activeFilePath, line: Number(line), side, body, action: 'queue' });
  });
  ta?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      wrap.querySelector('[data-action="send"]')?.click();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      wrap.remove();
    }
  });
}
diffSplit?.addEventListener('click', (e) => {
  if (suppressLineClick) return;
  const target = e.target;
  if (!(target instanceof Element)) return;
  if (target.closest('.inline-composer, .inline-reply-form, details.inline-discussion, textarea, button')) return;
  const pin = target.closest('.thread-pin:not(.empty)');
  if (pin) {
    e.preventDefault();
    const block = pin.closest('.diff-line-block');
    if (block) toggleThreadBlock(block);
    return;
  }
  const cell = target.closest('.diff-cell.commentable');
  if (!cell) return;
  const block = cell.closest('.diff-line-block');
  if (!block || !lineBlockHasThread(block)) return;
  toggleThreadBlock(block);
});
diffSplit?.addEventListener('dblclick', (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const cell = target.closest('.diff-cell.commentable');
  if (!cell) return;
  e.preventDefault();
  suppressLineClick = true;
  setTimeout(() => { suppressLineClick = false; }, 320);
  const side = cell.getAttribute('data-comment-side') === 'old' ? 'old' : 'new';
  const line = Number(cell.getAttribute('data-comment-line'));
  if (!line) return;
  const block = cell.closest('.diff-line-block');
  if (block) mountInlineComposer(block, side, line);
});
diffSplit?.addEventListener('submit', (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || !form.classList.contains('inline-reply-form')) return;
  e.preventDefault();
  const discussionId = form.getAttribute('data-discussion-id');
  const input = form.querySelector('.inline-reply-input');
  const body = input instanceof HTMLTextAreaElement ? input.value.trim() : '';
  if (!discussionId || !body) return;
  vscode.postMessage({ type: 'replyInlineComment', path: activeFilePath, discussionId, body });
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
document.querySelector('.mr-description-body')?.addEventListener('click', (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a.md-link');
  if (!anchor) return;
  e.preventDefault();
  const href = anchor.getAttribute('href');
  if (href && href !== '#') vscode.postMessage({ type: 'openExternalLink', href });
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
  | { type: "openFile"; path: string }
  | { type: "openEditorDiff"; path?: string }
  | { type: "commentLineAt"; path: string; line: number; side: "new" | "old" }
  | { type: "submitInlineComment"; path: string; line: number; side: "new" | "old"; body: string; action: "send" | "queue" }
  | { type: "replyInlineComment"; path: string; discussionId: string; body: string }
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

function renderMrOverviewCollapsed(session: ReviewSession, activePath: string): string {
  const descHtml = renderMrDescriptionHtml(session.mrDescription);
  const flowSvg = renderMrFlowSvg(session.flowGraph);
  const branch = `${escapeHtml(session.mr.source_branch)} → ${escapeHtml(session.mr.target_branch)}`;
  const author = escapeHtml(session.mr.author?.name ?? session.mr.author?.username ?? "");
  return `<section class="mr-overview">
  <details>
    <summary>Descrição do MR · ${branch}${author ? ` · ${author}` : ""}</summary>
    ${descHtml}
  </details>
  <details>
    <summary>Fluxo do MR (camadas)${
      activePath ? ` · ativo: ${escapeHtml(activePath.split("/").pop() ?? activePath)}` : ""
    }</summary>
    <div class="flow-wrap">${flowSvg}</div>
    <p class="flow-hint">Clique em um bloco para selecionar na fila.</p>
  </details>
</section>`;
}
