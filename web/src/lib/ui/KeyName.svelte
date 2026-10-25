<script>
  // Key-Anzeige mit gedimmtem Präfix; Klick macht daraus ein Eingabefeld zum Umbenennen.
  let { name, onrename } = $props();

  let editing = $state(false);
  let draft = $state("");
  let error = $state("");
  let input = $state();

  const dot = $derived(name.indexOf("."));

  async function start() {
    draft = name;
    error = "";
    editing = true;
    await Promise.resolve();
    input?.focus();
    input?.select();
  }
  async function commit() {
    const next = draft.trim();
    if (!editing) return;
    if (!next || next === name) { editing = false; return; }
    error = (await onrename(next)) || "";
    if (!error) editing = false;
  }
  function keydown(e) {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { editing = false; error = ""; }
  }
</script>

{#if editing}
  <input
    bind:this={input}
    bind:value={draft}
    class="edit"
    spellcheck="false"
    autocomplete="off"
    aria-label="Key umbenennen"
    aria-invalid={!!error}
    onblur={commit}
    onkeydown={keydown}
  />
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{:else}
  <button type="button" class="show" title="Klicken zum Umbenennen" onclick={start}>
    {#if dot > 0}<span class="prefix">{name.slice(0, dot + 1)}</span>{name.slice(dot + 1)}{:else}{name}{/if}
  </button>
{/if}

<style>
  .show, .edit {
    display: block; width: 100%; text-align: left;
    font: 400 13px/18px var(--font-mono); color: var(--text);
    padding: 10px 8px; margin-left: -8px;
    border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent;
    overflow-wrap: anywhere;
  }
  .show:hover { background: var(--bg-sunken); }
  .prefix { color: var(--text-subtle); }
  .edit { background: var(--bg-surface); border-color: var(--text); box-shadow: var(--ring); outline: none; }
  .edit[aria-invalid="true"] { border-color: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
  .error { margin: 6px 0 0; font-size: 13px; line-height: 18px; color: var(--danger); }
</style>
