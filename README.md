# Wikilink Peek

Wikilink Peek is an Obsidian plugin that opens wikilinks in a centred, Notion-style peek panel instead of navigating away from the note you're reading. Click a link, read or edit the linked note in a floating panel over a dimmed backdrop, then close it and carry on exactly where you were.

## Features

- **Peek on click:** clicking a wikilink opens the note in a centred panel. It works in reading view, Live Preview, hover popovers, properties and base/table views.
- **Properties table:** the note's frontmatter is shown under the title. Tags and link values appear as chips, and links inside them are clickable.
- **In-panel navigation:** links inside the peek open in the same panel, and the back arrow steps back through them. Heading links such as `[[Note#Heading]]` scroll to that heading.
- **Live Preview editing:** the edit button swaps the preview for a real Live Preview editor, so you can change the note without leaving the panel. Changes autosave. If the embedded editor can't load, it falls back to a plain-text editor.
- **Toolbar:** back, edit/preview, open in a new tab, open to the right, and close.
- **Easy to dismiss:** press Esc or click outside the panel to close it.

## Installation

1. Create a folder at `<your vault>/.obsidian/plugins/wikilink-peek/`.
2. Copy `main.js`, `manifest.json` and `styles.css` into it.
3. In Obsidian, go to Settings → Community plugins, refresh the list, and enable **Wikilink Peek**.

There is no build step; the plugin is plain JavaScript.

## Usage

- **Click** a wikilink to open it in the peek panel.
- **Ctrl/Cmd + click** still opens the link in a new tab, as Obsidian normally does. Shift and Alt + click also keep their default behaviour.
- **Ctrl/Cmd + click inside the peek** opens that note in a full tab and closes the panel.
- Unresolved links and non-markdown files (images, PDFs) are left to Obsidian's default handling.
- The command palette has a **Close peek panel** command.

## Settings

| Setting | Description |
| --- | --- |
| Open peek on | Choose plain click (default) or Alt + click as the trigger. |
| Panel width | Set the panel width from 600 to 1400 px. |
| Show properties | Show or hide the frontmatter table under the title. |
| Close when clicking outside | Turn closing on backdrop click on or off. |

## Notes

The Live Preview editor relies on Obsidian internals that are not part of the official plugin API, so it may need adjusting after major Obsidian updates. If the editor fails to embed, check the developer console for a "Wikilink Peek" message.
