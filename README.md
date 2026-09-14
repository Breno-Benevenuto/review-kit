# Review Kit

Extensão para **Cursor** e **VS Code** que traz revisão de **Merge Requests do GitLab** para dentro do editor: fila ordenada, diff nativo, descrição do MR, fluxograma da change, comentários em fila e progresso de review — sem sair do IDE.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85-007ACC?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Cursor](https://img.shields.io/badge/Cursor-compatible-000000)](https://cursor.com/)

---

## 📋 Sumário

- [Por que usar](#-por-que-usar)
- [Funcionalidades](#-funcionalidades)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Fluxo de review](#-fluxo-de-review)
- [Fila de comentários](#-fila-de-comentários)
- [Painel do MR](#-painel-do-mr)
- [Comandos](#-comandos)
- [Settings](#-settings)
- [Desenvolvimento](#-desenvolvimento)
- [Licença](#-licença)

---

## 💡 Por que usar

Revisar MR no browser quebra o contexto: você alterna entre diff, código local, notas e fila mental de comentários. O **Review Kit** centraliza isso:

| Antes | Com Review Kit |
|--------|----------------|
| Diff no GitLab + IDE separados | Diff nativo (`vscode.diff`) ao lado do projeto |
| Ordem de arquivos aleatória | Ordem heurística **controller → flow → service → …** |
| Comentários um a um | **Fila** local → envio em lote |
| Contexto do MR disperso | **Descrição + fluxograma** no painel ao abrir o MR |

---

## ✨ Funcionalidades

### Core

- 📂 **Lista de MRs** na sidebar (projeto inferido do `git remote` ou `reviewKit.projectPath`)
- 🧭 **Revisão visual** — painel central + fila de arquivos ordenada
- 📊 **Progresso** — marcar arquivos revisados; estado persistido por MR
- 🔀 **Diff no editor** — double-click no arquivo (ou comando); syntax highlight; navegação entre changes
- 🕸 **Grafo de dependências** — WebView React Flow (imports entre arquivos do MR)
- 📝 **Comentários GitLab** — nota no MR, thread por linha (new/old), approve / request changes

### Review guiado

- 🎯 **Ordem sugerida** por camada (`controller`, `flow`, `service`, `repository`, …) e imports no diff
- 📄 **Descrição do MR** renderizada no painel (markdown básico)
- 🗺 **Fluxograma SVG** — arquivos alterados por camada + setas de import entre eles; clique seleciona na fila
- ➕ **Inlay hints `+`** em cada linha do diff para comentar rapidamente

### Fila de comentários

- 💾 **Salvar na fila** ou enviar na hora ao criar comentário de linha
- 📍 **Ir à linha** a partir da fila (abre diff + foco na linha)
- 💬 **Abrir/fechar** rascunho no diff (threads nativas colapsáveis)
- 🚀 **Enviar fila** — publica todos os comentários no GitLab de uma vez

---

## 🚀 Instalação

Instala no painel **Extensions** (VSIX local). Não precisa F5 a cada mudança.

```bash
git clone https://github.com/Breno-Benevenuto/review-kit.git
cd review-kit
npm install
npm run install:cursor
```

No Cursor: **Developer: Reload Window**.

Confirme em **Extensions** → **Review Kit** (`review-kit.review-kit`).

**Alternativa manual**

```bash
npm run package
# Extensions → … → Install from VSIX… → review-kit-x.y.z.vsix
```

**Atualizar** após pull ou alterações locais:

```bash
npm run install:cursor
```

---

## ⚙️ Configuração

Autenticação no GitLab — **escolha uma** (ou use `GITLAB_TOKEN` para dev; ver abaixo):

### Opção A — OAuth / SSO (recomendado em GitLab com login corporativo)

1. No GitLab: **User Settings → Applications** (ou grupo/admin cria o app) → **Add new application**.
   - **Redirect URI:** `vscode://review-kit.review-kit/gitlab-oauth`
   - Escopos: `api`, `read_user`, `read_api`, `write_repository` (ajuste à política da instância).
2. Copie o **Application ID** para settings:

```json
{
  "reviewKit.gitlabOAuthClientId": "SEU_APPLICATION_ID"
}
```

3. **Command Palette** → `Review Kit: Entrar no GitLab (OAuth/SSO)` — abre o browser; após login, o token fica no Secret Storage da extensão.

(Opcional) **Client secret** se o app não for público: `reviewKit.gitlabOAuthClientSecret` ou `GITLAB_OAUTH_CLIENT_SECRET`.

### Opção B — Personal Access Token (PAT)

**Command Palette** → `Review Kit: Configure GitLab Token (PAT)`  
Token com `read_api`; comentários/approve exigem escopos de escrita conforme sua política GitLab.

### Dev / CI local — variável de ambiente

- `GITLAB_TOKEN` no ambiente ou em `~/.cursor/.env.cursor` (não versionado).
- Com `reviewKit.preferGitLabTokenFromEnv` (default `true`), o env tem prioridade sobre OAuth/PAT salvos.
- `Review Kit: Recarregar token GitLab (GITLAB_TOKEN)` após mudar o arquivo.

---

1. (Opcional) GitLab self-managed — defina a URL base:

```json
{
  "reviewKit.gitlabUrl": "https://gitlab.example.com"
}
```

2. (Opcional) Projeto fixo quando o workspace não bate com o remote:

```json
{
  "reviewKit.projectPath": "grupo/repositorio"
}
```

---

## 🔄 Fluxo de review

```
Review Kit (sidebar)
└─ Merge Requests
   └─ !123 — título do MR          ← clique: abre painel + overview
      ├─ OrderController.java      ← clique: seleciona · duplo-clique: diff
      ├─ ResizeImageFlow.java
      └─ ImageService.java
```

1. **Refresh** na lista de MRs.
2. **Clique no MR** — painel `Review !{iid}` com descrição, fluxograma e fila ordenada.
3. **Clique no arquivo** — destaque no painel; **duplo-clique** (ou toolbar) — abre diff.
4. **`+` na linha** ou comando **Comentar linha** — salva na fila ou envia.
5. **Marcar revisado** — toolbar ou árvore; progresso em **Review Progress**.
6. **Enviar fila** quando terminar os rascunhos.

Atalhos úteis (com review ativo):

| Atalho | Ação |
|--------|------|
| `Alt+→` / `Alt+←` | Próximo / anterior arquivo na ordem sugerida |

---

## 📬 Fila de comentários

1. Com review aberta, comente uma linha → **Salvar na fila**.
2. No painel, seção **Fila (N)**:
   - **Ir à linha** — diff + scroll até o comentário.
   - **Abrir no diff** / **Fechar no diff** — expande/colapsa thread no editor.
3. No diff, inlay **`💬`** / **`▼`** na mesma linha alterna o rascunho.
4. **Enviar fila (N)** publica todas as discussions no MR.

---

## 📖 Painel do MR

Ao abrir um MR, a coluna principal mostra:

- **Descrição** — texto do GitLab (títulos, listas, links).
- **Fluxo do MR** — diagrama por camadas; setas = imports detectados nos diffs dos arquivos do MR.
- **Arquivo ativo** — resumo do diff e fila de comentários abaixo.

Branches e autor aparecem abaixo da descrição.

---

## 🎮 Comandos

| Comando | Descrição |
|---------|-----------|
| `Review Kit: Entrar no GitLab (OAuth/SSO)` | Login no browser (PKCE); ideal para SSO |
| `Review Kit: Configure GitLab Token (PAT)` | Salva PAT no Secret Storage |
| `Review Kit: Recarregar token GitLab (GITLAB_TOKEN)` | Relê env / `.env.cursor` |
| `Review Kit: Refresh Merge Requests` | Recarrega MRs abertos |
| `Review Kit: Open Visual Review` | Abre painel do MR selecionado |
| `Review Kit: Submit All Drafts` | Envia fila de comentários |
| `Review Kit: Cancel Review Drafts` | Limpa fila local |
| `Review Kit: Approve MR` / `Request Changes` | Ações de review no GitLab |
| `Review Kit: Review Next/Prev File` | Navega na ordem sugerida |

Comandos de diff/comentário exigem contexto `reviewKit.mrReviewActive` (diff ou arquivo do MR focado).

---

## 🛠 Settings

| Setting | Default | Descrição |
|---------|---------|-----------|
| `reviewKit.gitlabUrl` | `https://gitlab.com` | Base do GitLab (sem `/` final) |
| `reviewKit.projectPath` | `""` | `group/repo`; vazio = origin do workspace |
| `reviewKit.diffInline` | `false` | Diff unificado (inline) vs side-by-side |
| `reviewKit.openProjectEditorForNavigation` | `true` | Abre cópia do arquivo ao lado do diff para LSP/Go to Definition |
| `reviewKit.preferGitLabTokenFromEnv` | `true` | Prioriza `GITLAB_TOKEN` sobre token OAuth/PAT salvo |
| `reviewKit.gitlabOAuthClientId` | `""` | Application ID para OAuth |
| `reviewKit.gitlabOAuthRedirectUri` | `vscode://review-kit.review-kit/gitlab-oauth` | Deve coincidir com o app no GitLab |

---

## 🧑‍💻 Desenvolvimento

```bash
npm install
npm run compile      # extensão + webview do grafo
npm run lint
node scripts/self-check.mjs
```

Debug: **Run Extension** em `.vscode/launch.json` (F5) ou reinstale com `npm run install:cursor`.

Auth: OAuth (`Entrar no GitLab`), PAT (`Configure GitLab Token`), ou `GITLAB_TOKEN` / `~/.cursor/.env.cursor`.

---

## 📄 Licença

[MIT](LICENSE) — Breno Benevenuto.

---

<p align="center">
  <sub>Feito para quem revisa MR no GitLab e quer ficar no editor.</sub>
</p>
