const $ = id => document.getElementById(id);
let games = [], view = "all", busy = new Set(), launcherConfig = {}, layout = "medium", displayMode = "grid";
const prefs = () => { try { return JSON.parse(localStorage.getItem("thornyx-preferences") || "{}"); } catch { return {}; } };
function savePrefs(value) { localStorage.setItem("thornyx-preferences", JSON.stringify(value)); }
function esc(value="") { return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function formatSize(n) { return !n ? "" : n > 1024**3 ? (n/1024**3).toFixed(1)+" GB" : Math.round(n/1024**2)+" MB"; }
function applyTheme() {
  const b = launcherConfig.branding || {}, p = prefs();
  const vals = {accent:p.accent||b.accentColor||"#c5f36b", background:p.background||b.backgroundColor||"#0b0d12", panel:p.panel||b.panelColor||"#121620", text:p.text||b.textColor||"#f1f3f7"};
  const vars={accent:"--accent",background:"--bg",panel:"--panel",text:"--text"}; for (const [k,v] of Object.entries(vals)) if (/^#[0-9a-f]{6}$/i.test(v)) document.documentElement.style.setProperty(vars[k],v);
}
function applyBranding() {
  const b=launcherConfig.branding||{}, name=b.name||"Thornyx Launcher", short=b.shortName||name.toUpperCase();
  document.title=name; $("brand-name").textContent=short; $("brand-subtitle").textContent=b.subtitle||"GAME LAUNCHER";
  $("brand-mark").textContent=short.slice(0,1); $("page-eyebrow").textContent=b.developerLabel||"GAME LIBRARY";
  $("hero-tagline").textContent=b.tagline||"Deine nächste Geschichte beginnt hier.";
  $("hero-description").textContent=b.description||"Installieren, aktuell halten und direkt losspielen.";
  $("itch-link").textContent=(b.shortName||name)+" Website ↗"; $("itch-link").onclick=e=>{e.preventDefault();if(b.website)window.launcher.openExternal(b.website);};
  $("version").textContent=name.toUpperCase()+" · "+(launcherConfig.version||"");
  if(b.logo){$("brand-mark").textContent="";$("brand-mark").style.backgroundImage="url('"+String(b.logo).replace(/['"\\]/g,"")+"')";}
  const prov=launcherConfig.provenance||{};
  $("about-content").innerHTML="<p><strong>"+esc(prov.notice||"Based on Thornyx Launcher, originally created by ThornyDevil Studios.")+"</strong></p><p>Originalprojekt: <a href='#' id='original-repo-link'>ThornyDevil Studios / thornyx-launcher</a></p>";
  $("original-repo-link").onclick=e=>{e.preventDefault();window.launcher.openExternal(prov.repository||"https://github.com/ThornyDevilStudios/thornyx-launcher");};
  applyTheme();
}
function chooseLayout() {
  const cfg=launcherConfig.library||{}, p=prefs(), count=games.length;
  if(p.layout && p.layout!=="auto") return p.layout;
  if(cfg.layoutMode && cfg.layoutMode!=="auto") return cfg.layoutMode;
  const threshold=Number(p.threshold||cfg.largeLibraryThreshold||30);
  if(count>=threshold)return "large";
  if(count<=Number(cfg.compactMaxGames||9))return "compact";
  return "medium";
}
function updateLayout() {
  layout=chooseLayout();
  $("sidebar").classList.toggle("sidebar-right",(launcherConfig.library||{}).sidebarPosition==="right");
  $("installed-sidebar").classList.toggle("hidden",layout!=="compact" && !(launcherConfig.library||{}).showInstalledSidebar);
  $("hero").classList.toggle("hidden",layout==="compact");
  $("home-sections").classList.toggle("hidden",layout!=="large");
  $("view-toggle").classList.toggle("hidden",layout==="compact");
  $("games").classList.toggle("list-view",displayMode==="list" || (layout==="compact" && displayMode==="list"));
  $("games").classList.toggle("compact-grid",layout==="compact");
  $("section-eyebrow").textContent=layout==="large"?"DISCOVER":layout==="compact"?"YOUR GAMES":"GAME LIBRARY";
  $("page-title").textContent=layout==="large"?"Entdecken":layout==="compact"?"Deine Spiele":"Spielebibliothek";
}
function fillFilters() {
  const genres=[...new Set(games.map(g=>g.genre).filter(Boolean))].sort(), devs=[...new Set(games.map(g=>g.developer).filter(Boolean))].sort();
  const genre=$("genre-filter").value, developer=$("developer-filter").value;
  $("genre-filter").innerHTML='<option value="">Alle Genres</option>'+genres.map(x=>'<option>'+esc(x)+'</option>').join("");
  $("developer-filter").innerHTML='<option value="">Alle Entwickler</option>'+devs.map(x=>'<option>'+esc(x)+'</option>').join("");
  $("genre-filter").value=genres.includes(genre)?genre:""; $("developer-filter").value=devs.includes(developer)?developer:"";
}
function installedSidebar() {
  const list=games.filter(g=>g.installed);
  $("installed-list").innerHTML=list.map(g=>'<button class="installed-link" data-open="'+esc(g.id)+'">'+esc(g.name)+'</button>').join("")||'<small class="muted">Noch keine Spiele installiert</small>';
}
function homeSections() {
  const recent=[...games].filter(g=>g.installed).slice(0,4), newest=[...games].sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0)).slice(0,4);
  const card=g=>'<button class="home-card" data-open="'+esc(g.id)+'"><span>'+esc(g.genre||g.developer||"GAME")+'</span><strong>'+esc(g.name)+'</strong><small>'+(g.installed?"Installiert":esc(g.version||"Entdecken"))+'</small></button>';
  $("home-sections").innerHTML='<div class="home-row"><div><span class="eyebrow">RECENTLY PLAYED / INSTALLED</span><h3>Deine Spiele</h3></div><div class="home-cards">'+(recent.length?recent.map(card).join(""):'<p class="muted">Installierte Spiele erscheinen hier.</p>')+'</div></div><div class="home-row"><div><span class="eyebrow">LATEST RELEASES</span><h3>Neu im Katalog</h3></div><div class="home-cards">'+newest.map(card).join("")+'</div></div>';
}
function gameCard(g) {
  const busyNow=busy.has(g.id), label=busyNow?"Bitte warten …":!g.installed?"Installieren":g.updateAvailable?"Update verfügbar":"Spielen";
  const art=g.cover?'<img src="'+esc(g.cover)+'" alt="" loading="lazy">':'<div class="game-initial">'+esc(g.name.slice(0,1).toUpperCase())+'</div>';
  return '<article class="game-card"><button class="game-art" data-open="'+esc(g.id)+'">'+art+'</button><div class="game-body"><div class="game-meta"><span>'+esc(g.developer||"INDIE GAME")+'</span><span>'+(g.installed?"● INSTALLIERT":"○ NICHT INSTALLIERT")+'</span></div><h3 class="game-title">'+esc(g.name)+'</h3><p class="game-desc">'+esc(g.description||"Ein Indie-Spiel aus der Bibliothek.")+'</p><div class="game-tags">'+(g.genre?'<span>'+esc(g.genre)+'</span>':"")+'</div><div class="release"><strong>'+esc(g.version||"Release nicht verfügbar")+'</strong><small>'+esc(g.publishedAt?new Date(g.publishedAt).toLocaleDateString("de-DE"):"")+' '+formatSize(g.assetSize)+'</small><p class="release-notes">'+esc(g.body||g.error||"Noch keine Release-Informationen.")+'</p></div><div class="card-actions"><button class="primary" data-action="main" data-id="'+esc(g.id)+'" '+(busyNow||(!g.assetUrl&&!g.installed)?"disabled":"")+'>'+label+'</button>'+(g.installed?'<button class="secondary" data-action="uninstall" data-id="'+esc(g.id)+'" title="Deinstallieren">⌫</button>':"")+(g.mods&&g.installed?'<button class="secondary" data-action="mods" data-id="'+esc(g.id)+'">MODS</button>':"")+'<button class="secondary" data-action="notes" data-id="'+esc(g.id)+'">↗</button>'+(g.itchUrl?'<button class="secondary" data-action="store" data-id="'+esc(g.id)+'">WEB</button>':"")+'</div></div></article>';
}
function render() {
  updateLayout(); installedSidebar(); homeSections(); fillFilters();
  const q=$("search").value.toLowerCase().trim(), genre=$("genre-filter").value, dev=$("developer-filter").value, sort=$("sort-select").value;
  let rows=games.filter(g=>(view!=="installed"||g.installed)&&(!q||(g.name+" "+g.description+" "+g.developer+" "+g.genre).toLowerCase().includes(q))&&(!genre||g.genre===genre)&&(!dev||g.developer===dev));
  if(sort==="developer")rows.sort((a,b)=>(a.developer||"").localeCompare(b.developer||""));
  else if(sort==="newest")rows.sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0));
  else rows.sort((a,b)=>a.name.localeCompare(b.name));
  $("games").innerHTML=rows.map(gameCard).join(""); $("empty").classList.toggle("hidden",rows.length>0);
  $("game-count").textContent=games.length; $("section-title").innerHTML=(view==="installed"?"Installiert":"Alle Spiele")+' <span>'+rows.length+' angezeigt</span>';
  $("view-grid").classList.toggle("active",displayMode==="grid"); $("view-list").classList.toggle("active",displayMode==="list");
}
async function refresh() {
  $("status").textContent="Prüfe GitHub-Releases …";
  try { games=await window.launcher.checkUpdates(); $("connection-label").textContent="Mit GitHub verbunden"; $("status").textContent="Bibliothek aktualisiert."; render(); }
  catch(e){$("status").textContent=e.message;$("games").innerHTML='<div class="loading error">'+esc(e.message)+'</div>';}
}
async function perform(id,action) {
  if(busy.has(id))return;const g=games.find(x=>x.id===id);if(!g)return;
  try {
    if(action==="main"){if(g.installed&&!g.updateAvailable)await window.launcher.launchGame(id);else{if(g.installed&&g.updateAvailable&&!confirm("Update für "+g.name+" jetzt installieren?"))return;busy.add(id);render();await window.launcher.installGame(id);await refresh();}}
    else if(action==="uninstall"){if(confirm(g.name+" wirklich deinstallieren?")){await window.launcher.uninstallGame(id);await refresh();}}
    else if(action==="mods")await window.launcher.openMods(id);
    else if(action==="notes"&&g.htmlUrl)await window.launcher.openExternal(g.htmlUrl);
    else if(action==="store"&&g.itchUrl)await window.launcher.openExternal(g.itchUrl);
  }catch(e){$("status").textContent=e.message;alert(e.message);}finally{busy.delete(id);render();}
}
$("games").addEventListener("click",e=>{const b=e.target.closest("[data-action]");if(b)perform(b.dataset.id,b.dataset.action);});

function openGameDetail(id) {
  const g=games.find(x=>x.id===id); if(!g)return;
  const art=g.heroImage||g.cover;
  $("detail-art").style.backgroundImage=art ? "linear-gradient(0deg,#090c12 0%,#090c1255 65%,transparent 100%),url("+JSON.stringify(art)+")" : "";
  $("detail-title").textContent=g.name;
  $("detail-meta").textContent=[g.developer,g.genre,g.version].filter(Boolean).join(" · ");
  $("detail-description").textContent=g.description||"Für dieses Spiel liegt noch keine Beschreibung vor.";
  $("detail-notes").textContent=g.body||"Keine Release-Notizen verfügbar.";
  $("detail-status").textContent=g.installed?(g.updateAvailable?"Update verfügbar":"Installiert · "+(g.installedVersion||"Version unbekannt")):"Noch nicht installiert";
  $("detail-actions").innerHTML='<button class="primary" data-action="main" data-id="'+esc(g.id)+'">'+(g.installed?(g.updateAvailable?"Update installieren":"Spielen"):"Installieren")+'</button>'+(g.installed?'<button class="secondary" data-action="uninstall" data-id="'+esc(g.id)+'">Deinstallieren</button>':"")+(g.mods&&g.installed?'<button class="secondary" data-action="mods" data-id="'+esc(g.id)+'">Mods-Ordner</button>':"")+(g.htmlUrl?'<button class="secondary" data-action="notes" data-id="'+esc(g.id)+'">Release auf GitHub</button>':"");
  $("detail-modal").classList.remove("hidden");
}
document.addEventListener("click",e=>{
  const open=e.target.closest("[data-open]"); if(open)openGameDetail(open.dataset.open);
  if(e.target.id==="close-detail"||e.target.id==="detail-modal")$("detail-modal").classList.add("hidden");
});
$("detail-actions").addEventListener("click",e=>{const b=e.target.closest("[data-action]");if(b)perform(b.dataset.id,b.dataset.action).then(()=>{const g=games.find(x=>x.id===b.dataset.id);if(g)openGameDetail(g.id);});});

["search","genre-filter","developer-filter","sort-select"].forEach(id=>$(id).addEventListener(id==="search"?"input":"change",render));
function setView(v){view=v;render();}
$("nav-library").onclick=()=>{view="all";$("search").value="";render();};
$("nav-all").onclick=()=>setView("all");$("nav-installed").onclick=()=>setView("installed");
$("nav-refresh").onclick=$("refresh-top").onclick=refresh;
$("nav-add").onclick=()=>$("add-modal").classList.remove("hidden");
$("nav-settings").onclick=()=>{$("setting-layout").value=prefs().layout||"auto";$("setting-view").value=displayMode;$("setting-accent").value=prefs().accent||launcherConfig.branding.accentColor||"#c5f36b";$("setting-background").value=prefs().background||launcherConfig.branding.backgroundColor||"#0b0d12";$("setting-panel").value=prefs().panel||launcherConfig.branding.panelColor||"#121620";$("setting-text").value=prefs().text||launcherConfig.branding.textColor||"#f1f3f7";$("setting-threshold").value=prefs().threshold||launcherConfig.library.largeLibraryThreshold||30;const s=await window.launcher.getSettings();$("setting-install-directory").value=s.installDirectory;$("settings-modal").classList.remove("hidden");};
$("choose-install-directory").onclick=async()=>{const s=await window.launcher.chooseInstallDirectory();$("setting-install-directory").value=s.installDirectory;};
$("save-settings").onclick=()=>{savePrefs({layout:$("setting-layout").value,view:$("setting-view").value,accent:$("setting-accent").value,background:$("setting-background").value,panel:$("setting-panel").value,text:$("setting-text").value,threshold:Number($("setting-threshold").value)});displayMode=$("setting-view").value;applyTheme();$("settings-modal").classList.add("hidden");render();};
$("view-grid").onclick=()=>{displayMode="grid";render();};$("view-list").onclick=()=>{displayMode="list";render();};
$("nav-about").onclick=()=>$("about-modal").classList.remove("hidden");
$("close-modal").onclick=()=>$("add-modal").classList.add("hidden");$("close-about").onclick=()=>$("about-modal").classList.add("hidden");$("close-settings").onclick=()=>$("settings-modal").classList.add("hidden");
["add-modal","about-modal","settings-modal"].forEach(id=>$(id).addEventListener("click",e=>{if(e.target.id===id)$(id).classList.add("hidden");}));
$("add-form").addEventListener("submit",async e=>{e.preventDefault();const d=new FormData(e.currentTarget),g=Object.fromEntries(d.entries());g.mods=d.has("mods");try{await window.launcher.addGame(g);e.currentTarget.reset();$("add-modal").classList.add("hidden");await refresh();}catch(err){alert(err.message);}});
window.launcher.onProgress(d=>$("status").textContent="Download: "+(d.total?d.percent+"%":formatSize(d.received)));
window.launcher.onStatus(d=>$("status").textContent=d.message);
window.launcher.onLauncherUpdate(async d=>{if(confirm("Eine neue Launcher-Version ("+d.version+") ist verfügbar. Jetzt herunterladen?")){try{await window.launcher.downloadLauncherUpdate();if(confirm("Update heruntergeladen. Launcher jetzt neu starten?"))window.launcher.installLauncherUpdate();}catch(e){alert(e.message);}}});
(async()=>{try{launcherConfig=await window.launcher.getConfig();const p=prefs();displayMode=p.view||launcherConfig.library?.mediumView||"grid";applyBranding();await refresh();}catch(e){$("status").textContent="Konfiguration: "+e.message;}})();
