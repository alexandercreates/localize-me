<script>
  import { onMount, tick } from "svelte";
  import { app } from "./lib/model.svelte.js";
  import Sidebar from "./lib/Sidebar.svelte";
  import TopBar from "./lib/TopBar.svelte";
  import ProgressHero from "./lib/ProgressHero.svelte";
  import WelcomeHero from "./lib/WelcomeHero.svelte";
  import QuickAdd from "./lib/QuickAdd.svelte";
  import Filters from "./lib/Filters.svelte";
  import KeyTable from "./lib/KeyTable.svelte";
  import ExportDrawer from "./lib/ExportDrawer.svelte";
  import Icon from "./lib/ui/Icon.svelte";

  let searchInput = $state();
  let keyInput = $state();
  let langCodeInput = $state();
  let main = $state();

  onMount(() => {
    app.load().then(() => { if (!app.keyNames.length) keyInput?.focus(); });
    return app.connect();
  });

  function shortcuts(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    }
  }

  async function addLanguage() {
    app.addLangOpen = true;
    await tick();
    langCodeInput?.focus();
  }

  // Nach „Fehlende übersetzen“ direkt ins erste passende Feld springen.
  async function focusFirst() {
    await tick();
    const field = main?.querySelector(".table [role=row] .target textarea");
    field?.scrollIntoView({ block: "center", behavior: "smooth" });
    field?.focus({ preventScroll: true });
  }

  const shortFile = $derived((app.project?.file || "").split(/[\\/]/).slice(-2).join("/"));
</script>

<svelte:window onkeydown={shortcuts} />

<div class="shell">
  <Sidebar bind:codeInput={langCodeInput} />

  <main bind:this={main}>
    {#if app.project}
      <TopBar bind:searchInput onaddlanguage={addLanguage} />
      {#if app.keyNames.length}
        <ProgressHero onfocusmissing={focusFirst} onaddlanguage={addLanguage} />
      {:else}
        <WelcomeHero />
      {/if}
      <QuickAdd bind:keyInput />
      {#if app.keyNames.length}<Filters />{/if}
      <KeyTable />
      <p class={["status", app.connection]}>
        <span class="dot"></span>
        <span>
          {#if app.connection === "lost"}
            Keine Verbindung zum Server. Läuft localize-me noch im Terminal?
          {:else}
            Gespeichert in <span class="mono">{shortFile}</span> · Änderungen von außen (z. B. git pull) erscheinen sofort
          {/if}
        </span>
      </p>
    {:else if app.connection === "lost"}
      <div class="loading">Keine Verbindung zum Server. Läuft localize-me noch im Terminal?</div>
    {:else}
      <div class="loading" aria-busy="true">Lade Texte …</div>
    {/if}
  </main>
</div>

<ExportDrawer />

{#if app.toast}
  {#key app.toast.id}
    <div class={["toast", app.toast.kind]} role={app.toast.kind === "error" ? "alert" : "status"}>
      <Icon name={app.toast.kind === "error" ? "alert" : "check"} size={16} />
      <span>{app.toast.text}</span>
      <button type="button" aria-label="Hinweis schließen" onclick={() => (app.toast = null)}><Icon name="x" size={14} /></button>
    </div>
  {/key}
{/if}

<style>
  .shell { display: grid; grid-template-columns: 264px minmax(0, 1fr); min-height: 100dvh; }
  main {
    display: flex; flex-direction: column; gap: var(--space-24);
    padding: 32px 40px 48px; max-width: 1280px; width: 100%;
  }
  .status { display: flex; align-items: center; gap: var(--space-8); margin: 0; font-size: 13px; line-height: 18px; color: var(--text-muted); }
  .status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); flex: none; align-self: flex-start; margin-top: 6px; }
  .status.lost { color: var(--danger); }
  .status.lost .dot { background: var(--danger); }
  .loading { padding: 80px 0; text-align: center; color: var(--text-muted); }

  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 10;
    display: flex; align-items: center; gap: 10px; max-width: min(560px, calc(100vw - 32px));
    padding: 10px 10px 10px 14px; border-radius: var(--radius-lg);
    background: var(--bg-inverse); color: var(--text-on-inverse); box-shadow: var(--shadow-overlay);
    font-size: 13px; line-height: 18px; animation: rise var(--dur-med) var(--ease-out);
  }
  .toast.ok :global(svg:first-child) { color: var(--accent); }
  .toast.error { background: var(--danger); color: #fff; }
  .toast button { display: grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: var(--radius-sm); background: transparent; color: inherit; opacity: 0.7; }
  .toast button:hover { opacity: 1; }
  @keyframes rise { from { opacity: 0; transform: translate(-50%, 8px); } }

  @media (max-width: 960px) {
    .shell { grid-template-columns: 1fr; }
    main { padding: 24px 16px 40px; }
  }
</style>
