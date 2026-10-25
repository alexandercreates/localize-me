<script>
  import Icon from "./Icon.svelte";

  // Varianten wie die Figma-Komponente „Button“: primary (Lime, eine pro Ansicht), secondary, ghost, inverse, danger.
  let { variant = "secondary", size = "m", icon = null, href = null, children, class: cls = "", ...rest } = $props();
</script>

{#if href}
  <a {href} class={["btn", variant, size, cls]} {...rest}>
    {#if icon}<Icon name={icon} size={size === "m" ? 18 : 16} />{/if}
    {@render children?.()}
  </a>
{:else}
  <button type="button" class={["btn", variant, size, cls]} {...rest}>
    {#if icon}<Icon name={icon} size={size === "m" ? 18 : 16} />{/if}
    {@render children?.()}
  </button>
{/if}

<style>
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--space-8);
    border: 1px solid transparent; border-radius: var(--radius-md);
    font-weight: 500; text-decoration: none; white-space: nowrap;
    transition: background-color var(--dur-fast), border-color var(--dur-fast), transform var(--dur-fast);
  }
  .btn:active:not(:disabled) { transform: translateY(1px); }
  .btn:disabled, .btn[aria-disabled="true"] { opacity: 0.4; cursor: not-allowed; }
  .m { min-height: 40px; padding: 9px var(--space-16); font-size: 15px; line-height: 22px; }
  .s { min-height: 30px; padding: 5px var(--space-12); gap: var(--space-6); font-size: 13px; line-height: 18px; }

  .primary { background: var(--accent); color: var(--text-on-accent); }
  .primary:hover:not(:disabled) { background: var(--accent-hover); }
  .secondary { background: var(--bg-surface); color: var(--text); border-color: var(--border-strong); }
  .secondary:hover:not(:disabled) { border-color: var(--text-muted); }
  .ghost { background: transparent; color: var(--text-muted); }
  .ghost:hover:not(:disabled) { background: var(--bg-sunken); color: var(--text); }
  .inverse { background: var(--bg-inverse); color: var(--text-on-inverse); }
  .inverse:hover:not(:disabled) { opacity: 0.88; }
  .danger { background: var(--danger-soft); color: var(--danger); }
  .danger:hover:not(:disabled) { border-color: var(--danger); }
</style>
