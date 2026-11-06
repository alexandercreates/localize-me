<script>
  import { buildInfoPlistStrings, checkInfoPlist, INFO_PLIST_FILENAME, INFO_PLIST_GROUPS, INFO_PLIST_KEY_PATTERN, INFO_PLIST_KEY_RULE, INFO_PLIST_KNOWN } from "@shared/infoplist.js";
  import { lprojName } from "@shared/platforms.js";
  import { app, infoPlistUrl } from "./model.svelte.js";
  import Icon from "./ui/Icon.svelte";
  import Button from "./ui/Button.svelte";

  let { searchInput = $bindable(), onaddlanguage } = $props();

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const FILTERS = [
    ["all", "Alle"],
    ["filled", "Befüllt"],
    ["missing", "Übersetzung fehlt"],
    ["empty", "Leer"],
  ];

  // Bekannte Keys aus dem Katalog, dazu alles, was sonst in localize.json steht, als „Eigene Keys“.
  const groups = $derived.by(() => {
    const custom = Object.keys(app.infoPlist).filter((k) => !INFO_PLIST_KNOWN.has(k)).sort((a, b) => a.localeCompare(b));
    return [
      ...INFO_PLIST_GROUPS.map((g) => ({ id: g.id, label: g.label, items: g.keys })),
      { id: "custom", label: "Eigene Keys", items: custom.map((key) => ({ key, custom: true })) },
    ];
  });

  function statusOf(key) {
    const values = app.infoPlist[key] ?? {};
    if (!values[app.base]?.trim()) return "empty";
    if (app.target && !values[app.target]) return "missing";
    return "filled";
  }

  const all = $derived(groups.flatMap((g) => g.items));
  const counts = $derived.by(() => {
    const c = { all: all.length, filled: 0, missing: 0, empty: 0 };
    for (const item of all) c[statusOf(item.key)]++;
    // „Befüllt“ zählt alles mit Text in der Basissprache, auch wenn eine Übersetzung fehlt.
    c.filled += c.missing;
    return c;
  });

  function matches(item) {
    const status = statusOf(item.key);
    if (app.infoPlistFilter === "filled" && status === "empty") return false;
    if (app.infoPlistFilter !== "all" && app.infoPlistFilter !== "filled" && status !== app.infoPlistFilter) return false;
    const q = app.infoPlistSearch.trim().toLowerCase();
    if (!q) return true;
    const values = Object.values(app.infoPlist[item.key] ?? {});
    return [item.key, item.title, item.hint, ...values].some((t) => typeof t === "string" && t.toLowerCase().includes(q));
  }
  const visible = $derived(groups.map((g) => ({ ...g, items: g.items.filter(matches) })).filter((g) => g.items.length));

  // ---------- Speichern ----------
  function save(key, lang) {
    return (e) => {
      const value = e.currentTarget.value;
      if (value === (app.infoPlist[key]?.[lang] ?? "")) return;
      app.run("PUT", infoPlistUrl(key), { lang, value });
    };
  }
  function fieldKey(e, restore) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
    if (e.key === "Escape") { e.currentTarget.value = restore; e.currentTarget.blur(); }
  }

  let armed = $state("");
  let disarm;
  async function clear(key) {
    if (armed !== key) {
      armed = key;
      clearTimeout(disarm);
      disarm = setTimeout(() => (armed = ""), 3000);
      return;
    }
    clearTimeout(disarm);
    armed = "";
    await app.run("DELETE", infoPlistUrl(key), null, `Texte für „${key}“ entfernt.`);
  }

  // ---------- Eigener Key ----------
  let customKey = $state("");
  let customText = $state("");
  let customError = $state("");
  let customInput = $state();
  async function addCustom(e) {
    e.preventDefault();
    const key = customKey.trim();
    if (!INFO_PLIST_KEY_PATTERN.test(key)) {
      customError = key ? INFO_PLIST_KEY_RULE : "Gib einen Key ein, zum Beispiel NSCameraUsageDescription.";
      return customInput?.focus();
    }
    if (!customText.trim()) {
      customError = `Gib den Text in ${app.langName(app.base)} ein.`;
      return;
    }
    if (app.infoPlist[key]?.[app.base]) {
      customError = `„${key}“ hat schon einen Text.`;
      return customInput?.focus();
    }
    customError = (await app.mutate("PUT", infoPlistUrl(key), { lang: app.base, value: customText })) || "";
    if (customError) return;
    app.notify(INFO_PLIST_KNOWN.has(key) ? `„${key}“ ausgefüllt.` : `„${key}“ angelegt.`);
    customKey = customText = "";
  }

  // ---------- Vorschau ----------
  let previewLang = $state("");
  const preview = $derived(app.languages.some((l) => l.code === previewLang) ? previewLang : app.base);
  const problems = $derived(app.project ? checkInfoPlist(app.project) : []);
  const code = $derived(app.project && !problems.length ? buildInfoPlistStrings(app.project, preview) : "");
</script>

<header class="top">
  <div class="title">
    <h1>InfoPlist</h1>
    <p>Texte aus der Info.plist übersetzen, etwa für Kamera- oder Standortabfragen. Befüllte Keys landen in <span class="mono">{INFO_PLIST_FILENAME}</span> je Sprache.</p>
  </div>
  <Button variant="primary" icon="download" onclick={() => (app.exportOpen = true)}>Exportieren</Button>
</header>

<p class="notice">
  <Icon name="alert" size={16} />
  <span>Jeder Key muss zusätzlich in der <span class="mono">Info.plist</span> des Targets stehen. <span class="mono">{INFO_PLIST_FILENAME}</span> übersetzt nur. Fehlt eine Übersetzung, zeigt iOS den Wert aus der Info.plist.</span>
</p>

{#if !app.others.length}
  <p class="hint-line">Nur eine Sprache angelegt. <button type="button" class="link" onclick={onaddlanguage}>Sprache hinzufügen</button>, um die Texte zu übersetzen.</p>
{/if}

<div class="toolbar">
  <div class="chips" role="group" aria-label="Filter">
    {#each FILTERS as [value, label]}
      {#if value !== "missing" || app.target}
        <button type="button" class={["chip", app.infoPlistFilter === value && "on"]} aria-pressed={app.infoPlistFilter === value} onclick={() => (app.infoPlistFilter = value)}>
          {label}<span class="count mono">{counts[value]}</span>
        </button>
      {/if}
    {/each}
  </div>
  <div class="search">
    <Icon name="search" size={16} />
    <input bind:this={searchInput} bind:value={app.infoPlistSearch} type="search" placeholder="Keys und Texte suchen" aria-label="Info.plist-Keys suchen" />
    <kbd>{isMac ? "⌘K" : "Strg K"}</kbd>
  </div>
</div>

<div class="table" role="table" aria-label="Info.plist-Texte" style:--cols={app.target ? "minmax(200px, 300px) minmax(0, 1fr) minmax(0, 1fr) 40px" : "minmax(200px, 300px) minmax(0, 1fr) 40px"}>
  <div class="head" role="row">
    <span role="columnheader" class="label">Key</span>
    <span role="columnheader" class="label">{app.langName(app.base)} <span class="lang-code">{app.base} · Basis</span></span>
    {#if app.target}<span role="columnheader" class="label">{app.langName(app.target)} <span class="lang-code">{app.target}</span></span>{/if}
    <span role="columnheader"><span class="sr-only">Aktionen</span></span>
  </div>

  {#each visible as group (group.id)}
    <div class="group" role="row"><span role="cell" class="label">{group.label}</span></div>
    {#each group.items as item (item.key)}
      {@const values = app.infoPlist[item.key] ?? {}}
      {@const status = statusOf(item.key)}
      <div class={["row", `is-${status}`]} role="row">
        <div class="cell key" role="cell">
          <span class="mono name" title={item.key}>{item.key}</span>
          {#if item.title}<span class="what">{item.title}{#if item.legacy}<span class="badge">älter</span>{/if}</span>{/if}
          {#if item.hint}<span class="why">{item.hint}</span>{/if}
        </div>
        <div class="cell" role="cell">
          <span class="mobile-label label">{app.langName(app.base)}</span>
          <textarea
            rows="1"
            value={values[app.base] ?? ""}
            placeholder={status === "empty" ? "Nicht genutzt – Text eintragen" : ""}
            aria-label={`${item.key}: Text in ${app.langName(app.base)}`}
            onblur={save(item.key, app.base)}
            onkeydown={(e) => fieldKey(e, values[app.base] ?? "")}
          ></textarea>
        </div>
        {#if app.target}
          <div class="cell" role="cell">
            <span class="mobile-label label">{app.langName(app.target)}</span>
            <textarea
              rows="1"
              class={[status === "missing" && "missing"]}
              value={values[app.target] ?? ""}
              placeholder={status === "missing" ? "Fehlt – hier tippen" : ""}
              disabled={status === "empty" && !values[app.target]}
              aria-label={`${item.key}: Übersetzung in ${app.langName(app.target)}`}
              onblur={save(item.key, app.target)}
              onkeydown={(e) => fieldKey(e, values[app.target] ?? "")}
            ></textarea>
          </div>
        {/if}
        <div class="cell actions" role="cell">
          {#if Object.keys(values).length}
            <button
              type="button"
              class={["delete", armed === item.key && "armed"]}
              aria-label={armed === item.key ? `Texte für „${item.key}“ wirklich entfernen` : `Texte für „${item.key}“ entfernen`}
              title={armed === item.key ? "Nochmal klicken zum Entfernen" : "Alle Sprachen leeren"}
              onclick={() => clear(item.key)}
              onblur={() => (armed = "")}
            ><Icon name="trash" size={16} />{#if armed === item.key}<span>Leeren?</span>{/if}</button>
          {/if}
        </div>
      </div>
    {/each}
  {/each}

  {#if !visible.length}
    <div class="empty">
      <span class="icon"><Icon name="search" size={22} /></span>
      <strong>Keine Treffer</strong>
      <p>Nichts passt zu Suche oder Filter.</p>
      <Button size="s" icon="filterX" onclick={() => { app.infoPlistSearch = ""; app.infoPlistFilter = "all"; }}>Filter zurücksetzen</Button>
    </div>
  {/if}
</div>

<form class="quick" onsubmit={addCustom}>
  <div class="quick-head">
    <h2 class="label">Eigener Key</h2>
    <p>Für Keys, die oben fehlen, etwa aus einem SDK.</p>
  </div>
  <div class="quick-row">
    <label class="field">
      <span class="label">Key</span>
      <input bind:this={customInput} bind:value={customKey} class="mono" placeholder="NSExampleUsageDescription" autocomplete="off" spellcheck="false" aria-invalid={!!customError} aria-describedby={customError ? "infoplist-error" : undefined} oninput={() => (customError = "")} />
    </label>
    <label class="field">
      <span class="label">Text in {app.langName(app.base)}</span>
      <input bind:value={customText} placeholder="Wofür braucht die App das?" autocomplete="off" oninput={() => (customError = "")} />
    </label>
    <Button type="submit" variant="inverse" icon="plus">Key anlegen</Button>
  </div>
  {#if customError}<p class="error" id="infoplist-error" role="alert">{customError}</p>{/if}
</form>

<section class="preview" aria-labelledby="infoplist-code-title">
  <div class="preview-head">
    <h2 id="infoplist-code-title" class="label">Erzeugte Datei</h2>
    {#if app.languages.length > 1}
      <div class="segmented" role="group" aria-label="Sprache der Vorschau">
        {#each app.languages as l (l.code)}
          <button type="button" class={[preview === l.code && "on"]} aria-pressed={preview === l.code} onclick={() => (previewLang = l.code)}>{l.code}</button>
        {/each}
      </div>
    {/if}
  </div>
  {#if problems.length}
    <div class="problems" role="status">
      <Icon name="alert" size={16} />
      <div>
        <p>Das muss korrigiert werden, bevor die Datei entstehen kann:</p>
        <ul>{#each problems as problem}<li>{problem}</li>{/each}</ul>
      </div>
    </div>
  {:else if !Object.keys(app.infoPlist).length}
    <p class="hint-line">Noch kein Key befüllt. Solange alles leer ist, entsteht keine {INFO_PLIST_FILENAME}.</p>
  {:else}
    <div class="code">
      <div class="filebar"><Icon name="file" size={14} /><span class="mono name">{lprojName(preview)}/{INFO_PLIST_FILENAME}</span></div>
      <pre tabindex="0" aria-label={`Vorschau von ${INFO_PLIST_FILENAME}`}>{code}</pre>
    </div>
  {/if}
</section>

<style>
  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-16); flex-wrap: wrap; }
  .title { flex: 1 1 320px; min-width: 0; }
  h1 { margin: 0; font: 700 28px/34px var(--font-display); letter-spacing: -0.02em; }
  .title p { margin: 4px 0 0; color: var(--text-muted); }

  .notice {
    display: flex; gap: 10px; align-items: flex-start; margin: 0; padding: 12px 14px;
    border-radius: var(--radius-lg); background: var(--bg-sunken); font-size: 13px; line-height: 18px; color: var(--text-muted);
  }
  .notice :global(svg) { flex: none; margin-top: 1px; color: var(--text-subtle); }
  .hint-line { margin: 0; font-size: 13px; line-height: 18px; color: var(--text-muted); }
  .link { padding: 0; border: 0; background: none; color: var(--text); font: inherit; font-weight: 500; text-decoration: underline; text-underline-offset: 2px; }

  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-12); flex-wrap: wrap; }
  .chips { display: flex; gap: var(--space-8); flex-wrap: wrap; }
  .chip {
    display: inline-flex; align-items: center; gap: var(--space-8);
    padding: 5px 6px 5px 12px; border-radius: var(--radius-full);
    border: 1px solid var(--border); background: var(--bg-surface); color: var(--text);
    font-size: 13px; line-height: 18px; font-weight: 500;
  }
  .chip:hover { border-color: var(--border-strong); }
  .chip.on { background: var(--bg-inverse); color: var(--text-on-inverse); border-color: var(--bg-inverse); }
  .count { padding: 1px 7px; border-radius: var(--radius-full); background: var(--bg-sunken); color: var(--text-muted); font-size: 12px; line-height: 16px; font-weight: 500; }
  .on .count { background: var(--accent); color: var(--text-on-accent); }

  .search {
    display: flex; align-items: center; gap: var(--space-8); width: 300px; max-width: 100%;
    padding: 0 8px 0 12px; height: 40px;
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md);
    color: var(--text-subtle);
  }
  .search:focus-within { border-color: var(--text); box-shadow: var(--ring); }
  .search input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text); outline: none; }
  .search input::placeholder { color: var(--text-subtle); }
  kbd {
    font: 500 12px/16px var(--font-mono); color: var(--text-muted);
    padding: 1px 6px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-surface);
  }

  .table {
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: var(--radius-xl); overflow: hidden; box-shadow: var(--shadow-card);
  }
  .head, .row {
    display: grid; grid-template-columns: var(--cols); gap: var(--space-20);
    padding: var(--space-12) var(--space-12) var(--space-12) var(--space-20);
  }
  .head { background: var(--bg-sunken); border-bottom: 1px solid var(--border); }
  .head .lang-code { margin-left: 4px; font: 500 11px/16px var(--font-mono); color: var(--text-subtle); text-transform: none; letter-spacing: 0; }
  .group { padding: var(--space-16) var(--space-20) var(--space-8); border-bottom: 1px solid var(--border); }
  .group .label { color: var(--text-muted); }
  .row { border-bottom: 1px solid var(--border); align-items: start; }
  .row:last-child { border-bottom: 0; }
  .cell { min-width: 0; }
  .key { display: flex; flex-direction: column; gap: 2px; padding-top: 4px; }
  .name { font-size: 12px; line-height: 18px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row.is-empty .name { color: var(--text-muted); }
  .what { font-size: 13px; line-height: 18px; display: flex; align-items: center; gap: 6px; }
  .why { font-size: 12px; line-height: 16px; color: var(--text-muted); }
  .badge { padding: 0 6px; border-radius: var(--radius-full); background: var(--bg-sunken); color: var(--text-muted); font-size: 11px; line-height: 16px; }
  .mobile-label { display: none; }

  textarea {
    display: block; width: 100%; min-height: 38px; padding: 8px; resize: none; field-sizing: content;
    font: inherit; font-size: 14px; line-height: 20px;
    border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text);
  }
  textarea::placeholder { color: var(--text-subtle); }
  textarea:hover:not(:disabled) { background: var(--bg-sunken); }
  textarea:focus { outline: none; background: var(--bg-surface); border-color: var(--text); box-shadow: var(--ring); }
  textarea.missing { border-color: var(--missing); background: var(--missing-soft); }
  textarea:disabled { cursor: not-allowed; }

  .actions { padding-top: 3px; display: flex; justify-content: flex-end; }
  .delete {
    display: inline-flex; align-items: center; gap: 6px; height: 32px; min-width: 32px; padding: 0 8px;
    justify-content: center; border: 1px solid transparent; border-radius: var(--radius-sm);
    background: transparent; color: var(--text-subtle); font-size: 13px; font-weight: 500;
  }
  .delete:hover { color: var(--danger); background: var(--danger-soft); }
  .delete.armed { color: var(--danger); background: var(--danger-soft); border-color: var(--danger); }

  .empty {
    display: flex; flex-direction: column; align-items: center; gap: var(--space-8);
    padding: 56px var(--space-32); text-align: center;
  }
  .empty .icon {
    display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: var(--space-8);
    border-radius: var(--radius-lg); background: var(--accent-soft); color: var(--accent-text);
  }
  .empty strong { font-size: 17px; line-height: 24px; font-weight: 600; }
  .empty p { margin: 0 0 var(--space-8); color: var(--text-muted); max-width: 46ch; }

  .quick {
    display: flex; flex-direction: column; gap: var(--space-12);
    padding: var(--space-20); border-radius: var(--radius-xl);
    background: var(--bg-surface); border: 1px solid var(--border); box-shadow: var(--shadow-card);
  }
  .quick-head p { margin: 2px 0 0; font-size: 13px; line-height: 18px; color: var(--text-muted); }
  .quick-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto; gap: var(--space-12); align-items: end; }
  .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .field input {
    width: 100%; height: 40px; padding: 0 12px;
    border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text);
  }
  input.mono { font-size: 13px; }
  .field input::placeholder { color: var(--text-subtle); }
  .field input:focus { outline: none; border-color: var(--text); box-shadow: var(--ring); }
  .field input[aria-invalid="true"] { border-color: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
  .error { margin: -4px 0 0; font-size: 13px; line-height: 18px; color: var(--danger); }
  h2 { margin: 0; }

  .preview { display: flex; flex-direction: column; gap: var(--space-12); }
  .preview-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-12); flex-wrap: wrap; }
  .segmented { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: var(--radius-md); background: var(--bg-sunken); }
  .segmented button {
    padding: 6px 10px; border: 0; border-radius: var(--radius-sm);
    background: transparent; color: var(--text-muted); font: 500 13px/18px var(--font-mono);
  }
  .segmented button:hover { color: var(--text); }
  .segmented button.on { background: var(--bg-surface); color: var(--text); box-shadow: 0 1px 3px rgb(0 0 0 / 0.08); }
  .code { border-radius: var(--radius-lg); overflow: hidden; background: var(--sidebar-bg); color: var(--sidebar-text); }
  .filebar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--sidebar-item); color: var(--sidebar-muted); }
  .filebar .name { color: var(--sidebar-text); font-size: 12px; font-weight: 500; }
  pre { margin: 0; padding: 12px 14px; max-height: 420px; overflow: auto; font: 400 12px/20px var(--font-mono); }
  .problems { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; background: var(--missing-soft); font-size: 13px; line-height: 18px; }
  .problems :global(svg) { flex: none; margin-top: 1px; color: var(--missing); }
  .problems p { margin: 0; }
  .problems ul { margin: 4px 0 0; padding-left: 18px; }

  @media (max-width: 760px) {
    .head { display: none; }
    .row { grid-template-columns: 1fr; gap: var(--space-8); padding: var(--space-16); position: relative; }
    .key { padding-right: 40px; }
    .actions { position: absolute; top: var(--space-16); right: var(--space-12); padding: 0; }
    .mobile-label { display: block; margin-bottom: 4px; }
    textarea { border-color: var(--border); }
    .table { border-radius: var(--radius-lg); }
    .search { flex: 1; width: auto; }
    .quick-row { grid-template-columns: 1fr; }
  }
</style>
