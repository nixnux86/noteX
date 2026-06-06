# noteX v1.6.79

noteX is a local-first Notion/AFFiNE-inspired web workspace. It stores notes, blocks, pages, database properties, rows, settings, and snapshots in browser IndexedDB using Dexie.js.


## What's new in v1.6.38

- Press Esc to close sidebar page option menus, section menus, and the Move To modal.
- Added section menu controls for Sort, Show, Move up, Move down, Hide section, and Customize sidebar.
- Added + button on sidebar section headers for quick page creation.
- Replaced the old Move To prompt with an interactive Notion-like move modal.
- Added manual drag-and-drop movement in the Organize page tree.
- Page title adjusted to 48px and 500 font weight.
- Code block font size reduced.
- Added dashed separator above the hint area.

## Previous v1.6.x features

- Sidebar redesigned into Recents, Favorites, Organize, and Others
- Recents automatically shows the last 5 opened/updated notes
- Favorites section shows notes marked with the Favorite button
- Organize contains the expandable/collapsible nested page tree
- Others contains Canvas Ideas, Project Database, and Research Notes
- Sidebar can be manually resized by dragging the right edge
- Sidebar icons changed to simpler outline icons
- Nested page tree with subpages
- Expand/collapse sidebar groups
- Add subpage from the sidebar
- Breadcrumb based on page hierarchy
- Block actions: add, move up, move down, duplicate, delete, and convert
- Slash command menu by typing `/`
- Editable database properties
- Database views: Table, Board/Kanban, and Gallery
- Command palette with `Ctrl+K` or `Cmd+K`
- Local snapshots with restore option
- JSON export and restore
- Google/Microsoft cloud sync placeholder UI

## Requirements

- Node.js 20+ recommended
- npm
- Modern Chromium/Firefox/Edge browser

## Install

```bash
unzip noteX-v1.6.38.zip
cd noteX-v1.6.38
npm install
```

## Run HTTP

Port 6000 is blocked by many browsers. noteX uses port 6001 for HTTP.

```bash
npm run dev
```

Open:

```text
http://localhost:6001/
```

For a VM/server:

```text
http://YOUR_SERVER_IP:6001/
```

Example:

```text
http://192.168.56.56:6001/
```

## Run HTTPS

```bash
npm run dev:https
```

Open:

```text
https://localhost:6002/
```

The certificate is self-signed, so the browser may show a warning. Choose Advanced / Proceed for local testing.

## Firewall

```bash
sudo ufw allow 6001/tcp
sudo ufw allow 6002/tcp
```

## Build for production

```bash
npm run build
npm run preview
```

Preview runs on:

```text
http://localhost:8080/
```

## Reset local data

If you previously opened an older version, clear IndexedDB once:

```text
Browser DevTools → Application → IndexedDB → noteX-v1.6 → Delete database
```

Then refresh.

## Notes

Cloud sync is still a UI stub in this version. Real Google Drive/OneDrive OAuth and backup upload should be implemented in v2.0 after local editor, database, and snapshot flows are stable.


## v1.6.1 UI fixes

- Simplified block hover palette to Notion-like Add and Drag controls only.
- Removed duplicate command-palette entry from the sidebar. Use Ctrl+K / Cmd+K instead.
- Refined main canvas, toolbar, sidebar, and command palette styling.


## v1.6.38 changes

- Removed the empty Favorite placeholder from the sidebar.
- Refined the tab bar: centered titles, 400 font weight, no active bottom line, plus button for creating a new page, and dashed divider.
- Added real rich-text editing with contenteditable blocks, so Bold, Italic, Underline, Strike, Link, and inline formatting render visually instead of showing Markdown markers.
- Fixed slash command block conversion for Heading 1 through Heading 4 so each heading renders with its proper font size.

## v1.6.38 changes

- Reverted the window tabs background to the previous light style.
- Added breadcrumb hover dropdowns for pages that have subpages.
- Breadcrumb items now use compact text and ellipsis for long page names.
- Fixed long page titles so they expand/wrap cleanly without cutting content.


## v1.6.38 changes

- Added dashed window tab separator while masking the active tab line.
- Improved long page title resizing/wrapping.
- Added vertical scroll to the slash command menu.
- Library now opens as a tab and supports Recents, Favorites, Shared, Private, and AI Meeting Notes filters.



## noteX v1.6.79 additions

- Chrome-like pinned window tabs via right-click on a tab.
- Tab context menu supports Pin/Unpin, Close tab, Close other tabs, and Close tabs to the right.
- Pinned tabs stay on the left side and are persisted locally.
- Page tags row now includes quick export actions for PDF and DOCX.
- PDF export opens a browser print/save-as-PDF window.
- DOCX export creates a lightweight Word-compatible `.docx` document from the current page content.


## noteX v1.6.79 additions
- Smaller PDF/DOCX export actions plus Copy all editor content.
- More compact command block.
- Improved table action popover positioning, hover delete control, gray borders, and cell selection.
- Numbered-list reset/continue controls in the format toolbar turn-to menu.
- HPE Technical Case Summary template uses compact 11px email-friendly content with gray dummy entries.


## noteX v1.6.79 additions
- Fixed tab context menu positioning near the clicked tab.
- Added richer editor copy to clipboard with modal feedback.
- Added text and background color controls in the format toolbar.
- Added modern link insertion modal and page-link insertion support.
- Added selected-block copy workflow and improved image resize styling.
- Library table defaults to collapsed tree-style view.


## noteX v1.6.79 additions

- Moved the code-block hover toolbar to the right side of the code block.
- Fixed the Turn to menu layout so items no longer overlap.
- Code More and Language popovers close on Esc or outside click.
- Expanded the code language list with common programming/config languages.
- Added a nested Turn into submenu inside the code More menu.
- Kept code-copy behavior using Clipboard API with fallback.
- Kept editor Undo/Redo shortcuts: Ctrl/Cmd+Z and Ctrl/Cmd+R.
