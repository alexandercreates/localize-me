<script>
  import { app } from "./model.svelte.js";
  import Button from "./ui/Button.svelte";

  let { onfocusmissing, onaddlanguage } = $props();

  const t = $derived(app.totals);
  const done = $derived(t.done + t.review);
  // Bis 24 Keys ein Segment pro Key, darüber ein durchgehender Balken.
  const segmented = $derived(t.all <= 24);
  const complete = $derived(t.missing === 0 && t.review === 0);
  // Segmente füllen sich von links: erst übersetzt, dann zu prüfen, dann fehlend.
  const ORDER = { done: 0, review: 1, missing: 2 };
  const segments = $derived(app.rows.map((r) => r.status).sort((a, b) => ORDER[a] - ORDER[b]));

  function show(filter) {
    app.resetFilters();
    app.filter = filter;
    onfocusmissing?.(filter);
  }
</script>

<section class="hero" aria-label="Fortschritt">
  {#if !app.target}
    <div class="main">
      <span class="eyebrow label">Nur Basissprache</span>
      <h1><span class="big">{t.all}</span> <span class="rest">{t.all === 1 ? "Key" : "Keys"} in {app.langName(app.base)}</span></h1>
      <p class="sub">Leg eine Zielsprache an, dann siehst du hier, wie weit die Übersetzung ist.</p>
    </div>
    <div class="side"><Button variant="primary" icon="plus" onclick={onaddlanguage}>Sprache hinzufügen</Button></div>
  {:else}
    <div class="main">
      <span class="eyebrow label">Fortschritt · {app.langName(app.target)}</span>
      {#if complete}
        <h1><span class="big">Alles übersetzt.</span></h1>
      {:else}
        <h1><span class="big">{done} von {t.all}</span> <span class="rest">Texten übersetzt</span></h1>
      {/if}
      {#if segmented}
        <div class="segments" role="img" aria-label={`${done} von ${t.all} übersetzt`}>
          {#each segments as status}<i class={status}></i>{/each}
        </div>
      {:else}
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={t.all} aria-valuenow={done} aria-label="Übersetzt">
          <i style:width={`${(done / t.all) * 100}%`}></i>
        </div>
      {/if}
    </div>
    <div class="side">
      <dl class="stats">
        <div class="missing"><dt>fehlen</dt><dd>{t.missing}</dd></div>
        <div class="review"><dt>prüfen</dt><dd>{t.review}</dd></div>
        <div><dt>Keys gesamt</dt><dd>{t.all}</dd></div>
      </dl>
      {#if t.missing}
        <Button variant="primary" icon="arrowRight" onclick={() => show("missing")}>Fehlende übersetzen</Button>
      {:else if t.review}
        <Button variant="primary" icon="arrowRight" onclick={() => show("review")}>Konflikte prüfen</Button>
      {:else}
        <Button variant="primary" icon="download" onclick={() => (app.exportOpen = true)}>CSV exportieren</Button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .hero {
    display: flex; align-items: center; gap: var(--space-32); flex-wrap: wrap;
    padding: var(--space-32); border-radius: var(--radius-xl);
    background: var(--emphasis-bg); color: var(--emphasis-text);
  }
  .main { flex: 1 1 360px; display: flex; flex-direction: column; gap: var(--space-16); min-width: 0; }
  .eyebrow { color: var(--accent); }
  h1 { margin: 0; display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; font-weight: inherit; }
  .big { font: 700 56px/60px var(--font-display); letter-spacing: -0.02em; }
  .rest { font: 600 22px/28px var(--font-ui); letter-spacing: -0.01em; opacity: 0.6; }
  .sub { margin: 0; color: var(--sidebar-muted); }

  .segments { display: flex; gap: 6px; }
  .segments i { flex: 1; height: 10px; border-radius: 5px; background: var(--emphasis-item); }
  .segments i.done { background: var(--accent); }
  .segments i.review { background: var(--token); }
  .bar { height: 10px; border-radius: 5px; background: var(--emphasis-item); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--accent); transition: width var(--dur-med) var(--ease-out); }

  .side { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-12); }
  .stats { display: flex; gap: var(--space-8); margin: 0; }
  .stats > div { min-width: 104px; padding: 12px 16px; border-radius: var(--radius-lg); background: var(--emphasis-item); display: flex; flex-direction: column-reverse; }
  .stats dt { font-size: 13px; line-height: 18px; color: var(--sidebar-muted); }
  .stats dd { margin: 0; font: 700 28px/32px var(--font-display); }
  .stats .missing dd { color: var(--missing); }
  .stats .review dd { color: var(--token); }

  @media (max-width: 760px) {
    .hero { padding: var(--space-24); gap: var(--space-24); }
    .big { font-size: 44px; line-height: 48px; }
    .side { align-items: stretch; width: 100%; }
    .stats > div { flex: 1; min-width: 0; }
  }
</style>
