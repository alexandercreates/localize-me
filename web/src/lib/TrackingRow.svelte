<script>
  import { app, trackingUrl } from "./model.svelte.js";
  import KeyName from "./ui/KeyName.svelte";
  import Icon from "./ui/Icon.svelte";

  let { section, name, item } = $props();

  const url = $derived(trackingUrl(section, name));
  const rename = (next) => app.mutate("PATCH", url, { name: next });

  function saveDescription(e) {
    const value = e.currentTarget.value.trim();
    if (value !== (item.description || "")) app.run("PATCH", url, { description: value });
  }
  function descriptionKey(e) {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
    if (e.key === "Escape") { e.currentTarget.value = item.description || ""; e.currentTarget.blur(); }
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
    await app.run("DELETE", url, null, `„${name}“ gelöscht.`);
  }
</script>

<div class="row" role="row" data-name={name}>
  <div class="cell name" role="cell"><KeyName {name} onrename={rename} /></div>

  <div class="cell" role="cell">
    <span class="mobile-label label">Beschreibung</span>
    <input
      class="description"
      value={item.description || ""}
      placeholder="Beschreibung ergänzen"
      autocomplete="off"
      aria-label={`${name}: Beschreibung`}
      onblur={saveDescription}
      onkeydown={descriptionKey}
    />
  </div>

  <div class="cell actions" role="cell">
    <button
      type="button"
      class={["delete", armed && "armed"]}
      aria-label={armed ? `„${name}“ wirklich löschen` : `„${name}“ löschen`}
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

  .description {
    width: 100%; height: 38px; padding: 0 8px; font-size: 14px;
    border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text);
  }
  .description::placeholder { color: var(--text-subtle); }
  .description:hover { background: var(--bg-sunken); }
  .description:focus { outline: none; background: var(--bg-surface); border-color: var(--text); box-shadow: var(--ring); }

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
    .description { border-color: var(--border); }
  }
</style>
