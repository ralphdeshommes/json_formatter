# JSON Viewer with Path Navigator

A single-page JSON viewer built to make messy, deeply nested JSON actually easy to read. Paste in JSON and get an interactive tree — click any key or value to see exactly where it lives, its type, and its value.

## Features

- Live parsing as you type (debounced)
- Auto-fixes common paste issues: trailing commas, missing closing `}`/`]`
- Collapsible tree view, with expand-all / collapse-all
- Click any key or value to see its breadcrumb path, type, depth, and size
- One-click copy of the current path
- Quick stats: total keys, max depth, object count, array count
- "Load Sample" button to try it out instantly

## Usage

No install, no build step — just open [index.html](index.html) in a browser.

1. Paste JSON into the left panel (or click **Load Sample**)
2. Browse the generated tree in the middle panel
3. Click any key or value to inspect its path, type, and value in the right panel

## Tech

Plain HTML, CSS, and vanilla JavaScript in a single file. No frameworks or build tooling.

## Ideas / Not Yet Built

- Multi-tab side panel: clicking a key opens a new tab for that branch, so multiple parts of the JSON can be compared side-by-side without losing your place in the tree
