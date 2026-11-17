# Thornyx Launcher

A configurable Windows desktop launcher for ThornyDevil Studios and other indie developers. Built with Electron.

## Features

- Reads each game's latest GitHub Release and displays version, date, download size and release notes.
- Installs ZIP builds, remembers the installed release tag and detects newer versions.
- Downloads and installs updates without requiring users to reinstall the launcher.
- Starts the configured game executable.
- Opens a game's `Mods` folder when mod support is enabled.
- Lets users add additional public GitHub release repositories from the launcher UI.
- Checks for launcher updates through GitHub Releases using `electron-updater`.

## Development

Requires Node.js 20+.

```bash
npm install
npm start
```

Build the Windows installer on Windows:

```bash
npm run dist
```

Push a version tag such as `v1.0.1` to trigger the GitHub Actions workflow. It builds and publishes the Windows installer and updater metadata to this repository's Releases.

## Adding a game

Use **Spiel hinzufügen** in the launcher or edit `catalog.json`. Each entry needs:

- `id`: unique lowercase ID with hyphens
- `name`: display name
- `repository`: public GitHub release repository in `owner/repo` form
- `assetPattern`: unique part of the release asset filename
- `executable`: path to the game's EXE relative to the extracted install folder
- `channel`: `stable` or `prerelease`
- `mods`: whether to show the Mods folder action

Release version, date and changelog are read automatically from GitHub. Release assets should be complete game packages (usually ZIP files containing the EXE and all required data files). A lone EXE is only sufficient when the game is genuinely self-contained.

Custom entries added in the app are stored locally in the current Windows user's application-data directory.

## Source-code privacy — important

Keep development/source repositories **private**. Publish finished builds to separate **public distribution repositories** that contain no source files. GitHub automatically exposes source-code ZIP/tar archives for public repositories, even when a release contains only binary assets.

The three existing game repositories currently referenced by `catalog.json` are public. Move release assets to clean public distribution repositories and update their `repository` values before considering source-code privacy complete. This project does not change repository visibility automatically.

## Current scope

The first version targets Windows game builds and GitHub Releases. itch.io links are supported as external store links; itch.io distribution/install integration can be added separately.
