# Review Kit

Cursor / VS Code extension for guided GitLab merge request reviews: MR list, native diffs, dependency flow graph, review progress, and GitLab actions from the IDE.

## Setup

1. Run `npm install` and `npm run compile`.
2. Press F5 to launch Extension Development Host.
3. Command **Review Kit: Configure GitLab Token** (needs `read_api`; comments/approve need appropriate scopes).
4. Set `reviewKit.gitlabUrl` for self-managed GitLab (default `https://gitlab.com`).

## Features (plan phases)

| Phase | Status |
|-------|--------|
| 1 — GitLab MR list + diff in editor | Done |
| 2 — Flow graph (React Flow WebView) | Done |
| 3 — Per-file context summary + suggested order | Done (heuristic; use Cursor Chat for deep AI) |
| 4 — Review checklist, MR notes, approve / request changes | Done |

## Usage

- Sidebar **Review Kit → Merge Requests** → refresh → expand MR → click file for diff.
- Context menu on MR → **Open Review Flow Graph**; click a node to open diff.
- Mark files reviewed from the tree context menu; progress appears under **Review Progress**.
- Commands: post comment, approve MR, request changes (with optional note).

## Development

```bash
npm install
npm run compile
npm run lint
```

See `docs/plugin-code-review-plano.md` for the original product plan.
