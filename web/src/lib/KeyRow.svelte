<script>
  import { convert } from "@shared/placeholders.js";
  import { app, keyUrl } from "./model.svelte.js";
  import { printfSegments, hasTokens } from "./tokens.js";
  import TokenField from "./ui/TokenField.svelte";
  import KeyName from "./ui/KeyName.svelte";
  import StatusBadge from "./ui/StatusBadge.svelte";
  import Icon from "./ui/Icon.svelte";

  let { row } = $props();

  const previews = $derived(hasTokens(row.base) ? [
    ["iOS", convert(row.base, "ios", row.base)],
    ["Android", convert(row.base, "android", row.base)],
  ] : []);
  const targetTone = $derived(row.status === "missing" ? "missing" : row.status === "review" ? "review" : "filled");

  let armed = $state(false);
  let disarm;
  async function remove() {
    if (!armed) {
      armed = true;
      disarm = setTimeout(() => (armed = false), 3000);
      return;
    }
    clearTimeout(disarm);
    await app.run("DELETE", keyUrl(row.key), null, `„${row.key}“ gelöscht.`);
  }

  const save = (lang) => (value) => app.run("PATCH", keyUrl(row.key), { lang, value });
  const rename = (next) => app.mutate("PATCH", keyUrl(row.key), { rename: next });
</script>

<div class={["row", row.status]} role="row" data-key={row.key}>
  <div class="cell key" role="cell">
    <KeyName name={row.key} onrename={rename} />
  </div>

  <div class="cell base" role="cell">
    <span class="mobile-label label">{app.langName(app.base)}</span>
    <TokenField value={row.base} label={`${row.key}: Text in ${app.langName(app.base)}`} placeholder="Basistext fehlt" onsave={save(app.base)} />
    {#if previews.length}
      <dl class="preview">
        {#each previews as [platform, text]}
          <dt>{platform}</dt>
          <dd>{#each printfSegments(text) as s}{#if s.token}<b>{s.text}</b>{:else}{s.text}{/if}{/each}</dd>
        {/each}
      </dl>
    {/if}
    {#each row.baseProblems as p}<p class="warn"><Icon name="alert" size={14} />{p}</p>{/each}
  </div>

  {#if app.target}
    <div class="cell target" role="cell">
      <span class="mobile-label label">{app.langName(app.target)}</span>
      <TokenField
        value={row.target}
        tone={targetTone}
        label={`${row.key}: Übersetzung in ${app.langName(app.target)}`}
        placeholder="Übersetzung fehlt – hier tippen"
        onsave={save(app.target)}
      />
      {#each row.problems as p}<p class="warn"><Icon name="alert" size={14} />{p}</p>{/each}
    </div>
    <div class="cell status" role="cell"><StatusBadge status={row.status} /></div>
  {/if}

  <div class="cell actions" role="cell">
    <button
      type="button"
      class={["delete", armed && "armed"]}
      aria-label={armed ? `„${row.key}“ wirklich löschen` : `„${row.key}“ löschen`}
      title={armed ? "Nochmal klicken zum Löschen" : "Key löschen"}
      onclick={remove}
      onblur={() => (armed = false)}
    >
      <Icon name="trash" size={16} />{#if armed}<span>Löschen?</span>{/if}
    </button>
  </div>
</div>

<style>
  .row {
    display: grid; grid-template-columns: var(--cols); gap: var(--space-20);
    padding: var(--space-12) var(--space-12) var(--space-12) var(--space-20);
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
    align-items: start;
  }
  .row:last-child { border-bottom: 0; }
  .cell { min-width: 0; }
  .key { padding-left: 0; }
  .status { padding-top: 9px; }
  .actions { padding-top: 4px; display: flex; justify-content: flex-end; }
  .mobile-label { display: none; }

  .preview {
    display: grid; grid-template-columns: auto 1fr; gap: 2px 10px;
    margin: 6px 10px 2px; font: 500 12px/16px var(--font-mono); color: var(--text-subtle);
  }
  .preview dt, .preview dd { margin: 0; }
  .preview dd { overflow-wrap: anywhere; }
  .preview b { font-weight: 500; color: var(--token); }

  .warn {
    display: flex; gap: 6px; align-items: center;
    margin: 6px 10px 0; font-size: 13px; line-height: 18px; color: var(--token);
  }

  .delete {
    display: inline-flex; align-items: center; gap: 6px; height: 32px; min-width: 32px; padding: 0 8px;
    justify-content: center; border: 1px solid transparent; border-radius: var(--radius-sm);
    background: transparent; color: var(--text-subtle); font-size: 13px; font-weight: 500;
  }
  .delete:hover { color: var(--danger); background: var(--danger-soft); }
  .delete.armed { color: var(--danger); background: var(--danger-soft); border-color: var(--danger); }

  @media (max-width: 760px) {
    .row {
      grid-template-columns: 1fr auto; gap: var(--space-8) var(--space-12);
      grid-template-areas: "key actions" "status status" "base base" "target target";
      padding: var(--space-16);
    }
    .key { grid-area: key; }
    .actions { grid-area: actions; }
    .status { grid-area: status; padding-top: 0; }
    .base { grid-area: base; }
    .target { grid-area: target; }
    .mobile-label { display: block; margin: 4px 0 4px; }
  }
</style>
