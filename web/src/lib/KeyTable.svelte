<script>
  import { app } from "./model.svelte.js";
  import KeyRow from "./KeyRow.svelte";
  import Icon from "./ui/Icon.svelte";
  import Button from "./ui/Button.svelte";

  const cols = $derived(app.target
    ? "minmax(160px, 240px) minmax(0, 1fr) minmax(0, 1fr) 104px 40px"
    : "minmax(160px, 240px) minmax(0, 1fr) 40px");

  const emptyKind = $derived(
    !app.keyNames.length ? "none" :
    app.visible.length ? null :
    app.filter === "missing" && !app.search && app.namespace === null ? "complete" : "nomatch");
</script>

<div class="table" role="table" aria-label="Keys und Texte" style:--cols={cols}>
  <div class="head" role="row">
    <span role="columnheader" class="label">Key</span>
    <span role="columnheader" class="label">{app.langName(app.base)} <span class="code">{app.base} · Basis</span></span>
    {#if app.target}
      <span role="columnheader" class="label">{app.langName(app.target)} <span class="code">{app.target}</span></span>
      <span role="columnheader" class="label">Status</span>
    {/if}
    <span role="columnheader"><span class="sr-only">Aktionen</span></span>
  </div>

  {#each app.visible as row (row.key)}
    <KeyRow {row} />
  {/each}

  {#if emptyKind}
    <div class="empty">
      <span class="icon"><Icon name={emptyKind === "nomatch" ? "search" : emptyKind === "complete" ? "check" : "languages"} size={22} /></span>
      {#if emptyKind === "none"}
        <strong>Noch keine Keys</strong>
        <p>Leg oben deinen ersten Key an. Platzhalter wie <span class="tok">#name</span> kannst du direkt mitschreiben.</p>
      {:else if emptyKind === "complete"}
        <strong>Alles übersetzt</strong>
        <p>Für {app.langName(app.target)} fehlt kein einziger Text.</p>
        <Button size="s" onclick={() => app.resetFilters()}>Alle Keys zeigen</Button>
      {:else}
        <strong>Keine Treffer</strong>
        <p>Kein Key passt zu Suche und Filter.</p>
        <Button size="s" icon="filterX" onclick={() => app.resetFilters()}>Filter zurücksetzen</Button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .table {
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: var(--radius-xl); overflow: hidden; box-shadow: var(--shadow-card);
  }
  .head {
    display: grid; grid-template-columns: var(--cols); gap: var(--space-20);
    padding: var(--space-12) var(--space-12) var(--space-12) var(--space-20);
    background: var(--bg-sunken); border-bottom: 1px solid var(--border);
  }
  .code { font: 400 12px/14px var(--font-mono); text-transform: none; letter-spacing: 0; color: var(--text-subtle); margin-left: 4px; }

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

  @media (max-width: 760px) {
    .head { display: none; }
    .table { border-radius: var(--radius-lg); }
  }
</style>
