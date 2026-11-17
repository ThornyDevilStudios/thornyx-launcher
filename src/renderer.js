const $ = (id) => document.getElementById(id);
let games = [];
let view = "all";
let busy = new Set();

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function formatSize(bytes) {
  if (!bytes) return "";
  return bytes > 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(1) + " GB" : Math.round(bytes / 1024 ** 2) + " MB";
}
function gameCard(g) {
  const installed = g.installed;
  const update = g.updateAvailable;
  const action = busy.has(g.id) ? "Bitte warten …" : !installed ? "Installieren" : update ? "Update verfügbar" : "Spielen";
  const date = g.publishedAt ? new Date(g.publishedAt).toLocaleDateString("de-DE") : "";
  const error = g.error ? `<small class="error">${escapeHtml(g.error)}</small>` : "";
  return `<article class="game-card">
    <div class="game-art"><div class="game-initial">${escapeHtml(g.name.slice(0,1).toUpperCase())}</div></div>
    <div class="game-body">
      <div class="game-meta"><span>${escapeHtml(g.developer || "INDIE GAME")}</span><span>${installed ? "● INSTALLIERT" : "○ NICHT INSTALLIERT"}</span></div>
      <h3 class="game-title">${escapeHtml(g.name)}</h3>
      <p class="game-desc">${escapeHtml(g.description || "Ein Indie-Spiel aus der Community.")}</p>
      <div class="release"><strong>${escapeHtml(g.version || "Release nicht verfügbar")}</strong><small>${date ? "Veröffentlicht: " + date : ""} ${g.assetSize ? "· " + formatSize(g.assetSize) : ""}</small>
      <p class="release-notes">${escapeHtml(g.body || g.error || "Noch keine Release-Informationen.")}</p></div>
      ${error}
      <div class="card-actions">
        <button class="primary" data-action="main" data-id="${escapeHtml(g.id)}" ${busy.has(g.id) || !g.assetUrl && !installed ? "disabled" : ""}>${action}</button>
        ${installed ? `<button class="secondary" data-action="uninstall" data-id="${escapeHtml(g.id)}" title="Deinstallieren">⌫</button>` : ""}
        ${g.mods && installed ? `<button class="secondary" data-action="mods" data-id="${escapeHtml(g.id)}" title="Mod-Ordner öffnen">MOD</button>` : ""}
        <button class="secondary" data-action="notes" data-id="${escapeHtml(g.id)}" title="Release-Seite öffnen">↗</button>
      </div>
    </div></article>`;
}
function render() {
  const query = $("search").value.trim().toLowerCase();
  const visible = games.filter(g => (view !== "installed" || g.installed) && (!query || (g.name + " " + g.description).toLowerCase().includes(query)));
  $("games").innerHTML = visible.length ? visible.map(gameCard).join("") : "";
  $("empty").classList.toggle("hidden", visible.length > 0);
  $("game-count").textContent = games.length;
  $("section-title").innerHTML = (view === "installed" ? "Installierte Spiele " : "Alle Spiele ") + `<span>${visible.length} angezeigt</span>`;
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
    $("games").innerHTML = `<div class="loading error">${escapeHtml(error.message)}</div>`;
  }
}
async function perform(id, action) {
  if (busy.has(id)) return;
  const g = games.find(x => x.id === id);
  if (!g) return;
  try {
    if (action === "main") {
      if (g.installed && !g.updateAvailable) await window.launcher.launchGame(id);
      else {
        busy.add(id); render();
        $("status").textContent = "Download läuft …";
        await window.launcher.installGame(id);
        $("status").textContent = g.name + " wurde installiert.";
        await refresh();
      }
    } else if (action === "uninstall") {
      if (confirm(g.name + " wirklich deinstallieren?")) {
        await window.launcher.uninstallGame(id); await refresh();
      }
    } else if (action === "mods") await window.launcher.openMods(id);
    else if (action === "notes" && g.htmlUrl) await window.launcher.openExternal(g.htmlUrl);
  } catch (error) {
    $("status").textContent = error.message;
    alert(error.message);
  } finally { busy.delete(id); render(); }
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
$("close-modal").onclick = () => $("add-modal").classList.add("hidden");
$("add-modal").addEventListener("click", e => { if (e.target.id === "add-modal") $("add-modal").classList.add("hidden"); });
$("add-form").addEventListener("submit", async e => {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  const game = Object.fromEntries(data.entries());
  game.mods = data.has("mods");
  try {
    await window.launcher.addGame(game);
    e.currentTarget.reset();
    $("add-modal").classList.add("hidden");
    await refresh();
  } catch (error) { alert(error.message); }
});
window.launcher.onProgress(data => {
  const amount = data.total ? `${data.percent}%` : formatSize(data.received);
  $("status").textContent = "Download: " + amount;
});
window.launcher.onStatus(data => { $("status").textContent = data.message; });
refresh();
