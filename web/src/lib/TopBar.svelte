<script>
  import { app } from "./model.svelte.js";
  import Icon from "./ui/Icon.svelte";
  import Button from "./ui/Button.svelte";

  let { searchInput = $bindable(), onaddlanguage } = $props();

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  // Lime gehört der nächsten sinnvollen Aktion: solange etwas fehlt, ist das „Fehlende übersetzen“ im Fortschrittsblock.
  const exportVariant = $derived(app.target && app.totals.missing + app.totals.review > 0 ? "secondary" : "primary");
</script>

<header class="top">
  <div class="pair">
    <label class="pill">
      <span class="code mono">{app.base.toUpperCase()}</span>
      <span class="name">{app.langName(app.base)}</span>
      <Icon name="chevronDown" size={16} />
      <select aria-label="Basissprache" value={app.base} onchange={(e) => app.run("PUT", "/api/base", { code: e.currentTarget.value }, "Basissprache geändert.")}>
        {#each app.languages as l}<option value={l.code}>{l.name} ({l.code})</option>{/each}
      </select>
    </label>
    <Icon name="arrowRight" size={18} class="arrow" />
    {#if app.target}
      <label class="pill active">
        <span class="code mono">{app.target.toUpperCase()}</span>
        <span class="name">{app.langName(app.target)}</span>
        <Icon name="chevronDown" size={16} />
        <select aria-label="Zielsprache" value={app.target} onchange={(e) => app.setTarget(e.currentTarget.value)}>
          {#each app.others as l}<option value={l.code}>{l.name} ({l.code})</option>{/each}
        </select>
      </label>
    {:else}
      <button type="button" class="pill add" onclick={onaddlanguage}><Icon name="plus" size={16} />Zielsprache</button>
    {/if}
  </div>

  <div class="search">
    <Icon name="search" size={16} />
    <input bind:this={searchInput} bind:value={app.search} type="search" placeholder="Key oder Text suchen" aria-label="Key oder Text suchen" />
    <kbd>{isMac ? "⌘K" : "Strg K"}</kbd>
  </div>

  <Button variant={exportVariant} icon="download" disabled={!app.keyNames.length} onclick={() => (app.exportOpen = true)}>Exportieren</Button>
</header>

<style>
  .top { display: flex; align-items: center; gap: var(--space-16); flex-wrap: wrap; }

  .pair {
    display: flex; align-items: center; gap: var(--space-8); padding: 6px;
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
    margin-right: auto;
  }
  .pair :global(.arrow) { color: var(--text-subtle); }
  .pill {
    position: relative; display: inline-flex; align-items: center; gap: var(--space-8);
    padding: 6px 10px; border-radius: var(--radius-md); background: var(--bg-sunken);
    font-weight: 500; cursor: pointer;
  }
  .pill:hover { background: var(--border); }
  .pill.active { background: var(--emphasis-bg); color: var(--emphasis-text); }
  .pill .code { font-size: 12px; color: var(--text-muted); }
  .pill.active .code { color: var(--accent); }
  .pill select {
    position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer;
    /* Natives Menü, aber unsichtbar über der Pille – zugänglich und ohne eigenes Dropdown */
  }
  .pill:has(select:focus-visible) { outline: 2px solid var(--text); outline-offset: 2px; }
  .pill.add { border: 1px dashed var(--border-strong); background: transparent; color: var(--text-muted); padding: 5px 12px 5px 10px; }
  .pill.add:hover { color: var(--text); border-color: var(--text-muted); }

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

  @media (max-width: 760px) {
    .pair { margin-right: 0; width: 100%; }
    .search { flex: 1; width: auto; }
  }
</style>
