import { escapeHtml } from "./diffPresentation";
import { buildHeadPreviewFromContent, type PreviewLine } from "./diffHunks";
import { languageIdForPath } from "./languageId";

export function renderCodePreviewHtml(filePath: string, headContent: string, diff: string, loading: boolean): string {
  if (loading && !headContent.trim()) {
    return `<p class="empty">Carregando arquivo…</p>`;
  }
  const languageId = languageIdForPath(filePath);
  const bundle = buildHeadPreviewFromContent(headContent, diff);
  const legend = renderLegend(bundle.stats);
  const removedBlock = bundle.removed.length > 0 ? renderRemovedBlock(bundle.removed, languageId) : "";
  const rows = bundle.lines.map((line) => renderPreviewRow(line, languageId)).join("");
  return `${legend}${removedBlock}<div class="code-preview"><pre class="code">${rows}</pre></div>`;
}

function renderLegend(stats: { added: number; removed: number; modified: number }): string {
  return `<div class="legend">
    <span class="chip add">+${stats.added} adicionadas</span>
    <span class="chip mod">~${stats.modified} no hunk</span>
    <span class="chip del">−${stats.removed} removidas</span>
    <span class="hint">Clique no nº da linha → thread no diff do GitLab</span>
  </div>`;
}

function renderRemovedBlock(removed: PreviewLine[], languageId: string): string {
  const rows = removed
    .slice(0, 40)
    .map((line) => {
      const old = line.oldLine ?? line.number;
      return `<div class="ln del removed-click" data-old-line="${old}"><span class="gutter" title="Thread na linha removida ${old}">−${old}</span><code>${highlightLine(line.text, languageId) || "&nbsp;"}</code></div>`;
    })
    .join("");
  const more = removed.length > 40 ? `<div class="more-removed">… +${removed.length - 40} linhas removidas</div>` : "";
  return `<div class="removed-section"><div class="section-title">Linhas removidas neste arquivo</div>${rows}${more}</div>`;
}

function renderPreviewRow(line: PreviewLine, languageId: string): string {
  const cls =
    line.kind === "add"
      ? "ln add"
      : line.kind === "modify"
        ? "ln mod"
        : line.kind === "remove"
          ? "ln del"
          : "ln ctx";
  const marker = line.kind === "add" ? "+" : line.kind === "modify" ? "~" : " ";
  const code = highlightLine(line.text, languageId);
  return `<div class="${cls}"><span class="gutter" title="Abrir thread GitLab na linha ${line.number}">${line.number}</span><span class="marker">${marker}</span><code>${code || "&nbsp;"}</code></div>`;
}

function highlightLine(text: string, languageId: string): string {
  let escaped = escapeHtml(text);
  if (languageId === "java" || languageId === "kotlin") {
    escaped = escaped.replace(/(\/\/.*$)/, '<span class="tok-com">$1</span>');
    escaped = escaped.replace(/"([^"\\]|\\.)*"/g, (m) => `<span class="tok-str">${m}</span>`);
    escaped = escaped.replace(
      /\b(public|private|protected|class|interface|enum|record|void|int|long|boolean|final|static|return|new|if|else|for|while|switch|case|import|package|throws|extends|implements|null|true|false|val|var|fun|override)\b/g,
      '<span class="tok-kw">$1</span>',
    );
    escaped = escaped.replace(/\b([A-Z][A-Za-z0-9_]*)\b/g, '<span class="tok-type">$1</span>');
  } else if (languageId === "typescript" || languageId === "javascript") {
    escaped = escaped.replace(/(\/\/.*$)/, '<span class="tok-com">$1</span>');
    escaped = escaped.replace(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g, (m) => `<span class="tok-str">${m}</span>`);
    escaped = escaped.replace(
      /\b(export|import|from|const|let|var|function|return|if|else|async|await|class|interface|type|null|undefined|true|false)\b/g,
      '<span class="tok-kw">$1</span>',
    );
  }
  return escaped;
}
