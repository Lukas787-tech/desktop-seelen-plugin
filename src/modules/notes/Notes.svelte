<script lang="ts">
  import { config } from '$lib/config.svelte';
  import { notes } from '$lib/notes.svelte';

  const cfg = $derived(config.current);

  // Which tab the panel opens on is a setting; switching afterwards is not.
  let tab = $state<'todo' | 'note'>(config.current.notesDefaultTab);
  let draft = $state('');

  const remaining = $derived(notes.state.todos.filter((t) => !t.done).length);
  const listed = $derived(
    cfg.notesHideCompleted ? notes.state.todos.filter((t) => !t.done) : notes.state.todos,
  );

  function submit(event: SubmitEvent) {
    event.preventDefault();
    notes.addTodo(draft);
    draft = '';
  }
</script>

<div class="notes" data-no-drag>
  <nav class="tabs">
    <button class:active={tab === 'todo'} onclick={() => (tab = 'todo')}>
      Todo {#if remaining}<span class="badge">{remaining}</span>{/if}
    </button>
    <button class:active={tab === 'note'} onclick={() => (tab = 'note')}>Note</button>
  </nav>

  {#if tab === 'todo'}
    <form onsubmit={submit}>
      <input
        bind:value={draft}
        placeholder="Add a task..."
        aria-label="New task"
      />
    </form>

    <ul>
      {#each listed as todo (todo.id)}
        <li class:done={todo.done}>
          <label>
            <input
              type="checkbox"
              checked={todo.done}
              onchange={() => notes.toggleTodo(todo.id)}
            />
            <span class="text">{todo.text}</span>
          </label>
          <button class="remove" onclick={() => notes.removeTodo(todo.id)} aria-label="Remove task">
            &times;
          </button>
        </li>
      {:else}
        <li class="empty">Nothing to do.</li>
      {/each}
    </ul>

    {#if notes.state.todos.some((t) => t.done)}
      <button class="clear" onclick={() => notes.clearCompleted()}>Clear completed</button>
    {/if}
  {:else}
    <textarea
      bind:value={notes.state.note}
      oninput={() => notes.save()}
      placeholder="Scratch notes..."
      aria-label="Notes"
    ></textarea>
  {/if}
</div>

<style>
  .notes {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    cursor: default;
  }

  .tabs {
    display: flex;
    gap: 4px;
    flex: none;
  }

  .tabs button {
    flex: 1;
    padding: 4px 6px;
    font-size: 11px;
    border-radius: 6px;
    background: transparent;
    color: var(--panel-fg-muted);
    cursor: pointer;
  }

  .tabs button.active {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
    color: var(--panel-fg);
  }

  .badge {
    font-size: 10px;
    opacity: 0.75;
  }

  input:not([type]),
  textarea {
    width: 100%;
    padding: 6px 8px;
    font: inherit;
    font-size: 12px;
    border-radius: 8px;
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-100, #333) 45%, transparent);
  }

  textarea {
    flex: 1;
    resize: none;
    line-height: 1.5;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  li {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    padding: 2px 0;
  }

  li.empty {
    color: var(--panel-fg-muted);
    font-size: 11px;
  }

  li label {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }

  li.done .text {
    text-decoration: line-through;
    color: var(--panel-fg-muted);
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .remove {
    background: transparent;
    color: var(--panel-fg-muted);
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    padding: 0 4px;
    opacity: 0;
  }

  li:hover .remove {
    opacity: 1;
  }

  .clear {
    flex: none;
    background: transparent;
    color: var(--panel-fg-muted);
    font-size: 11px;
    cursor: pointer;
    text-align: left;
  }
</style>
