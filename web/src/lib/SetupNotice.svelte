<script>
  import { app } from "./model.svelte.js";
  import Icon from "./ui/Icon.svelte";
</script>

{#if app.setupNotices.length}
  <section class="setup-notice" role="alert">
    <Icon name="alert" size={16} />
    <div>
      <h2>Serverkonfiguration prüfen</h2>
      <ul>
        {#each app.setupNotices as notice (notice.variable)}
          <li>
            {notice.message}
            {#if notice.fix}<span>Setze <code class="mono">{notice.fix}</code> und starte localize-me neu.</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
  </section>
{/if}

<style>
  .setup-notice {
    display: flex; gap: var(--space-8); padding: 12px 14px;
    border: 1px solid var(--danger); border-radius: var(--radius-lg);
    background: var(--danger-soft); color: var(--text); font-size: 13px; line-height: 18px;
  }
  .setup-notice > :global(svg) { flex: none; margin-top: 1px; color: var(--danger); }
  .setup-notice > div { min-width: 0; }
  h2 { margin: 0 0 4px; font-size: 13px; line-height: 18px; font-weight: 600; }
  ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; overflow-wrap: anywhere; }
  code { font-weight: 600; }
</style>
