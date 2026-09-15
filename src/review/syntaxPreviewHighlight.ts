import { escapeHtml } from "./diffPresentation";

export function highlightLine(text: string, languageId: string): string {
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
