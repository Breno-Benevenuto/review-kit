import { marked } from "marked";
import { escapeHtml } from "./diffPresentation";

marked.setOptions({
  gfm: true,
  breaks: true,
});

marked.use({
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const url = sanitizeDescriptionHref(href ?? "");
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return `<a href="${escapeAttr(url)}" class="md-link"${titleAttr}>${text}</a>`;
    },
  },
});

export function renderMrDescriptionHtml(description: string | null | undefined): string {
  const raw = (description ?? "").trim();
  if (!raw) {
    return `<p class="mr-desc-empty">Sem descrição no GitLab.</p>`;
  }
  const parsed = marked.parse(raw, { async: false });
  const html = typeof parsed === "string" ? parsed : "";
  return `<div class="mr-description-body markdown-body">${sanitizeDescriptionHtml(html)}</div>`;
}

function sanitizeDescriptionHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed || /^javascript:/i.test(trimmed) || /^data:/i.test(trimmed)) {
    return "#";
  }
  return trimmed;
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function sanitizeDescriptionHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}
