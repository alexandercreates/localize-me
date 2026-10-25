<script>
  import { untrack } from "svelte";
  import { neutralSegments } from "../tokens.js";

  // Mehrzeiliges Textfeld mit hervorgehobenen Platzhaltern. Unter dem (transparenten) Textfeld liegt
  // eine Spiegel-Ebene mit gleicher Schrift, die #name-Tokens einfärbt und die Höhe vorgibt.
  // Gespeichert wird beim Verlassen; Enter verlässt das Feld, Umschalt+Enter macht einen Zeilenumbruch,
  // Escape verwirft die Eingabe.
  let { value = "", label, placeholder = "", tone = "plain", onsave, ref = $bindable() } = $props();

  let draft = $state(untrack(() => value));
  let focused = $state(false);
  // Änderungen von außen (Server, git pull) übernehmen, solange hier niemand tippt.
  $effect(() => {
    const next = value;
    if (!focused) draft = next;
  });

  const segments = $derived(neutralSegments(draft));

  // Erst nach der Antwort des Servers wieder von außen synchronisieren, sonst blitzt kurz der alte Text auf.
  async function commit() {
    if (draft !== value) await onsave?.(draft);
    if (document.activeElement !== ref) focused = false;
  }
  function keydown(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.currentTarget.blur(); }
    if (e.key === "Escape") { draft = value; e.currentTarget.blur(); }
  }
</script>

<div class={["field", tone]}>
  <div class="mirror" aria-hidden="true">{#each segments as s}{#if s.token}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}&#8203;</div>
  <textarea
    bind:this={ref}
    bind:value={draft}
    rows="1"
    spellcheck="true"
    aria-label={label}
    {placeholder}
    onfocus={() => (focused = true)}
    onblur={commit}
    onkeydown={keydown}
  ></textarea>
</div>

<style>
  .field {
    display: grid;
    border: 1px solid transparent; border-radius: var(--radius-md);
    transition: border-color var(--dur-fast), background-color var(--dur-fast), box-shadow var(--dur-fast);
  }
  .mirror, textarea {
    grid-area: 1 / 1;
    margin: 0; padding: 8px 10px; border: 0;
    font: 400 15px/22px var(--font-ui); letter-spacing: normal;
    white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .mirror { color: var(--text); pointer-events: none; }
  textarea {
    resize: none; overflow: hidden; background: transparent;
    color: transparent; caret-color: var(--text);
    min-height: 38px;
  }
  textarea::placeholder { color: var(--text-subtle); }
  textarea:focus { outline: none; }
  mark {
    color: var(--token); background: var(--token-soft);
    border-radius: 4px; box-shadow: 0 0 0 2px var(--token-soft);
  }

  /* Ruhig: Rand erst bei Hover/Fokus */
  .plain:hover { border-color: var(--border); }
  /* Zielspalte, ausgefüllt */
  .filled { background: var(--bg-canvas); border-color: var(--border); }
  .filled:hover { border-color: var(--border-strong); }
  /* Übersetzung fehlt */
  .missing { background: var(--missing-soft); border: 1px dashed var(--missing); }
  .missing textarea::placeholder { color: var(--missing); }
  /* Platzhalter-Konflikt */
  .review { background: var(--bg-canvas); border-color: var(--token); }

  .field:focus-within {
    background: var(--bg-surface); border-style: solid; border-color: var(--text);
    box-shadow: var(--ring);
  }
</style>
