<script>
  import { app } from "./model.svelte.js";
  import Button from "./ui/Button.svelte";
  import Icon from "./ui/Icon.svelte";

  const sync = $derived(app.project?.sync);
  const conflicts = $derived(sync?.conflicts ?? []);

  function show(value) {
    if (value === undefined) return "gelöscht";
    if (value !== null && typeof value === "object") return Object.values(value).join(" / ");
    return String(value) || "leer";
  }

  // ["keys", "welcome", "de"] → welcome · de
  const label = (path) => (path[0] === "keys" ? path.slice(1) : path).join(" · ");

  const resolve = (conflict, use) => app.run("POST", "/api/sync/resolve", { id: conflict.id, use });
</script>

{#if sync?.error}
  <section class="notice error" role="alert">
    <Icon name="alert" size={16} />
    <div>
      <h2>Abgleich mit Git hat nicht geklappt</h2>
      <p>Die Texte hier sind vielleicht nicht aktuell. localize-me versucht es automatisch weiter.</p>
      <pre class="mono">{sync.error}</pre>
    </div>
  </section>
{/if}

{#if conflicts.length}
  <section class="notice" aria-label="Konflikte aus dem Abgleich">
    <Icon name="alert" size={16} />
    <div>
      <h2>{conflicts.length === 1 ? "Ein Text wurde" : `${conflicts.length} Texte wurden`} hier und im Repo unterschiedlich geändert</h2>
      <ul>
        {#each conflicts as conflict (conflict.id)}
          <li>
            <span class="mono key">{label(conflict.path)}</span>
            <dl>
              <dt>Hier</dt><dd>{show(conflict.ours)}</dd>
              <dt>{conflict.source}</dt><dd>{show(conflict.theirs)}</dd>
            </dl>
            <div class="actions">
              <Button size="s" onclick={() => resolve(conflict, "local")}>Hier behalten</Button>
              <Button size="s" onclick={() => resolve(conflict, "remote")}>Von {conflict.source} übernehmen</Button>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  </section>
{/if}

<style>
  .notice {
    display: flex; gap: var(--space-8); padding: 12px 14px;
    border: 1px solid var(--border-strong); border-radius: var(--radius-lg);
    background: var(--bg-surface); color: var(--text); font-size: 13px; line-height: 18px;
  }
  .notice.error { border-color: var(--danger); background: var(--danger-soft); }
  .notice > :global(svg) { flex: none; margin-top: 1px; color: var(--text-muted); }
  .notice.error > :global(svg) { color: var(--danger); }
  .notice > div { flex: 1; min-width: 0; }
  h2 { margin: 0 0 4px; font-size: 13px; line-height: 18px; font-weight: 600; }
  p { margin: 0; }
  pre { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 16px; }
  ul { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: var(--space-12); }
  .key { font-weight: 600; overflow-wrap: anywhere; }
  dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px var(--space-12); margin: 4px 0 8px; }
  dt { color: var(--text-muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-8); }
</style>
