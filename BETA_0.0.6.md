# Thornyx Launcher beta_0.0.6

This beta is a major expansion of Thornyx Launcher into a customizable, cross-platform desktop game launcher.

## New features

### Adaptive game library
- Three library layouts: compact sidebar, medium grid/list, and large discovery-style library.
- Automatic layout selection, switching to the large library at 30 games by default.
- Developer-configurable layout mode and threshold.
- Search, genre/developer filters, sorting, and a dedicated installed-games list.
- Game detail pages with release information, descriptions, artwork, and screenshot galleries.

### Game installation and management
- Install games from GitHub Releases.
- Download queue with progress, pause, resume, and cancel.
- Resume partial downloads when the server supports HTTP range requests.
- Verify downloaded archive SHA-256 digests when GitHub provides them.
- Launch, update, uninstall, repair/reinstall, and verify installed games.
- Configurable game installation directory, including migration of existing installations.
- Per-platform release asset and executable configuration for Windows, Linux, and macOS.

### Game metadata and mods
- Read optional game metadata from `thornyx-game.json`, `game.json`, or `metadata.json`.
- Discover local cover and banner artwork in installed game folders.
- Optional per-file SHA-256 checksums for installation verification.
- Local ZIP mod manager for supported games.

### Launcher customization and settings
- Configurable launcher branding, colors, catalog, app ID, and update repository for developers and forks.
- Manual confirmation before downloading and installing launcher updates.
- Desktop notifications, startup preferences, and diagnostic logs.
- German/English language selection.
- Optional external community destination.

### Desktop platforms
- Windows installer (NSIS).
- Linux AppImage and DEB packages.
- macOS DMG and ZIP packages.

## Validation
- Unit tests passed.
- JavaScript and builder configuration syntax checks passed.
- Windows, Linux, and macOS installer builds passed in CI.
- Static renderer/HTML ID consistency check passed.

## Known limitations
- This is a beta, not a stable release. Please report issues and back up important game saves before testing.
- Cloud saves are not included in this beta.
- Community support currently opens a configured external destination; there is no integrated community feed or account system.
- A game's availability depends on its publisher providing a compatible build for the user's operating system. A cross-platform launcher cannot make a Windows-only game run natively on Linux or macOS.
- The app has not yet undergone full hands-on testing with every real game release and operating system.
- Windows code signing and macOS notarization are not configured and require publisher certificates.
- Mobile platforms are not supported.

Based on Thornyx Launcher, originally created by ThornyDevil Studios.
