<script>
  import { app } from "./model.svelte.js";

  const chips = $derived(app.target
    ? [["all", "Alle"], ["missing", "Fehlt"], ["review", "Prüfen"], ["done", "Übersetzt"]]
    : [["all", "Alle"]]);
</script>

<div class="filters">
  <div class="chips" role="group" aria-label="Nach Status filtern">
    {#each chips as [value, label]}
      <button type="button" class={["chip", app.filter === value && "on"]} aria-pressed={app.filter === value} onclick={() => (app.filter = value)}>
        {label}<span class="count mono">{app.counts[value]}</span>
      </button>
    {/each}
  </div>
  <span class="meta">
    {#if app.namespace !== null}Bereich <span class="mono">{app.namespace || "ohne Präfix"}</span>{" · "}{/if}Sortiert A–Z · wie in localize.json
  </span>
</div>

<style>
  .filters { display: flex; align-items: center; justify-content: space-between; gap: var(--space-12); flex-wrap: wrap; }
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
  .meta { font-size: 13px; line-height: 18px; color: var(--text-muted); }
</style>
