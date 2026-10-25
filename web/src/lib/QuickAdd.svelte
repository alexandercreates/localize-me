<script>
  import { app } from "./model.svelte.js";
  import Button from "./ui/Button.svelte";

  let { keyInput = $bindable() } = $props();

  let key = $state("");
  let text = $state("");
  let plural = $state(false);
  let error = $state("");
  let busy = $state(false);

  async function submit(e) {
    e.preventDefault();
    const name = key.trim();
    busy = true;
    error = (await app.mutate("POST", "/api/keys", { key: name, values: { [app.base]: text }, plural })) || "";
    busy = false;
    if (error) return;
    app.notify(`„${name}“ angelegt.`);
    key = text = "";
    plural = false;
    keyInput?.focus();
  }
</script>

<form class="quick" onsubmit={submit}>
  <div class="row">
    <label class="field">
      <span class="label">Neuer Key</span>
      <input
        bind:this={keyInput}
        bind:value={key}
        class="mono"
        placeholder="onboarding.title"
        autocomplete="off"
        spellcheck="false"
        aria-invalid={!!error}
        aria-describedby={error ? "quick-error" : "quick-hint"}
        oninput={() => (error = "")}
      />
    </label>
    <label class="field">
      <span class="label">Text ({app.langName(app.base)}){plural ? " · Form „andere“" : ""}</span>
      <input bind:value={text} placeholder={plural ? "#count:int offene Aufgaben" : "Willkommen!"} autocomplete="off" />
    </label>
    <label class="check" title="Text hängt von einer Anzahl ab: „Eine Aufgabe“ / „3 Aufgaben“">
      <input type="checkbox" bind:checked={plural} />Plural
    </label>
    <Button type="submit" variant="inverse" icon="plus" disabled={busy}>Key anlegen</Button>
  </div>
  {#if error}
    <p class="error" id="quick-error" role="alert">{error}</p>
  {/if}
  <p class="hint" id="quick-hint">
    <span>Platzhalter:</span>
    <span class="item"><span class="tok">#name</span> Text</span>
    <span class="item"><span class="tok">#anzahl<span class="type">:int</span></span> ganze Zahl</span>
    <span class="item"><span class="tok">#preis<span class="type">:float</span></span> Kommazahl</span>
    <span class="item"><span class="tok">##</span> echtes #</span>
    <span class="subtle">→ beim Export automatisch zu %@ / %s · Plural: Formen je Sprache, Zahl über #count:int</span>
  </p>
</form>

<style>
  .quick {
    display: flex; flex-direction: column; gap: var(--space-12);
    padding: var(--space-20); border-radius: var(--radius-xl);
    background: var(--bg-surface); border: 1px solid var(--border); box-shadow: var(--shadow-card);
  }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto; gap: var(--space-12); align-items: end; }
  .check {
    display: inline-flex; align-items: center; gap: 6px; height: 40px;
    font-size: 13px; line-height: 18px; font-weight: 500; color: var(--text-muted); white-space: nowrap;
  }
  .check input { width: 16px; height: 16px; margin: 0; accent-color: var(--token); }
  .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .field input {
    width: 100%; height: 40px; padding: 0 12px;
    border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text);
  }
  input.mono { font-size: 13px; }
  input::placeholder { color: var(--text-subtle); }
  input:focus { outline: none; border-color: var(--text); box-shadow: var(--ring); }
  input[aria-invalid="true"] { border-color: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
  .error { margin: -4px 0 0; font-size: 13px; line-height: 18px; color: var(--danger); }
  .hint { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0; font-size: 13px; line-height: 18px; color: var(--text-muted); }
  .item { display: inline-flex; align-items: center; gap: 6px; }
  .subtle { color: var(--text-subtle); }

  @media (max-width: 760px) {
    .row { grid-template-columns: 1fr; }
  }
</style>
