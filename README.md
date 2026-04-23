# Trilium Notes for VS Code

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![VS Code Engine](https://img.shields.io/badge/VS%20Code-%5E1.116.0-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![CI](https://github.com/NemesisRE/vscode-trilium-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/NemesisRE/vscode-trilium-extension/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/NemesisRE/vscode-trilium-extension?style=flat&logo=github&label=release)](https://github.com/NemesisRE/vscode-trilium-extension/releases/latest)
[![GitHub Downloads](https://img.shields.io/github/downloads/NemesisRE/vscode-trilium-extension/total?style=flat&logo=github&label=downloads)](https://github.com/NemesisRE/vscode-trilium-extension/releases)
[![GitHub Stars](https://img.shields.io/github/stars/NemesisRE/vscode-trilium-extension?style=flat&logo=github)](https://github.com/NemesisRE/vscode-trilium-extension/stargazers)

Browse, search, and edit your [Trilium Notes](https://github.com/TriliumNext/trilium-notes) directly inside VS Code using the [ETAPI REST API](https://triliumnotes.org/api).

---

## Welcome

This extension is built for people who already live in VS Code and want their Trilium Notes workflow in the same place.

Use it to:

- Browse your full Trilium note tree in the sidebar.
- Edit text notes in a rich CKEditor-powered WYSIWYG editor.
- Open code, mermaid, canvas, and other note types with the right editor flow.
- Search notes quickly, manage attributes and attachments, and review revisions.
- Clone, move, and export notes without leaving VS Code.

If you want a fast setup, you can be connected in about a minute.

## Quick Start

1. Install the extension.
2. Open the **Trilium Notes** view in the Activity Bar.
3. Run **Trilium: Connect to Trilium Server**.
4. Enter your server URL and ETAPI token.
5. Open a note and start editing.

## Why It Feels Native

- Keyboard-first workflows using normal VS Code commands and save behavior.
- Theme-aware editor styling so notes blend with your current color theme.
- Secure token storage through VS Code secret storage.
- Deep command coverage for daily note management.

## Read Next

- New here: start with [Getting Started](docs/getting-started.md)
- Want capabilities overview: [Features](docs/features.md)
- Looking for commands and settings: [Reference](docs/reference.md)
- Using Copilot or scripts: [Automation](docs/automation.md)
- Curious what is planned: [Roadmap](docs/roadmap.md)
- Attribution and license details: [Credits](docs/credits.md)

## Documentation

- [Getting Started](docs/getting-started.md)
- [Features](docs/features.md)
- [Reference](docs/reference.md)
- [Automation](docs/automation.md)
- [Roadmap](docs/roadmap.md)
- [Credits](docs/credits.md)

## Screenshot Gallery

<!-- markdownlint-disable MD033 -->
<table>
  <tr>
    <td align="center" valign="bottom" style="border: none;">
      <a href="media/screenshots/01-note-tree.png"><img src="media/screenshots/01-note-tree.png" width="280" height="240" alt="Note tree" /></a><br />
      <sub><strong>Note tree:</strong> Browse notes with type icons and visual cues.</sub>
    </td>
    <td align="center" valign="bottom" style="border: none;">
      <a href="media/screenshots/02-wysiwyg-editor.png"><img src="media/screenshots/02-wysiwyg-editor.png" width="280" height="240" alt="WYSIWYG editor" /></a><br />
      <sub><strong>WYSIWYG editor:</strong> Edit Trilium text notes with rich formatting.</sub>
    </td>
  </tr>
  <tr>
    <td align="center" valign="bottom" style="border: none;">
      <a href="media/screenshots/03-attributes-sidebar.png"><img src="media/screenshots/03-attributes-sidebar.png" width="280" height="240" alt="Attributes sidebar" /></a><br />
      <sub><strong>Attributes sidebar:</strong> Edit labels, relations, and attachments inline.</sub>
    </td>
    <td align="center" valign="bottom" style="border: none;">
      <a href="media/screenshots/04-search-quickpick.png"><img src="media/screenshots/04-search-quickpick.png" width="280" height="240" alt="Search QuickPick" /></a><br />
      <sub><strong>Search:</strong> Jump to notes quickly with live results.</sub>
    </td>
  </tr>
  <tr>
    <td align="center" valign="bottom" style="border: none;">
      <a href="media/screenshots/05-revisions-and-diff.png"><img src="media/screenshots/05-revisions-and-diff.png" width="280" height="240" alt="Revisions and diff" /></a><br />
      <sub><strong>Revisions and diff:</strong> Open previous revisions and compare changes safely.</sub>
    </td>
    <td align="center" valign="bottom" style="border: none;"></td>
  </tr>
</table>
<!-- markdownlint-enable MD033 -->

## Requirements

- VS Code 1.116 or later
- Desktop VS Code (not web/Codespaces)
- A reachable Trilium Notes server with ETAPI enabled

## Community and Feedback

Issues, bug reports, and feature ideas are welcome in this repository. If something feels clunky in daily use, open an issue and describe your workflow.

## License

GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).
