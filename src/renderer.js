const $ = id => document.getElementById(id);
let games = [];
let view = "all";
let busy = new Set();
let launcherConfig = {};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}
function formatSize(bytes) {
  if (!bytes) return "";
  return bytes > 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(1) + " GB" : Math.round(bytes / 1024 ** 2) + " MB";
}
function applyBranding() {
  const branding = launcherConfig.branding || {};
  const name = branding.name || "Indie Game Launcher";
  const shortName = branding.shortName || name.toUpperCase();
  document.title = name;
  $("brand-name").textContent = shortName;
  $("brand-subtitle").textContent = branding.subtitle || "GAME LAUNCHER";
  $("brand-mark").textContent = shortName.slice(0, 1).toUpperCase();
  $("page-eyebrow").textContent = branding.developerLabel || "GAME LIBRARY";
  $("hero-tagline").textContent = branding.tagline || "Deine Spiele. Dein Abenteuer.";
  $("hero-description").textContent = branding.description || "Installieren, aktuell halten und direkt losspielen.";
  $("itch-link").textContent = (branding.shortName || name) + " Website ↗";
  $("itch-link").href = "#";
  $("itch-link").onclick = event => {
    event.preventDefault();
    const website = branding.website;
    if (website) window.launcher.openExternal(website);
  };
  $("version").textContent = name.toUpperCase() + " · " + (launcherConfig.version || "");
  const accent = branding.accentColor || "#c5f36b";
  const background = branding.backgroundColor || "#0b0d12";
  if (/^#[0-9a-f]{6}$/i.test(accent)) document.documentElement.style.setProperty("--accent", accent);
  if (/^#[0-9a-f]{6}$/i.test(background)) document.documentElement.style.setProperty("--bg", background);
  if (branding.logo) {
    $("brand-mark").textContent = "";
    $("brand-mark").style.backgroundImage = "url('" + String(branding.logo).replace(/['"\\]/g, "") + "')";
    $("brand-mark").style.backgroundSize = "contain";
    $("brand-mark").style.backgroundPosition = "center";
    $("brand-mark").style.backgroundRepeat = "no-repeat";
  }
  const provenance = launcherConfig.provenance || {};
  $("about-content").innerHTML =
    "<p><strong>" + escapeHtml(provenance.notice || "Based on Thornyx Launcher, originally created by ThornyDevil Studios.") + "</strong></p>" +
    "<p>Originalprojekt: <a href='#' id='original-repo-link'>ThornyDevil Studios / thornyx-launcher</a></p>" +
    "<p>Dein Launcher kann eigenes Branding und eigene Spiele verwenden. Dieser Herkunftshinweis bleibt davon getrennt.</p>";
  $("original-repo-link").onclick = event => {
    event.preventDefault();
    window.launcher.openExternal(provenance.repository || "https://github.com/ThornyDevilStudios/thornyx-launcher");
  };
}
function gameCard(game) {
  const installed = game.installed;
  const update = game.updateAvailable;
  const action = busy.has(game.id) ? "Bitte warten …" : !installed ? "Installieren" : update ? "Update verfügbar" : "Spielen";
  const date = game.publishedAt ? new Date(game.publishedAt).toLocaleDateString("de-DE") : "";
  const error = game.error ? '<small class="error">' + escapeHtml(game.error) + "</small>" : "";
  return `<article class="game-card">
    <div class="game-art"><div class="game-initial">${escapeHtml(game.name.slice(0, 1).toUpperCase())}</div></div>
    <div class="game-body">
      <div class="game-meta"><span>${escapeHtml(game.developer || "INDIE GAME")}</span><span>${installed ? "● INSTALLIERT" : "○ NICHT INSTALLIERT"}</span></div>
      <h3 class="game-title">${escapeHtml(game.name)}</h3>
      <p class="game-desc">${escapeHtml(game.description || "Ein Indie-Spiel aus der Bibliothek.")}</p>
      <div class="release"><strong>${escapeHtml(game.version || "Release nicht verfügbar")}</strong><small>${date ? "Veröffentlicht: " + date : ""} ${game.assetSize ? "· " + formatSize(game.assetSize) : ""}</small>
      <p class="release-notes">${escapeHtml(game.body || game.error || "Noch keine Release-Informationen.")}</p></div>
      ${error}
      <div class="card-actions">
        <button class="primary" data-action="main" data-id="${escapeHtml(game.id)}" ${busy.has(game.id) || !game.assetUrl && !installed ? "disabled" : ""}>${action}</button>
        ${installed ? `<button class="secondary" data-action="uninstall" data-id="${escapeHtml(game.id)}" title="Deinstallieren">⌫</button>` : ""}
        ${game.mods && installed ? `<button class="secondary" data-action="mods" data-id="${escapeHtml(game.id)}" title="Mod-Ordner öffnen">MOD</button>` : ""}
        <button class="secondary" data-action="notes" data-id="${escapeHtml(game.id)}" title="Release-Seite öffnen">↗</button>
        ${game.itchUrl ? `<button class="secondary" data-action="store" data-id="${escapeHtml(game.id)}" title="Store-Seite öffnen">STORE</button>` : ""}
      </div>
    </div></article>`;
}
function render() {
  const query = $("search").value.trim().toLowerCase();
  const visible = games.filter(game =>
    (view !== "installed" || game.installed) &&
    (!query || (game.name + " " + game.description).toLowerCase().includes(query))
  );
  $("games").innerHTML = visible.length ? visible.map(gameCard).join("") : "";
  $("empty").classList.toggle("hidden", visible.length > 0);
  $("game-count").textContent = games.length;
  $("section-title").innerHTML = (view === "installed" ? "Installierte Spiele " : "Alle Spiele ") +
    "<span>" + visible.length + " angezeigt</span>";
}
async function refresh() {
  $("status").textContent = "Prüfe GitHub-Releases …";
  try {
    games = await window.launcher.checkUpdates();
    $("connection-label").textContent = "Mit GitHub verbunden";
    $("status").textContent = "Bibliothek aktualisiert.";
    render();
  } catch (error) {
    $("status").textContent = error.message;
    $("games").innerHTML = '<div class="loading error">' + escapeHtml(error.message) + "</div>";
  }
}
async function perform(id, action) {
  if (busy.has(id)) return;
  const game = games.find(item => item.id === id);
  if (!game) return;
  try {
    if (action === "main") {
      if (game.installed && !game.updateAvailable) await window.launcher.launchGame(id);
      else {
        busy.add(id);
        render();
        $("status").textContent = "Download läuft …";
        await window.launcher.installGame(id);
        $("status").textContent = game.name + " wurde installiert.";
        await refresh();
      }
    } else if (action === "uninstall") {
      if (confirm(game.name + " wirklich deinstallieren?")) {
        await window.launcher.uninstallGame(id);
        await refresh();
      }
    } else if (action === "mods") await window.launcher.openMods(id);
    else if (action === "notes" && game.htmlUrl) await window.launcher.openExternal(game.htmlUrl);
    else if (action === "store" && game.itchUrl) await window.launcher.openExternal(game.itchUrl);
  } catch (error) {
    $("status").textContent = error.message;
    alert(error.message);
  } finally {
    busy.delete(id);
    render();
  }
}
$("games").addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (button) perform(button.dataset.id, button.dataset.action);
});
$("search").addEventListener("input", render);
function setView(next) {
  view = next;
  $("nav-library").classList.toggle("active", next === "all");
  $("nav-installed").classList.toggle("active", next === "installed");
  $("page-title").textContent = next === "installed" ? "Installierte Spiele" : "Deine Spiele";
  render();
}
$("nav-library").onclick = () => setView("all");
$("nav-installed").onclick = () => setView("installed");
$("nav-refresh").onclick = $("refresh-top").onclick = () => refresh();
$("nav-add").onclick = () => $("add-modal").classList.remove("hidden");
$("nav-about").onclick = () => $("about-modal").classList.remove("hidden");
$("close-modal").onclick = () => $("add-modal").classList.add("hidden");
$("close-about").onclick = () => $("about-modal").classList.add("hidden");
$("add-modal").addEventListener("click", event => {
  if (event.target.id === "add-modal") $("add-modal").classList.add("hidden");
});
$("about-modal").addEventListener("click", event => {
  if (event.target.id === "about-modal") $("about-modal").classList.add("hidden");
});
$("add-form").addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const game = Object.fromEntries(data.entries());
  game.mods = data.has("mods");
  try {
    await window.launcher.addGame(game);
    event.currentTarget.reset();
    $("add-modal").classList.add("hidden");
    await refresh();
  } catch (error) { alert(error.message); }
});
window.launcher.onProgress(data => {
  const amount = data.total ? data.percent + "%" : formatSize(data.received);
  $("status").textContent = "Download: " + amount;
});
window.launcher.onStatus(data => { $("status").textContent = data.message; });

(async function init() {
  try {
    launcherConfig = await window.launcher.getConfig();
    applyBranding();
    await refresh();
  } catch (error) {
    $("status").textContent = "Konfiguration konnte nicht geladen werden: " + error.message;
  }
})();
