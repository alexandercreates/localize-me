<script>
  import { app } from "./model.svelte.js";

  const steps = $derived([
    { title: "Key anlegen", text: "Ein Name wie onboarding.title und der Text in " + app.langName(app.base) + ".", done: app.keyNames.length > 0 },
    { title: "Sprache hinzufügen", text: "z. B. en – Englisch. Fehlende Texte werden markiert.", done: app.others.length > 0 },
    { title: "CSV exportieren", text: "Für iOS oder Android, Platzhalter werden umgewandelt.", done: false },
  ]);
  const current = $derived(steps.findIndex((s) => !s.done));
</script>

<section class="hero" aria-label="Erste Schritte">
  <span class="eyebrow label">Neues Projekt · localize.json angelegt</span>
  <h1>Los geht's.</h1>
  <p class="sub">Drei Schritte – dann liegen deine Texte als CSV bereit für Xcode und Android Studio.</p>
  <ol class="steps">
    {#each steps as s, i}
      <li class={[i === current && "current", s.done && "done"]} aria-current={i === current ? "step" : undefined}>
        <span class="num mono">{s.done ? "✓" : i + 1}</span>
        <strong>{s.title}</strong>
        <span class="text">{s.text}</span>
      </li>
    {/each}
  </ol>
</section>

<style>
  .hero {
    display: flex; flex-direction: column; gap: var(--space-16);
    padding: var(--space-32); border-radius: var(--radius-xl);
    background: var(--emphasis-bg); color: var(--emphasis-text);
  }
  .eyebrow { color: var(--accent); }
  h1 { margin: 0; font: 700 56px/60px var(--font-display); letter-spacing: -0.02em; }
  .sub { margin: 0 0 var(--space-8); color: var(--sidebar-muted); }
  .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-12); }
  li {
    display: flex; flex-direction: column; gap: 10px; padding: 16px 18px;
    border-radius: var(--radius-lg); background: var(--emphasis-item); border: 1.5px solid transparent;
  }
  li.current { border-color: var(--accent); }
  .num {
    display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%;
    background: var(--sidebar-bg); color: var(--sidebar-muted); font-size: 12px; font-weight: 500;
  }
  .current .num, .done .num { background: var(--accent); color: var(--text-on-accent); }
  strong { font-size: 17px; line-height: 24px; font-weight: 600; }
  li:not(.current) strong { opacity: 0.7; }
  .text { font-size: 13px; line-height: 18px; color: var(--sidebar-muted); }

  @media (max-width: 760px) {
    .hero { padding: var(--space-24); }
    h1 { font-size: 44px; line-height: 48px; }
    .steps { grid-template-columns: 1fr; }
  }
</style>
