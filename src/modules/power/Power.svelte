<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { SESSION_ACTIONS, runSessionAction, type SessionActionId } from '$lib/power.svelte';

  const cfg = $derived(config.current);

  /** The action waiting for a second click, when confirmation is on. */
  let pending = $state<SessionActionId | null>(null);

  const shown = $derived(
    SESSION_ACTIONS.filter((action) => {
      if (action.id === 'sleep') return cfg.powerShowSleep;
      if (action.id === 'hibernate') return cfg.powerShowHibernate;
      if (action.id === 'shutdown' || action.id === 'restart') return cfg.powerShowShutdown;
      return true;
    }),
  );

  const waiting = $derived(SESSION_ACTIONS.find((action) => action.id === pending) ?? null);

  function press(action: (typeof SESSION_ACTIONS)[number]) {
    // Everything here throws away unsaved work if it was a mis-click, so the
    // ones that end the session ask twice unless the user turned that off.
    if (action.confirm && cfg.powerConfirm) {
      pending = action.id;
      return;
    }
    runSessionAction(action.command);
  }
</script>

<div class="m-body" data-no-drag>
  {#if waiting}
    <div class="confirm">
      <p>{waiting.label} now?</p>
      <div class="m-actions">
        <button
          class="m-btn m-primary"
          onclick={() => {
            runSessionAction(waiting.command);
            pending = null;
          }}
        >
          {waiting.label}
        </button>
        <button class="m-btn" onclick={() => (pending = null)}>Cancel</button>
      </div>
    </div>
  {:else}
    <div class="grid">
      {#each shown as action (action.id)}
        <button class="m-btn" class:m-danger={action.confirm} onclick={() => press(action)}>
          {action.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(84px, 1fr));
    gap: 6px;
    align-content: start;
  }

  .grid button {
    padding: 8px 6px;
  }

  .confirm {
    display: flex;
    flex-direction: column;
    gap: 10px;
    justify-content: center;
    height: 100%;
  }

  .confirm p {
    font-size: 12px;
  }
</style>
