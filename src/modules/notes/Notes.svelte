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
    font-size: calc(11px * var(--text-scale, 1));
    border-radius: calc(6px * var(--round, 1));
    background: transparent;
    color: var(--panel-fg-muted);
    cursor: pointer;
  }

  .tabs button.active {
    background: color-mix(in oklab, var(--color-gray-300, #666) 26%, transparent);
    color: var(--panel-fg);
  }

  .badge {
    font-size: calc(10px * var(--text-scale, 1));
    opacity: 0.75;
  }

  input:not([type]),
  textarea {
    width: 100%;
    padding: 6px 8px;
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    border-radius: calc(8px * var(--round, 1));
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
    font-size: calc(12px * var(--text-scale, 1));
    padding: 2px 0;
  }

  li.empty {
    color: var(--panel-fg-muted);
    font-size: calc(11px * var(--text-scale, 1));
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
    font-size: calc(15px * var(--text-scale, 1));
    line-height: 1;
    padding: 0 4px;
    opacity: 0;
    translate: 4px 0;
    transition:
      opacity var(--dur-fast) var(--ease),
      translate var(--dur) var(--ease-move),
      color var(--dur-fast) var(--ease);
  }

  li:hover .remove {
    opacity: 1;
    translate: 0 0;
  }

  .remove:hover {
    color: var(--panel-fg);
  }

  /* A new todo rises into the list. */
  li {
    animation: fx-rise var(--dur-slow) var(--ease) backwards;
    animation-delay: var(--lag, 0ms);
  }

  .clear {
    flex: none;
    background: transparent;
    color: var(--panel-fg-muted);
    font-size: calc(11px * var(--text-scale, 1));
    cursor: pointer;
    text-align: left;
  }
</style>
