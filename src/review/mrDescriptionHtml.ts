import { escapeHtml } from "./diffPresentation";

export function renderMrDescriptionHtml(description: string | null | undefined): string {
  const raw = (description ?? "").trim();
  if (!raw) {
    return `<p class="mr-desc-empty">Sem descrição no GitLab.</p>`;
  }
  return `<div class="mr-description-body">${renderSimpleMarkdown(raw)}</div>`;
}

function renderSimpleMarkdown(source: string): string {
  const blocks = source.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) {
        return "";
      }
      if (/^#{1,3}\s/.test(trimmed)) {
        const level = trimmed.match(/^#+/)?.[0].length ?? 1;
        const text = trimmed.replace(/^#+\s*/, "");
        const tag = level <= 1 ? "h3" : level === 2 ? "h4" : "h5";
        return `<${tag}>${inlineMarkdown(text)}</${tag}>`;
      }
      if (/^[-*]\s/m.test(trimmed)) {
        const items = trimmed
          .split("\n")
          .filter((line) => /^[-*]\s/.test(line))
          .map((line) => `<li>${inlineMarkdown(line.replace(/^[-*]\s*/, ""))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${trimmed
        .split("\n")
        .map((line) => inlineMarkdown(line))
        .join("<br/>")}</p>`;
    })
    .filter(Boolean)
    .join("");
}

function inlineMarkdown(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const safeUrl = escapeHtml(String(url));
    return `<a href="${safeUrl}" title="${safeUrl}">${label}</a>`;
  });
  return out;
}
