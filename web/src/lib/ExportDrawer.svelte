<script>
  import { buildCsv, csvFilename } from "@shared/csv.js";
  import { app, prefs } from "./model.svelte.js";
  import { printfSegments } from "./tokens.js";
  import Icon from "./ui/Icon.svelte";
  import Button from "./ui/Button.svelte";

  const PLATFORMS = [
    { value: "ios", label: "iOS", icon: "apple", note: "%@ · %lld · %f – mehrere positionsbezogen (%1$@)" },
    { value: "android", label: "Android", icon: "android", note: "%s · %d · %f – mehrere positionsbezogen (%1$s)" },
    { value: "raw", label: "Neutral", icon: "hash", note: "Platzhalter bleiben als #name in der Datei" },
  ];
  const PREVIEW_ROWS = 6;

  let dialog = $state();
  let platform = $state(prefs.get("platform", "ios"));
  let delimiter = $state(prefs.get("delim", ";"));
  let scope = $state(prefs.get("scope", "pair"));
  let copied = $state(false);

  $effect(() => { prefs.set("platform", platform); prefs.set("delim", delimiter); prefs.set("scope", scope); });

  $effect(() => {
    if (app.exportOpen && !dialog.open) dialog.showModal();
    if (!app.exportOpen && dialog.open) dialog.close();
  });

  const allLangs = $derived([app.base, ...app.others.map((l) => l.code)]);
  const langs = $derived(scope === "pair" && app.target ? [app.base, app.target] : allLangs);
  const filename = $derived(csvFilename(langs, platform));
  const lines = $derived(app.project ? buildCsv(app.project, { platform, languages: langs, delimiter, bom: false }).trimEnd().split("\r\n") : []);
  const missing = $derived(langs.slice(1).reduce((n, code) => n + app.keyNames.filter((k) => !(app.project.keys[k][code] || "").trim()).length, 0));
  const href = $derived("/api/export?" + new URLSearchParams({ platform, delimiter, langs: langs.join(",") }));
  const cli = $derived(`npx localize-me export --platform ${platform}` +
    (scope === "pair" && app.target ? ` --langs ${langs.join(",")}` : "") +
    (delimiter === "," ? " --delimiter ," : ""));

  // Zeile hervorheben: Platzhalter violett, leere Werte orange.
  function parts(line) {
    return line.split(/("")/).flatMap((chunk) => chunk === '""' ? [{ text: chunk, empty: true }] : printfSegments(chunk));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(cli);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      app.notify("Kopieren nicht möglich – markiere den Befehl von Hand.", "error");
    }
  }
</script>

<dialog bind:this={dialog} class="drawer" aria-labelledby="export-title" onclose={() => (app.exportOpen = false)} onclick={(e) => e.target === dialog && dialog.close()}>
  <div class="panel">
    <header>
      <div>
        <h2 id="export-title">CSV exportieren</h2>
        <p>{app.keyNames.length} Keys · {langs.map((c) => app.langName(c)).join(" → ")}</p>
      </div>
      <button type="button" class="close" aria-label="Schließen" onclick={() => dialog.close()}><Icon name="x" size={18} /></button>
    </header>

    <div class="body">
      <fieldset>
        <legend class="label">Plattform</legend>
        <div class="segmented">
          {#each PLATFORMS as p}
            <label class={[platform === p.value && "on"]}>
              <input type="radio" name="platform" value={p.value} bind:group={platform} class="sr-only" />
              <Icon name={p.icon} size={16} />{p.label}
            </label>
          {/each}
        </div>
        <p class="note">Platzhalter: {PLATFORMS.find((p) => p.value === platform).note}</p>
      </fieldset>

      {#if app.target && app.others.length > 1}
        <fieldset>
          <legend class="label">Spalten</legend>
          <div class="options">
            <label class={["option", scope === "pair" && "on"]}>
              <input type="radio" name="scope" value="pair" bind:group={scope} />
              <span><strong>Basis + Zielsprache</strong><span class="mono">key ; {app.base} ; {app.target}</span></span>
            </label>
            <label class={["option", scope === "all" && "on"]}>
              <input type="radio" name="scope" value="all" bind:group={scope} />
              <span><strong>Alle Sprachen</strong><span class="mono">key ; {allLangs.join(" ; ")}</span></span>
            </label>
          </div>
        </fieldset>
      {/if}

      <fieldset>
        <legend class="label">Trennzeichen</legend>
        <div class="segmented">
          <label class={[delimiter === ";" && "on"]}><input type="radio" name="delim" value=";" bind:group={delimiter} class="sr-only" />; Semikolon – Excel DE</label>
          <label class={[delimiter === "," && "on"]}><input type="radio" name="delim" value="," bind:group={delimiter} class="sr-only" />, Komma</label>
        </div>
      </fieldset>

      <section aria-label="Vorschau">
        <h3 class="label">Vorschau</h3>
        <div class="code">
          <div class="filebar"><Icon name="file" size={14} /><span class="mono name">{filename}</span><span class="mono enc">UTF-8 · BOM</span></div>
          <pre>{#each lines.slice(0, PREVIEW_ROWS) as line, i}<span class={["line", i === 0 && "header"]}>{#each parts(line) as p}{#if p.empty}<span class="empty">{p.text}</span>{:else if p.token}<span class="ph">{p.text}</span>{:else}{p.text}{/if}{/each}</span>
{/each}{#if lines.length > PREVIEW_ROWS}<span class="more">… und {lines.length - PREVIEW_ROWS} weitere Zeilen</span>{/if}</pre>
        </div>
      </section>

      {#if missing}
        <p class="callout"><Icon name="alert" size={16} />{missing === 1 ? "1 Text fehlt" : `${missing} Texte fehlen`} noch und {missing === 1 ? "wird" : "werden"} leer exportiert.</p>
      {/if}
    </div>

    <footer>
      <Button variant="primary" {href} download={filename} icon="download" class="wide" onclick={() => app.notify("CSV wird heruntergeladen.")}>CSV herunterladen</Button>
      <button type="button" class="cli" onclick={copy} title="Befehl kopieren">
        <Icon name={copied ? "check" : "terminal"} size={14} /><span class="mono">{copied ? "Kopiert" : cli}</span>
      </button>
    </footer>
  </div>
</dialog>

<style>
  .drawer {
    margin: 0 0 0 auto; padding: 0; border: 0; height: 100dvh; max-height: 100dvh;
    width: min(480px, 100vw); max-width: 100vw;
    background: var(--bg-surface); color: var(--text); box-shadow: var(--shadow-overlay);
  }
  .drawer[open] { animation: slide-in var(--dur-med) var(--ease-out); }
  .drawer::backdrop { background: rgb(8 9 8 / 0.45); animation: fade var(--dur-med) ease; }
  @keyframes slide-in { from { transform: translateX(24px); opacity: 0; } }
  @keyframes fade { from { opacity: 0; } }

  .panel { display: flex; flex-direction: column; height: 100%; }
  header { display: flex; align-items: flex-start; gap: var(--space-12); padding: 24px 28px; border-bottom: 1px solid var(--border); }
  header div { flex: 1; }
  h2 { margin: 0; font-size: 22px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em; }
  header p { margin: 4px 0 0; font-size: 13px; line-height: 18px; color: var(--text-muted); }
  .close { display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: var(--radius-md); background: var(--bg-sunken); color: var(--text); }
  .close:hover { background: var(--border); }

  .body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 28px; padding: 28px; }
  fieldset { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  legend, h3 { padding: 0; margin: 0 0 10px; }
  .note { margin: 0; font-size: 13px; line-height: 18px; color: var(--text-muted); }

  .segmented { display: flex; gap: 4px; padding: 4px; border-radius: var(--radius-md); background: var(--bg-sunken); }
  .segmented label {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 8px 10px; border-radius: var(--radius-sm); cursor: pointer;
    font-size: 13px; line-height: 18px; font-weight: 500; color: var(--text-muted); text-align: center;
  }
  .segmented label:hover { color: var(--text); }
  .segmented label.on { background: var(--bg-surface); color: var(--text); box-shadow: 0 1px 3px rgb(0 0 0 / 0.08); }
  .segmented label:has(:focus-visible) { outline: 2px solid var(--text); outline-offset: 1px; }

  .options { display: flex; flex-direction: column; gap: 8px; }
  .option {
    display: flex; align-items: center; gap: 12px; padding: 12px 14px; cursor: pointer;
    border: 1px solid var(--border); border-radius: 12px; background: var(--bg-surface);
  }
  .option.on { border: 1.5px solid var(--accent-text); background: var(--accent-soft); }
  .option input { accent-color: var(--accent-text); width: 18px; height: 18px; margin: 0; }
  .option > span { display: flex; flex-direction: column; gap: 2px; }
  .option strong { font-weight: 500; }
  .option .mono { font-size: 12px; line-height: 16px; color: var(--text-muted); }

  .code { border-radius: var(--radius-lg); overflow: hidden; background: var(--sidebar-bg); color: var(--sidebar-text); }
  .filebar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--sidebar-item); color: var(--sidebar-muted); }
  .filebar .name { flex: 1; color: var(--sidebar-text); font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .filebar .enc { font-size: 12px; }
  pre { margin: 0; padding: 12px 14px; font: 400 12px/22px var(--font-mono); overflow-x: auto; }
  .line { white-space: pre; }
  .header { color: var(--accent); }
  .ph { color: #a996ff; }
  .empty { color: #ff8a3d; }
  .more { color: var(--sidebar-muted); }

  .callout {
    display: flex; gap: 10px; align-items: flex-start; margin: 0; padding: 12px 14px;
    border-radius: 12px; background: var(--missing-soft); font-size: 13px; line-height: 18px;
  }
  .callout :global(svg) { color: var(--missing); margin-top: 1px; }

  footer { display: flex; flex-direction: column; gap: 12px; padding: 20px 28px; border-top: 1px solid var(--border); }
  footer :global(.wide) { width: 100%; }
  .cli {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: 0; background: transparent; color: var(--text-subtle); font-size: 12px; padding: 4px;
    border-radius: var(--radius-sm);
  }
  .cli:hover { color: var(--text); background: var(--bg-sunken); }
</style>
