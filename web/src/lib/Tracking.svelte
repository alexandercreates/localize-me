<script>
  import { buildTrackingStrings, buildTrackingXml, checkTracking, TRACKING_FILENAMES } from "@shared/tracking.js";
  import { app, prefs, trackingUrl } from "./model.svelte.js";
  import TrackingRow from "./TrackingRow.svelte";
  import Icon from "./ui/Icon.svelte";
  import Button from "./ui/Button.svelte";

  let { searchInput = $bindable() } = $props();

  const SECTIONS = {
    screens: { label: "Screens", one: "Screen", placeholder: "home", empty: "Leg oben den ersten Screen an." },
    events: { label: "Events", one: "Event", placeholder: "purchase_completed", empty: "Leg oben das erste Event an." },
    parameters: { label: "Parameter", one: "Parameter", placeholder: "item_id", empty: "Leg oben den ersten Parameter an." },
  };
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  const section = $derived(Object.hasOwn(SECTIONS, app.trackingSection) ? app.trackingSection : "events");
  const meta = $derived(SECTIONS[section]);

  const rows = $derived.by(() => {
    const q = app.trackingSearch.trim().toLowerCase();
    return Object.entries(app.tracking[section])
      .filter(([name, item]) => !q || name.toLowerCase().includes(q) || (item.description || "").toLowerCase().includes(q))
      .map(([name, item]) => ({ name, item }));
  });
  const total = $derived(Object.keys(app.tracking[section]).length);

  // ---------- Anlegen ----------
  let nameInput = $state();
  let name = $state("");
  let description = $state("");
  let error = $state("");
  let busy = $state(false);

  async function add(e) {
    e.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    busy = true;
    error = (await app.mutate("POST", trackingUrl(section), { name: trimmed, description })) || "";
    busy = false;
    if (error) return nameInput?.focus();
    app.notify(`„${trimmed}“ angelegt.`);
    name = description = "";
    nameInput?.focus();
  }

  function choose(next) {
    app.setTrackingSection(next);
    app.trackingSearch = "";
    error = "";
  }

  // ---------- Vorschau ----------
  let codePlatform = $state(prefs.get("trackingCode", "ios") === "android" ? "android" : "ios");
  const problems = $derived(app.project ? checkTracking(app.project, codePlatform) : []);
  const code = $derived.by(() => {
    // Mit Problemen ließe sich die Datei nicht sinnvoll erzeugen, dann stehen stattdessen die Meldungen da.
    if (problems.length || !app.project) return "";
    return codePlatform === "ios" ? buildTrackingStrings(app.project) : buildTrackingXml(app.project);
  });
  function chooseCode(next) {
    codePlatform = next;
    prefs.set("trackingCode", next);
  }
</script>

<header class="top">
  <div class="title">
    <h1>Tracking</h1>
    <p>Namen für Screens, Events und Parameter festlegen. Daraus entsteht je eine einfache Datei für iOS und Android.</p>
  </div>
  <Button variant="primary" icon="download" onclick={() => (app.exportOpen = true)}>Exportieren</Button>
</header>

<form class="quick" onsubmit={add}>
  <div class="row">
    <label class="field">
      <span class="label">{section === "events" ? "Neues" : "Neuer"} {meta.one}</span>
      <input
        bind:this={nameInput}
        bind:value={name}
        class="mono"
        placeholder={meta.placeholder}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={!!error}
        aria-describedby={error ? "tracking-error" : "tracking-hint"}
        oninput={() => (error = "")}
      />
    </label>
    <label class="field">
      <span class="label">Beschreibung (optional)</span>
      <input bind:value={description} placeholder="Wann wird das gesendet?" autocomplete="off" />
    </label>
    <Button type="submit" variant="inverse" icon="plus">{meta.one} anlegen</Button>
  </div>
  {#if error}
    <p class="error" id="tracking-error" role="alert">{error}</p>
  {:else}
    <p class="hint" id="tracking-hint">
      Der Name kommt genau so beim Analytics-Dienst an. Auf Android heißt die Ressource dann zum Beispiel <span class="mono">parameter_item_id</span>.
    </p>
  {/if}
</form>

<div class="toolbar">
  <div class="chips" role="group" aria-label="Bereich wählen">
    {#each Object.entries(SECTIONS) as [value, s]}
      <button type="button" class={["chip", section === value && "on"]} aria-pressed={section === value} onclick={() => choose(value)}>
        {s.label}<span class="count mono">{Object.keys(app.tracking[value]).length}</span>
      </button>
    {/each}
  </div>
  <div class="search">
    <Icon name="search" size={16} />
    <input bind:this={searchInput} bind:value={app.trackingSearch} type="search" placeholder={`${meta.label} suchen`} aria-label={`${meta.label} suchen`} />
    <kbd>{isMac ? "⌘K" : "Strg K"}</kbd>
  </div>
</div>

<div class="table" role="table" aria-label={meta.label}>
  <div class="head" role="row">
    <span role="columnheader" class="label">Name</span>
    <span role="columnheader" class="label">Beschreibung</span>
    <span role="columnheader"><span class="sr-only">Aktionen</span></span>
  </div>
  {#each rows as { name: itemName, item } (itemName)}
    <TrackingRow {section} name={itemName} {item} />
  {/each}
  {#if !rows.length}
    <div class="empty">
      <span class="icon"><Icon name={total ? "search" : "activity"} size={22} /></span>
      {#if total}
        <strong>Keine Treffer</strong>
        <p>{meta.label}: Nichts passt zu deiner Suche.</p>
        <Button size="s" icon="filterX" onclick={() => (app.trackingSearch = "")}>Suche zurücksetzen</Button>
      {:else}
        <strong>Noch keine {meta.label}</strong>
        <p>{meta.empty}</p>
      {/if}
    </div>
  {/if}
</div>

<section class="preview" aria-labelledby="tracking-code-title">
  <div class="preview-head">
    <h2 id="tracking-code-title" class="label">Erzeugte Datei</h2>
    <div class="segmented" role="group" aria-label="Plattform der Vorschau">
      <button type="button" class={[codePlatform === "ios" && "on"]} aria-pressed={codePlatform === "ios"} onclick={() => chooseCode("ios")}><Icon name="apple" size={16} />iOS</button>
      <button type="button" class={[codePlatform === "android" && "on"]} aria-pressed={codePlatform === "android"} onclick={() => chooseCode("android")}><Icon name="android" size={16} />Android</button>
    </div>
  </div>
  {#if problems.length}
    <div class="problems" role="status">
      <Icon name="alert" size={16} />
      <div>
        <p>Das muss in <span class="mono">localize.json</span> korrigiert werden, bevor die Datei entstehen kann:</p>
        <ul>{#each problems as problem}<li>{problem}</li>{/each}</ul>
      </div>
    </div>
  {:else}
    <div class="code">
      <div class="filebar"><Icon name="file" size={14} /><span class="mono name">{TRACKING_FILENAMES[codePlatform]}</span></div>
      <pre tabindex="0" aria-label={`Vorschau von ${TRACKING_FILENAMES[codePlatform]}`}>{code}</pre>
    </div>
  {/if}
</section>

<style>
  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-16); flex-wrap: wrap; }
  .title { flex: 1 1 320px; min-width: 0; }
  h1 { margin: 0; font: 700 28px/34px var(--font-display); letter-spacing: -0.02em; }
  .title p { margin: 4px 0 0; color: var(--text-muted); }

  .quick {
    display: flex; flex-direction: column; gap: var(--space-12);
    padding: var(--space-20); border-radius: var(--radius-xl);
    background: var(--bg-surface); border: 1px solid var(--border); box-shadow: var(--shadow-card);
  }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto; gap: var(--space-12); align-items: end; }
  .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .field input {
    width: 100%; height: 40px; padding: 0 12px;
    border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text);
  }
  input.mono { font-size: 13px; }
  input::placeholder { color: var(--text-subtle); }
  .field input:focus { outline: none; border-color: var(--text); box-shadow: var(--ring); }
  .field input[aria-invalid="true"] { border-color: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
  .error { margin: -4px 0 0; font-size: 13px; line-height: 18px; color: var(--danger); }
  .hint { margin: 0; font-size: 13px; line-height: 18px; color: var(--text-muted); }

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
  .table { --tracking-cols: minmax(160px, 320px) minmax(0, 1fr) 40px; }
  .head {
    display: grid; grid-template-columns: var(--tracking-cols); gap: var(--space-20);
    padding: var(--space-12) var(--space-12) var(--space-12) var(--space-20);
    background: var(--bg-sunken); border-bottom: 1px solid var(--border);
  }
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

  .preview { display: flex; flex-direction: column; gap: var(--space-12); }
  .preview-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-12); flex-wrap: wrap; }
  h2 { margin: 0; }
  .segmented { display: flex; gap: 4px; padding: 4px; border-radius: var(--radius-md); background: var(--bg-sunken); }
  .segmented button {
    display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 0; border-radius: var(--radius-sm);
    background: transparent; color: var(--text-muted); font-size: 13px; line-height: 18px; font-weight: 500;
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
    .row { grid-template-columns: 1fr; }
    .head { display: none; }
    .table { border-radius: var(--radius-lg); }
    .search { flex: 1; width: auto; }
  }
</style>
