<script>
  import { tick } from "svelte";
  import { app } from "./model.svelte.js";
  import Button from "./ui/Button.svelte";

  let input = $state();
  let dialog = $state();
  // Ausgewählte Datei samt Übersicht, was sich ändern würde: { name, data, summary }
  let pending = $state(null);
  let busy = $state(false);

  const fileName = $derived((app.project?.file || "localize.json").split(/[\\/]/).pop());
  const REMOVED_SHOWN = 5;

  async function choose(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ""; // damit dieselbe Datei nach einer Korrektur wieder auslöst
    if (!file) return;
    let data;
    try {
      data = JSON.parse((await file.text()).replace(/^﻿/, ""));
      if (!data) throw new Error();
    } catch {
      return app.notify(`„${file.name}“ ist kein gültiges JSON.`, "error");
    }
    try {
      const summary = await app.request("POST", "/api/import?preview=1", data);
      if (summary.unchanged) return app.notify(`„${file.name}“ entspricht schon dem aktuellen Stand.`);
      pending = { name: file.name, data, summary };
      await tick();
      dialog.showModal();
      dialog.querySelector("[data-cancel]")?.focus();
    } catch (err) {
      app.notify(err.message, "error");
    }
  }

  async function replace() {
    busy = true;
    const error = await app.mutate("POST", "/api/import", pending.data);
    busy = false;
    dialog.close();
    if (error) app.notify(error, "error");
    else app.notify(`${fileName} ersetzt, Sicherung liegt als ${fileName}.bak daneben.`);
  }

  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
</script>

<input bind:this={input} type="file" accept=".json,application/json" class="sr-only" tabindex="-1" aria-hidden="true" onchange={choose} />
<Button icon="upload" onclick={() => input.click()}>Importieren</Button>

<dialog bind:this={dialog} class="confirm" aria-labelledby="import-title" onclose={() => (pending = null)}>
  {#if pending}
    {@const s = pending.summary}
    <h2 id="import-title">{fileName} durch „{pending.name}“ ersetzen?</h2>
    <p>Danach enthält das Projekt {count(s.total, "Key", "Keys")}. Das ändert sich:</p>
    <ul>
      {#if s.added}<li>{count(s.added, "Key", "Keys")} neu</li>{/if}
      {#if s.changed}<li>{count(s.changed, "Key", "Keys")} geändert</li>{/if}
      {#if s.removed.length}
        <li class="removed">
          {count(s.removed.length, "Key", "Keys")} entfernt:
          <span class="mono">{s.removed.slice(0, REMOVED_SHOWN).join(", ")}{s.removed.length > REMOVED_SHOWN ? " …" : ""}</span>
        </li>
      {/if}
      {#if s.languagesAdded.length}<li>Neue Sprachen: <span class="mono">{s.languagesAdded.join(", ")}</span></li>{/if}
      {#if s.languagesRemoved.length}<li class="removed">Entfernte Sprachen: <span class="mono">{s.languagesRemoved.join(", ")}</span></li>{/if}
      {#if s.base}<li>Neue Basissprache: <span class="mono">{s.base}</span></li>{/if}
      {#each s.sections as section}<li>{section} geändert</li>{/each}
    </ul>
    <p class="note">Die bisherige Datei bleibt als <span class="mono">{fileName}.bak</span> erhalten. Die Zielordner unter <span class="mono">output</span> ändern sich nicht.</p>
    <footer>
      <Button data-cancel onclick={() => dialog.close()}>Abbrechen</Button>
      <Button variant="danger" disabled={busy} onclick={replace}>Texte ersetzen</Button>
    </footer>
  {/if}
</dialog>

<style>
  .confirm {
    width: min(480px, calc(100vw - 32px)); padding: var(--space-24);
    background: var(--bg-surface); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius-lg);
  }
  .confirm::backdrop { background: rgb(8 9 8 / 0.45); }
  h2 { margin: 0 0 var(--space-12); font-size: 18px; line-height: 24px; overflow-wrap: anywhere; }
  p { margin: 0 0 var(--space-8); font-size: 14px; line-height: 20px; }
  ul { margin: 0 0 var(--space-12); padding-left: 18px; font-size: 14px; line-height: 22px; }
  .removed { color: var(--missing); overflow-wrap: anywhere; }
  .note { font-size: 13px; line-height: 18px; color: var(--text-muted); }
  footer { display: flex; justify-content: flex-end; gap: var(--space-8); margin-top: var(--space-16); flex-wrap: wrap; }
</style>
