<img width="961" height="962" alt="2026-05-17 - 12_38_30 - noteX v1 6" src="https://github.com/user-attachments/assets/3f9dded7-9d3d-45f1-ab92-6e084f29b2b5" />

# noteX v1.0

**noteX** is a local-first, web-based note-taking app inspired by Notion. It is designed for organizing notes, pages, workspaces, code snippets, tables, and personal knowledge in a clean and lightweight interface.

This first public release focuses on a stable note-taking experience with authentication, internal workspaces, backup/restore, and a block-based editor.

<img width="961" height="962" alt="2026-05-17 - 12_37_37 - noteX v1 6" src="https://github.com/user-attachments/assets/8b3ac41f-0df5-4b3f-838e-7235cb3529d7" />

## Description

noteX is built as a modern productivity and note-taking application for users who want a simple but structured workspace for writing, organizing, and managing notes.

It supports both Google login and local password-based access. Notes are stored locally in the browser using IndexedDB, making the app local-first and usable without a backend server. Each user can manage separate internal workspaces such as Personal, Work, and Business.

## Features

<img width="312" height="411" alt="image" src="https://github.com/user-attachments/assets/e6882dc8-b7a0-41b6-b675-75b623e75f9b" />


### Authentication

- Google SSO login for identity.
- Local user mode with password-based unlock.
- Separate local and Google user data.
- Account Center for switching between users.
- Account Settings for display name and profile picture.

<img width="455" height="393" alt="image" src="https://github.com/user-attachments/assets/44a5178d-d927-434e-a7c1-9734e118392e" />


### Workspaces

- Up to 3 internal noteX workspaces per account.
- Default workspaces: Personal, Work, and Business.
- Create, rename, delete, and switch workspaces.
- Workspace data is separated by account.

### Notes and Editor

- Block-based page editor.
- Page title, page tags, created date, and updated date metadata.
- Text, headings, quotes, command blocks, code blocks, tables, lists, and media blocks.
- Slash command menu for creating blocks.
- Editor font options: Default, Serif, and Mono.
- Code, command, and quote blocks preserve their own font style.

### Code Blocks

- Code block menu actions.
- Copy code with confirmation.
- Code language selector.
- Syntax highlighting support for common languages such as CSS, Python, PHP, Perl, Ruby, Go, C, C++, YAML, SQL, shell, logs, and config-like formats.

<img width="627" height="277" alt="image" src="https://github.com/user-attachments/assets/4573d4af-589c-4457-a9a2-ec52f885545a" />


### Tables

- Table block support.
- Header-row behavior.
- Row and column actions.
- Basic table editing and formatting improvements.

### Sidebar and Navigation

- Compact sidebar with Recents, Favorites, Private, Others, Library, and Trash.
- Collapsible sidebar.
- Tab strip for open pages.
- Back/Forward tab navigation.
- Workspace and account menu.

### Backup and Restore

- Export backup JSON.
- Restore from backup JSON.
- Local snapshots.
- Snapshot history modal.
- Backup data includes users, workspaces, pages, blocks, and settings.

### Local-First Storage

- Data is stored in browser IndexedDB.
- Signing out does not delete local data.
- Backup is recommended before moving to another device or browser.

<img width="774" height="632" alt="image" src="https://github.com/user-attachments/assets/d1457221-85aa-49e9-a72a-663cf2f10766" />


## Requirements

- Node.js 18 or newer recommended.
- npm.
- Modern browser such as Chrome, Edge, or Firefox.
- Google OAuth Client ID is required only if using Google login.

## Installation

1. Extract the release package.

```bash
unzip noteX-v1.0.zip
cd noteX-v1.0
```

2. Install dependencies.

```bash
npm install
```

3. Create `.env` file in the project root if you want to enable Google login.

```env
VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

The `.env` file must be placed in the same directory as `package.json`.

4. Run the development server.

```bash
npm run dev
```

5. Open the URL shown by Vite, usually:

```text
http://localhost:5173
```

## Google OAuth Setup

To use Google login:

1. Open Google Cloud Console.
2. Create or select a project.
3. Go to **APIs & Services → Credentials**.
4. Create an **OAuth Client ID** with application type **Web application**.
5. Add this authorized JavaScript origin for local development:

```text
http://localhost:5173
```

6. Copy the Client ID into `.env`:

```env
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

7. Restart the dev server.

```bash
npm run dev
```

## Backup and Migration

The application code and user data are separate.

- The ZIP package contains the app code.
- Notes and workspace data are stored in browser IndexedDB.
- Use **Backup & Restore** to export a JSON backup before moving to another desktop or browser.

Recommended migration files:

```text
noteX-v1.0.zip
notex-backup-YYYYMMDD.json
```

On the new desktop, install and run noteX, then restore the backup JSON.

## Build

To create a production build:

```bash
npm run build
```

For release packaging, exclude:

```text
node_modules/
.vite/
*.log
.DS_Store
.cache/
tmp/
```

Recommended release contents:

```text
README.md
index.html
package.json
package-lock.json
public/
src/
tsconfig.json
vite.config.ts
dist/
```

## Credits

Created by **NixNux**.

```text
noteX | copyright © 2026 by NixNux
```

