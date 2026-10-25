<script>
  import { app } from "./model.svelte.js";
  import Icon from "./ui/Icon.svelte";

  let { codeInput = $bindable() } = $props();

  const shortFile = $derived((app.project?.file || "").split(/[\\/]/).slice(-2).join("/"));

  // ---------- Sprache anlegen ----------
  let code = $state("");
  let name = $state("");
  let error = $state("");

  // Name aus dem Sprachcode vorschlagen: en → Englisch, pt-BR → Portugiesisch (Brasilien).
  const suggested = $derived.by(() => {
    try {
      const c = code.trim().replace("_", "-");
      const n = c.length >= 2 ? new Intl.DisplayNames(["de"], { type: "language" }).of(c) : "";
      return n && n !== c ? n.charAt(0).toUpperCase() + n.slice(1) : "";
    } catch {
      return "";
    }
  });

  async function openAdd() {
    app.addLangOpen = true;
    await Promise.resolve();
    codeInput?.focus();
  }
  function closeAdd() {
    app.addLangOpen = false;
    code = name = error = "";
  }
  async function addLanguage(e) {
    e.preventDefault();
    const c = code.trim();
    const n = name.trim() || suggested;
    error = (await app.mutate("POST", "/api/languages", { code: c, name: n })) || "";
    if (error) return;
    app.setTarget(c);
    app.notify(`${n || c} angelegt und als Zielsprache gewählt.`);
    closeAdd();
  }

  // ---------- Sprache entfernen / Basis setzen ----------
  let armed = $state("");
  let disarm;
  async function removeLanguage(l) {
    if (armed !== l.code) {
      armed = l.code;
      clearTimeout(disarm);
      disarm = setTimeout(() => (armed = ""), 4000);
      return;
    }
    armed = "";
    await app.run("DELETE", "/api/languages/" + encodeURIComponent(l.code), null,
      `${l.name} entfernt. Die Texte bleiben in der Datei und sind wieder da, wenn du ${l.code} erneut anlegst.`);
  }
  const makeBase = (l) => app.run("PUT", "/api/base", { code: l.code }, `${l.name} ist jetzt die Basissprache.`);
</script>

<aside class="sidebar">
  <div class="brand">
    <span class="mark"><Icon name="languages" size={18} /></span>
    <span class="wordmark">localize-me</span>
  </div>

  <div class="project">
    <div class="file mono" title={app.project?.file}><Icon name="file" size={16} />{shortFile || "…"}</div>
    <div class={["sync", app.connection]}>
      <span class="dot"></span>
      {app.connection === "lost" ? "Verbindung unterbrochen – versuche erneut …" : "Live · automatisch gespeichert"}
    </div>
  </div>

  <nav class="section" aria-label="Sprachen">
    <div class="section-head">
      <span class="label">Sprachen</span>
      <button type="button" class="icon-btn" aria-label="Sprache hinzufügen" title="Sprache hinzufügen" onclick={openAdd}><Icon name="plus" size={16} /></button>
    </div>

    {#each app.languages as l (l.code)}
      {@const isBase = l.code === app.base}
      {@const active = l.code === app.target}
      {@const p = app.progress(l.code)}
      <div class={["lang", active && "active", isBase && "base"]}>
        <button
          type="button"
          class="lang-main"
          aria-current={active ? "true" : undefined}
          disabled={isBase}
          onclick={() => app.setTarget(l.code)}
        >
          <span class="code mono">{l.code.toUpperCase()}</span>
          <span class="name">{l.name}</span>
          {#if isBase}<span class="meta label">Basis</span>{:else}<span class="meta mono">{Math.round(p.ratio * 100)}%</span>{/if}
        </button>
        {#if !isBase}
          <div class="bar" role="progressbar" aria-label={`${l.name} übersetzt`} aria-valuemin="0" aria-valuemax={p.total} aria-valuenow={p.done}>
            <i style:width={`${p.ratio * 100}%`}></i>
          </div>
          <div class="lang-actions">
            <button type="button" class="icon-btn" title="Als Basissprache festlegen" aria-label={`${l.name} als Basissprache festlegen`} onclick={() => makeBase(l)}><Icon name="anchor" size={14} /></button>
            <button
              type="button"
              class={["icon-btn", "danger", armed === l.code && "armed"]}
              title={armed === l.code ? "Nochmal klicken zum Entfernen" : "Sprache entfernen"}
              aria-label={armed === l.code ? `${l.name} wirklich entfernen` : `${l.name} entfernen`}
              onclick={() => removeLanguage(l)}
            ><Icon name="x" size={14} />{#if armed === l.code}<span>Entfernen?</span>{/if}</button>
          </div>
        {/if}
      </div>
    {/each}

    {#if app.addLangOpen}
      <form class="add-form" onsubmit={addLanguage}>
        <div class="add-fields">
          <label><span class="label">Code</span><input bind:this={codeInput} bind:value={code} placeholder="en" autocomplete="off" spellcheck="false" class="mono" /></label>
          <label><span class="label">Name</span><input bind:value={name} placeholder={suggested || "Englisch"} autocomplete="off" /></label>
        </div>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="add-buttons">
          <button type="submit" class="add-submit">Sprache anlegen</button>
          <button type="button" class="add-cancel" onclick={closeAdd}>Abbrechen</button>
        </div>
      </form>
    {:else}
      <button type="button" class="add" onclick={openAdd}><Icon name="plus" size={16} />Sprache hinzufügen</button>
    {/if}
  </nav>

  <nav class="section namespaces" aria-label="Bereiche">
    <div class="section-head"><span class="label">Bereiche</span></div>
    {#if app.keyNames.length}
      <button type="button" class={["ns", app.namespace === null && "active"]} aria-pressed={app.namespace === null} onclick={() => (app.namespace = null)}>
        <Icon name="list" size={16} /><span class="ns-name">Alle Keys</span><span class="mono count">{app.keyNames.length}</span>
      </button>
      {#each app.namespaces as [ns, count] (ns)}
        <button type="button" class={["ns", app.namespace === ns && "active"]} aria-pressed={app.namespace === ns} onclick={() => (app.namespace = ns)}>
          <Icon name="hash" size={16} /><span class="ns-name mono">{ns || "ohne Präfix"}</span><span class="mono count">{count}</span>
        </button>
      {/each}
    {:else}
      <p class="hint">Entstehen automatisch aus Key-Präfixen wie <span class="mono">onboarding.</span></p>
    {/if}
  </nav>

  <div class="cli">
    <div class="cli-head"><Icon name="terminal" size={14} /><span class="label">Auch im Build</span></div>
    <code>npx localize-me export<br>&nbsp;&nbsp;--platform ios</code>
  </div>
</aside>

<style>
  .sidebar {
    position: sticky; top: 0; height: 100dvh; overflow-y: auto;
    display: flex; flex-direction: column; gap: var(--space-24);
    padding: var(--space-24) var(--space-16);
    background: var(--sidebar-bg); color: var(--sidebar-text);
  }
  .label { color: var(--sidebar-muted); }

  .brand { display: flex; align-items: center; gap: var(--space-12); padding-left: 6px; }
  .mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-md); background: var(--accent); color: var(--text-on-accent); }
  .wordmark { font: 700 20px/24px var(--font-display); letter-spacing: -0.02em; }

  .project { display: flex; flex-direction: column; gap: var(--space-8); padding: var(--space-12); border-radius: var(--radius-lg); background: var(--sidebar-item); }
  .file { display: flex; align-items: center; gap: var(--space-8); font-size: 12px; line-height: 16px; font-weight: 500; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .file :global(svg) { color: var(--sidebar-muted); }
  .sync { display: flex; align-items: center; gap: var(--space-8); font-size: 13px; line-height: 18px; color: var(--sidebar-muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px rgb(200 240 74 / 0.5); flex: none; }
  .sync.connecting .dot { opacity: 0.4; box-shadow: none; }
  .sync.lost .dot { background: var(--danger); box-shadow: none; }

  .section { display: flex; flex-direction: column; gap: var(--space-4); }
  .section-head { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 4px 10px; min-height: 28px; }

  .icon-btn {
    display: inline-flex; align-items: center; gap: 4px; justify-content: center;
    min-width: 28px; height: 28px; padding: 0 6px; border: 0; border-radius: var(--radius-sm);
    background: transparent; color: var(--sidebar-muted); font-size: 12px; font-weight: 500;
  }
  .icon-btn:hover { background: var(--sidebar-item); color: var(--sidebar-text); }
  .icon-btn.danger:hover, .icon-btn.armed { color: #ff8a80; }
  .icon-btn.armed { background: rgb(255 107 94 / 0.14); }

  .lang { position: relative; border-radius: var(--radius-md); padding: 0 0 2px; }
  .lang.active { background: var(--sidebar-item); }
  .lang-main {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 10px 12px 8px 10px; border: 0; border-radius: var(--radius-md);
    background: transparent; color: var(--sidebar-text); text-align: left;
  }
  .lang:not(.active):not(.base) .lang-main:hover { background: var(--sidebar-item); }
  .lang-main:disabled { cursor: default; }
  .code {
    display: grid; place-items: center; width: 30px; height: 24px; border-radius: var(--radius-sm);
    background: var(--sidebar-item); font-size: 12px; font-weight: 500; flex: none;
  }
  .active .code { background: var(--accent); color: var(--text-on-accent); }
  .name { flex: 1; min-width: 0; font-size: 13px; line-height: 18px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta.mono { font-size: 12px; color: var(--sidebar-muted); }
  .active .meta.mono { color: var(--accent); }
  .bar { height: 4px; margin: 0 12px 8px 10px; border-radius: 2px; background: var(--sidebar-item); overflow: hidden; }
  .active .bar { background: var(--sidebar-bg); }
  .bar i { display: block; height: 100%; background: var(--accent); border-radius: 2px; transition: width var(--dur-med) var(--ease-out); }

  /* Aktionen erscheinen bei Hover/Fokus anstelle der Prozentzahl */
  .lang-actions {
    position: absolute; top: 6px; right: 6px; display: flex; gap: 2px;
    opacity: 0; pointer-events: none; transition: opacity var(--dur-fast);
  }
  .lang:hover .lang-actions, .lang:focus-within .lang-actions, .lang-actions:has(.armed) { opacity: 1; pointer-events: auto; }
  .lang:hover .meta, .lang:focus-within .meta { visibility: hidden; }
  .lang-actions .icon-btn { background: var(--sidebar-bg); }
  .active .lang-actions .icon-btn { background: var(--sidebar-item); }

  .add {
    display: flex; align-items: center; gap: var(--space-8); padding: 10px;
    border: 1px dashed var(--sidebar-item); border-radius: var(--radius-md);
    background: transparent; color: var(--sidebar-muted); font-size: 13px; font-weight: 500;
  }
  .add:hover { color: var(--sidebar-text); border-color: var(--sidebar-muted); }

  .add-form { display: flex; flex-direction: column; gap: var(--space-8); padding: var(--space-12); border-radius: var(--radius-md); background: var(--sidebar-item); }
  .add-fields { display: grid; grid-template-columns: 72px 1fr; gap: var(--space-8); }
  .add-form label { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .add-form input {
    width: 100%; padding: 7px 8px; border-radius: var(--radius-sm);
    border: 1px solid #3a3e39; background: var(--sidebar-bg); color: var(--sidebar-text); font-size: 13px;
  }
  .add-form input:focus { outline: none; border-color: var(--accent); }
  .add-buttons { display: flex; gap: var(--space-8); }
  .add-submit { flex: 1; padding: 7px 10px; border: 0; border-radius: var(--radius-sm); background: var(--accent); color: var(--text-on-accent); font-size: 13px; font-weight: 500; }
  .add-cancel { padding: 7px 10px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--sidebar-muted); font-size: 13px; }
  .add-cancel:hover { color: var(--sidebar-text); }
  .error { margin: 0; font-size: 12px; line-height: 16px; color: #ff8a80; }

  .ns {
    display: flex; align-items: center; gap: 10px; padding: 7px 10px;
    border: 0; border-radius: var(--radius-md); background: transparent;
    color: var(--sidebar-muted); font-size: 13px; line-height: 18px; text-align: left;
  }
  .ns:hover { color: var(--sidebar-text); background: var(--sidebar-item); }
  .ns.active { color: var(--sidebar-text); background: var(--sidebar-item); font-weight: 500; }
  .ns-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { font-size: 12px; color: var(--sidebar-muted); }
  .hint { margin: 0; padding: 0 10px; font-size: 13px; line-height: 18px; color: var(--sidebar-muted); }

  .cli { margin-top: auto; padding: var(--space-12); border: 1px solid var(--sidebar-item); border-radius: var(--radius-lg); }
  .cli-head { display: flex; align-items: center; gap: var(--space-8); margin-bottom: var(--space-8); color: var(--accent); }
  .cli code { font: 500 12px/18px var(--font-mono); color: var(--sidebar-text); }

  :global(.sidebar :focus-visible) { outline-color: var(--accent); }

  @media (max-width: 960px) {
    .sidebar { position: static; height: auto; gap: var(--space-16); }
    .cli { display: none; }
  }
  /* Auf dem Handy reichen Suche und Filter-Chips; die Bereichsliste würde den Kopf zu lang machen. */
  @media (max-width: 760px) {
    .namespaces { display: none; }
  }
</style>
