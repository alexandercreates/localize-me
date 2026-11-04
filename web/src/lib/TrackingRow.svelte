<script>
  import { isTrackingValue } from "@shared/tracking.js";
  import { app, trackingUrl } from "./model.svelte.js";
  import KeyName from "./ui/KeyName.svelte";
  import Icon from "./ui/Icon.svelte";

  let { section, key, item } = $props();

  const url = $derived(trackingUrl(section, key));
  const rename = (next) => app.mutate("PATCH", url, { key: next });

  // Der Value ist Pflicht: Leeren stellt den alten wieder her. Sonst bleibt er Zeichen für Zeichen, wie getippt.
  function saveValue(e) {
    const value = e.currentTarget.value;
    if (value === (item.value ?? "")) return;
    if (!isTrackingValue(value)) {
      e.currentTarget.value = item.value ?? "";
      app.notify(`„${key}“ braucht einen Value. Der bisherige bleibt erhalten.`, "error");
      return;
    }
    app.run("PATCH", url, { value });
  }
  function fieldKey(e, restore) {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
    if (e.key === "Escape") { e.currentTarget.value = restore; e.currentTarget.blur(); }
  }

  function saveDescription(e) {
    const value = e.currentTarget.value.trim();
    if (value !== (item.description || "")) app.run("PATCH", url, { description: value });
  }
  let armed = $state(false);
  let disarm;
  async function remove() {
    if (!armed) {
      armed = true;
      disarm = setTimeout(() => (armed = false), 3000);
      return;
    }
    clearTimeout(disarm);
    armed = false;
    await app.run("DELETE", url, null, `„${key}“ gelöscht.`);
  }
</script>

<div class="row" role="row" data-key={key}>
  <div class="cell name" role="cell"><KeyName name={key} onrename={rename} /></div>

  <div class="cell" role="cell">
    <span class="mobile-label label">Value</span>
    <input
      class="field-input mono"
      value={item.value ?? ""}
      placeholder="Value fehlt"
      autocomplete="off"
      spellcheck="false"
      aria-required="true"
      aria-invalid={!isTrackingValue(item.value)}
      aria-label={`${key}: Value`}
      onblur={saveValue}
      onkeydown={(e) => fieldKey(e, item.value ?? "")}
    />
  </div>

  <div class="cell" role="cell">
    <span class="mobile-label label">Beschreibung</span>
    <input
      class="field-input"
      value={item.description || ""}
      placeholder="Beschreibung ergänzen"
      autocomplete="off"
      aria-label={`${key}: Beschreibung`}
      onblur={saveDescription}
      onkeydown={(e) => fieldKey(e, item.description || "")}
    />
  </div>

  <div class="cell actions" role="cell">
    <button
      type="button"
      class={["delete", armed && "armed"]}
      aria-label={armed ? `„${key}“ wirklich löschen` : `„${key}“ löschen`}
      title={armed ? "Nochmal klicken zum Löschen" : "Löschen"}
      onclick={remove}
      onblur={() => (armed = false)}
    >
      <Icon name="trash" size={16} />{#if armed}<span>Löschen?</span>{/if}
    </button>
  </div>
</div>

<style>
  .row {
    display: grid; grid-template-columns: var(--tracking-cols); gap: var(--space-20);
    padding: var(--space-12) var(--space-12) var(--space-12) var(--space-20);
    border-bottom: 1px solid var(--border); background: var(--bg-surface); align-items: start;
  }
  .row:last-child { border-bottom: 0; }
  .cell { min-width: 0; }
  .mobile-label { display: none; }

  .field-input {
    width: 100%; height: 38px; padding: 0 8px; font-size: 14px; text-overflow: ellipsis;
    border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text);
  }
  .field-input::placeholder { color: var(--text-subtle); }
  .field-input[aria-invalid="true"] { border-color: var(--missing); background: var(--missing-soft); }
  .field-input:hover { background: var(--bg-sunken); }
  .field-input:focus { outline: none; background: var(--bg-surface); border-color: var(--text); box-shadow: var(--ring); }

  .actions { padding-top: 3px; display: flex; justify-content: flex-end; }
  .delete {
    display: inline-flex; align-items: center; gap: 6px; height: 32px; min-width: 32px; padding: 0 8px;
    justify-content: center; border: 1px solid transparent; border-radius: var(--radius-sm);
    background: transparent; color: var(--text-subtle); font-size: 13px; font-weight: 500;
  }
  .delete:hover { color: var(--danger); background: var(--danger-soft); }
  .delete.armed { color: var(--danger); background: var(--danger-soft); border-color: var(--danger); }

  @media (max-width: 760px) {
    .row { grid-template-columns: 1fr; gap: var(--space-8); padding: var(--space-16); position: relative; }
    .name { padding-right: 40px; }
    .actions { position: absolute; top: var(--space-16); right: var(--space-12); padding: 0; }
    .mobile-label { display: block; margin-bottom: 4px; }
    .field-input { border-color: var(--border); }
  }
</style>
