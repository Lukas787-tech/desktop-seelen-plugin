<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { ownMonitorId } from '$lib/windows.svelte';
  import {
    createWorkspace,
    destroyWorkspace,
    renameWorkspace,
    switchWorkspace,
    virtualDesktops,
    workspaceLabel,
    workspacesOf,
  } from '$lib/workspaces.svelte';

  const cfg = $derived(config.current);

  $effect(() => virtualDesktops.acquire());

  const own = ownMonitorId();
  const entries = $derived(workspacesOf(virtualDesktops.current, own));

  /** The workspace being renamed, and the text in the field. */
  let editing = $state<string | null>(null);
  let draft = $state('');

  function startRename(id: string, current: string) {
    editing = id;
    draft = current;
  }

  function commitRename() {
    if (editing) renameWorkspace(editing, draft);
    editing = null;
  }

  function onRenameKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editing = null;
    }
  }

  /**
   * Focus the field as soon as it exists.
   *
   * Rename is a two-step affordance - press the pencil, then type - and without
   * this the second step needs a click of its own.
   */
  function autofocus(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

<div class="m-body" data-no-drag>
  <ul class="m-list">
    {#each entries as entry (entry.workspace.id)}
      {@const name = workspaceLabel(entry, cfg.workspacesShowNames)}
      <li>
        {#if editing === entry.workspace.id}
          <div class="m-row editing">
            <span class="m-glyph">{entry.index}</span>
            <input
              class="rename"
              value={draft}
              placeholder="Desktop {entry.index}"
              aria-label="Rename this desktop"
              use:autofocus
              oninput={(e) => (draft = e.currentTarget.value)}
              onkeydown={onRenameKey}
              onblur={commitRename}
            />
          </div>
        {:else}
          <div class="m-row" class:m-active={entry.active}>
            <button
              class="switch"
              aria-current={entry.active ? 'true' : undefined}
              title="Switch to {name}"
              onclick={() => switchWorkspace(entry.workspace.id)}
              ondblclick={() => cfg.workspacesShowControls && startRename(entry.workspace.id, name)}
            >
              <span class="m-glyph">{entry.index}</span>
              <span class="m-text"><span class="m-title">{name}</span></span>
            </button>

            {#if cfg.workspacesShowCounts}
              <span class="m-pill" title="{entry.workspace.windows.length} windows">
                {entry.workspace.windows.length}
              </span>
            {/if}

            {#if cfg.workspacesShowControls}
              <button
                class="m-quiet"
                aria-label="Rename {name}"
                title="Rename"
                onclick={() => startRename(entry.workspace.id, entry.workspace.name ?? '')}
              >
                &#9998;
              </button>
              <button
                class="m-quiet"
                aria-label="Remove {name}"
                title={entries.length > 1 ? 'Remove' : 'A display keeps at least one desktop'}
                disabled={entries.length < 2}
                onclick={() => destroyWorkspace(entry.workspace.id)}
              >
                &times;
              </button>
            {/if}
          </div>
        {/if}
      </li>
    {:else}
      <li class="m-empty">
        No workspaces reported for this display. Seelen's virtual desktops are per monitor.
      </li>
    {/each}
  </ul>

  {#if cfg.workspacesShowControls}
    <div class="m-actions">
      <button class="m-btn" disabled={!own} onclick={() => own && createWorkspace(own)}>
        Add desktop
      </button>
      {#if entries.length < 2}
        <span class="m-sub">Windows move between desktops from Seelen's own shortcuts.</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* The row is the frame; the button inside is the switch, so the rename and
     remove affordances beside it stay separately clickable. */
  .switch {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .m-row:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
  }

  .m-row.m-active:hover {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 34%, transparent);
  }

  .rename {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
  }

  .editing {
    gap: 8px;
  }

  .m-actions {
    margin-top: auto;
    gap: 8px;
    min-width: 0;
  }

  .m-actions .m-sub {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
