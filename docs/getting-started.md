# Getting Started

This extension lets you browse, search, and edit your Trilium Notes directly from VS Code via ETAPI.

If you already use Trilium every day, this gives you a smoother flow without switching apps.

## Requirements

- VS Code **1.116** or later.
- Desktop VS Code only. Web extensions and Codespaces are not supported.
- A running **Trilium Notes** server reachable from your machine.
- An **ETAPI token** generated in Trilium: `Options -> ETAPI -> Create new ETAPI token`.

## Quick Start

1. Install the extension.
2. Open the **Trilium Notes** panel in the Activity Bar.
3. Click the **connect** icon or run **Trilium: Connect to Trilium Server** from the Command Palette.
4. Enter your server URL, for example `http://localhost:8080`, and your ETAPI token.
5. Browse the tree and open any note to start editing.

## Notes

- The ETAPI token is stored securely in VS Code's `SecretStorage` and is not written to your settings files.
- Text notes open in the built-in CKEditor webview, while code and other note types open in the most appropriate editor available.

## First-Time Troubleshooting

- Connection fails: check server URL, ETAPI token, and whether Trilium is reachable from your machine.
- Tree is empty: verify your root note setting and that the configured root exists.
- Note type opens as plain text: check whether an optional companion extension is needed for that note type.

## More Documentation

- [Features](features.md)
- [Reference](reference.md)
- [Automation](automation.md)
- [Roadmap](roadmap.md)
- [Credits](credits.md)
