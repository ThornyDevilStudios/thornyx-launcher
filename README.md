# Thornyx Launcher

A customizable Windows desktop game launcher built with Electron. The original project was created by **ThornyDevil Studios**.

> Forks may customize the product branding and game catalog. Redistributed builds must retain the separate in-app attribution notice required by [LICENSE.md](LICENSE.md).

## Features

- Reads each game's latest GitHub Release and displays version, date, download size and release notes.
- Installs ZIP builds, remembers the installed release tag and detects newer versions.
- Downloads and installs updates without requiring users to reinstall the launcher.
- Starts the configured game executable and supports optional Mods folders.
- Lets users add public GitHub release repositories from the launcher UI.
- Supports fork-specific branding, catalog, app ID and launcher update repository.
- Checks for launcher updates only when an update repository is configured.

## Configure your fork

Edit **launcher.config.json** before building:

| Setting | Purpose |
| --- | --- |
| `branding.name` | Product name shown in the app and installer |
| `branding.shortName` | Compact sidebar brand |
| `branding.subtitle` | Text under the brand |
| `branding.tagline`, `branding.description` | Hero copy |
| `branding.developerLabel` | Small heading in the top bar |
| `branding.website` | Website/store link in the sidebar |
| `branding.logo` | Optional local/remote image path or URL supported by the UI |
| `branding.accentColor`, `branding.backgroundColor` | Hex colors, e.g. `#c5f36b` |
| `appId` | Unique reverse-domain application ID for your fork |
| `updateRepository` | Your own GitHub repository in `owner/repo` form; set to an empty string to disable self-updates |
| `catalogFile` | JSON game catalog file, normally `catalog.json` |

Also edit `catalog.json` to replace the default ThornyDevil games with your own. The build reads the same configuration for the installer identity and the GitHub update feed. Never leave `updateRepository` pointing to the original project in a fork, or your fork could receive the original launcher's updates.

The original creator attribution is intentionally separate from all configurable branding. Do not remove or obscure it. See [LICENSE.md](LICENSE.md).

## Development

Requires Node.js 20+.

```bash
npm install
npm test
npm start
```

Build a Windows installer locally without publishing:

```bash
npm run dist
```

Publish a tagged release from your configured update repository:

```bash
npm run publish
```

The release workflow uses `GH_TOKEN`/GitHub Actions permissions to publish artifacts. The normal CI build uses `--publish never` and does not require a release token.

## Adding a game

Use **Spiel hinzufügen** in the launcher or edit `catalog.json`. Each entry needs:

- `id`: unique lowercase ID with hyphens
- `name`: display name
- `repository`: public GitHub release repository in `owner/repo` form
- `assetPattern`: unique part of the release asset filename
- `executable`: path to the game's EXE relative to the extracted install folder
- `channel`: `stable` or `prerelease`
- `mods`: whether to show the Mods folder action

Release version, date and changelog are read automatically from GitHub. Release assets should be complete game packages (usually ZIP files containing the EXE and all required data files).

Custom entries are stored locally in the current Windows user's application-data directory.

## Distribution and source privacy

Keep development/source repositories private if you do not want their source exposed. GitHub automatically exposes source-code ZIP/tar archives for public repositories, even when a release contains only binary assets. Publish finished builds to clean public distribution repositories if source privacy matters.

The three game repositories currently referenced by the default `catalog.json` are public. Review their visibility and release assets before distributing this launcher.

## License

This project is distributed under the custom attribution terms in [LICENSE.md](LICENSE.md). It is **not MIT licensed** and is not an OSI-approved open-source license. The terms require preservation of creator notices and a visible in-app attribution for redistributed applications. Seek legal review before relying on these terms for a commercial release.
