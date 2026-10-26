<script>
  import { convert } from "@shared/placeholders.js";
  import { CATEGORY_LABELS, categoriesFor, countCandidates, countOf, withCount } from "@shared/plurals.js";
  import { app, keyUrl, ONLY_LABELS } from "./model.svelte.js";
  import { printfSegments, hasTokens } from "./tokens.js";
  import TokenField from "./ui/TokenField.svelte";
  import KeyName from "./ui/KeyName.svelte";
  import StatusBadge from "./ui/StatusBadge.svelte";
  import Icon from "./ui/Icon.svelte";

  let { row } = $props();

  const previews = $derived(hasTokens(row.base) ? [
    ["iOS", convert(row.base, "ios", row.base), "ios"],
    ["Android", convert(row.base, "android", row.base), "android"],
  ].filter(([, , p]) => !row.only || row.only === p) : []);
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

  const save = (lang, form) => (value) => app.run("PATCH", keyUrl(row.key), { lang, value, form });
  const rename = (next) => app.mutate("PATCH", keyUrl(row.key), { rename: next });
  const chooseOnly = (e) => app.run("PATCH", keyUrl(row.key), { only: e.currentTarget.value });

  // Bei mehreren Zahlen wählen, nach welcher sich die Form richtet („3 von 1 Platz“ → #required).
  const baseForms = $derived(row.plural ? row.values[app.base] || {} : {});
  const candidates = $derived(row.plural ? countCandidates(baseForms) : []);
  const chooseCount = (e) => save(app.base, "other")(withCount(baseForms.other, e.currentTarget.value));

  // Zurück zum einfachen Text behält nur die Form „other“ – gehen dabei Formen verloren, erst nachfragen.
  const formsLost = $derived(row.plural && Object.values(row.values).some((forms) => Object.keys(forms).some((c) => c !== "other")));
  let pluralArmed = $state(false);
  let pluralDisarm;
  async function togglePlural() {
    if (row.plural && formsLost && !pluralArmed) {
      pluralArmed = true;
      pluralDisarm = setTimeout(() => (pluralArmed = false), 3000);
      return;
    }
    clearTimeout(pluralDisarm);
    pluralArmed = false;
    await app.run("PATCH", keyUrl(row.key), { plural: !row.plural });
  }
</script>

{#snippet forms(lang, kind)}
  {@const values = row.values[lang] || {}}
  <div class="forms">
    {#each categoriesFor(lang) as c (c)}
      <div class="form">
        <span class="form-label" title={`CLDR-Kategorie ${c}`}>{CATEGORY_LABELS[c]} <span class="mono">{c}</span></span>
        <TokenField
          value={values[c] || ""}
          tone={kind === "target" ? (values[c] ? (row.status === "review" ? "review" : "filled") : "missing") : "plain"}
          label={`${row.key}, Form ${c}: ${kind === "target" ? "Übersetzung in" : "Text in"} ${app.langName(lang)}`}
          placeholder={kind === "target" ? "Fehlt – hier tippen" : c === "other" ? "#count:int …" : "Fehlt"}
          onsave={save(lang, c)}
        />
      </div>
    {/each}
  </div>
{/snippet}

<div class={["row", row.status]} role="row" data-key={row.key}>
  <div class="cell key" role="cell">
    <KeyName name={row.key} onrename={rename} />
    <button
      type="button"
      class={["plural-toggle", row.plural && "on", pluralArmed && "armed"]}
      aria-pressed={row.plural}
      title={row.plural ? "Wieder ein einfacher Text (behält die Form „andere“)" : "Text je nach Anzahl (eins, andere, …)"}
      onclick={togglePlural}
      onblur={() => (pluralArmed = false)}
    >
      {pluralArmed ? "Formen verwerfen?" : "Plural"}
    </button>
    <select
      class={["only-pick", row.only && "on"]}
      value={row.only}
      aria-label={`${row.key}: Plattform`}
      title="Für welche App der Text exportiert wird"
      onchange={chooseOnly}
    >
      {#each Object.entries(ONLY_LABELS) as [value, label]}<option {value}>{label}</option>{/each}
    </select>
  </div>

  <div class="cell base" role="cell">
    <span class="mobile-label label">{app.langName(app.base)}</span>
    {#if row.plural}
      {@render forms(app.base, "base")}
      {#if candidates.length > 1}
        <label class="count-pick">
          Form richtet sich nach
          <select value={countOf(baseForms)} onchange={chooseCount}>
            {#each candidates as name}<option value={name}>#{name}</option>{/each}
          </select>
        </label>
      {/if}
    {:else}
      <TokenField value={row.base} label={`${row.key}: Text in ${app.langName(app.base)}`} placeholder="Basistext fehlt" onsave={save(app.base)} />
    {/if}
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
      {#if row.plural}
        {@render forms(app.target, "target")}
      {:else}
        <TokenField
          value={row.target}
          tone={targetTone}
          label={`${row.key}: Übersetzung in ${app.langName(app.target)}`}
          placeholder="Übersetzung fehlt – hier tippen"
          onsave={save(app.target)}
        />
      {/if}
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
  .key { padding-left: 0; display: flex; flex-direction: column; align-items: flex-start; }
  .status { padding-top: 9px; }
  .actions { padding-top: 4px; display: flex; justify-content: flex-end; }
  .mobile-label { display: none; }

  .plural-toggle {
    margin: 4px 0 0 10px; padding: 1px 8px; border: 1px solid var(--border); border-radius: var(--radius-full);
    background: transparent; color: var(--text-subtle); font-size: 12px; line-height: 18px; font-weight: 500;
  }
  .plural-toggle:hover { border-color: var(--border-strong); color: var(--text); }
  .plural-toggle.on { background: var(--token-soft); border-color: transparent; color: var(--token); }
  .plural-toggle.armed { background: var(--danger-soft); border-color: var(--danger); color: var(--danger); }
  /* Bei normalen Keys erst beim Überfahren zeigen, damit lange Listen ruhig bleiben. */
  .only-pick {
    margin: 4px 0 0 10px; padding: 1px 8px; border: 1px solid var(--border); border-radius: var(--radius-full);
    background: transparent; color: var(--text-subtle); font-size: 12px; line-height: 18px; font-weight: 500;
    appearance: none; cursor: pointer;
  }
  .only-pick:hover { border-color: var(--border-strong); color: var(--text); }
  .only-pick:focus-visible { outline: none; border-color: var(--text); box-shadow: var(--ring); }
  .only-pick.on { background: var(--token-soft); border-color: transparent; color: var(--token); }
  @media (hover: hover) {
    .row:not(:hover):not(:focus-within) .plural-toggle:not(.on),
    .row:not(:hover):not(:focus-within) .only-pick:not(.on) { visibility: hidden; }
  }

  .count-pick {
    display: flex; align-items: center; gap: 8px; margin: 6px 10px 0;
    font-size: 12px; line-height: 16px; color: var(--text-muted);
  }
  .count-pick select {
    height: 26px; padding: 0 6px; border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--bg-surface); color: var(--token); font: 500 12px/16px var(--font-mono);
  }
  .count-pick select:focus { outline: none; border-color: var(--text); box-shadow: var(--ring); }
  .forms { display: flex; flex-direction: column; gap: 4px; }
  .form-label { display: block; margin: 2px 10px 0; font-size: 12px; line-height: 16px; color: var(--text-muted); }
  .form-label .mono { color: var(--text-subtle); }

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
