<script>
  import Icon from "./Icon.svelte";

  // Status immer als Farbe + Icon + Wort.
  const KINDS = {
    done: { label: "Übersetzt", icon: "check" },
    missing: { label: "Fehlt", icon: "circleDashed" },
    review: { label: "Prüfen", icon: "alert" },
  };
  let { status } = $props();
  const kind = $derived(KINDS[status]);
</script>

{#if kind}
  <span class={["badge", status]}><Icon name={kind.icon} size={14} />{kind.label}</span>
{/if}

<style>
  .badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 10px 3px 8px; border-radius: var(--radius-full);
    font-size: 13px; line-height: 18px; font-weight: 500; white-space: nowrap;
  }
  .done { background: var(--accent-soft); color: var(--accent-text); }
  .missing { background: var(--missing-soft); color: var(--missing); }
  .review { background: var(--token-soft); color: var(--token); }
</style>
