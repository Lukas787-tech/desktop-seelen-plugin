<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '../Modal.svelte';
  import { asUrl, nameFor } from '$lib/links';
  import { links } from '$lib/links.svelte';

  type Props = {
    /** The link to edit, or null to add one. */
    linkId: string | null;
    onclose: () => void;
  };

  let { linkId, onclose }: Props = $props();

  const existing = untrack(() => links.file.data.links.find((l) => l.id === linkId) ?? null);

  let title = $state(existing?.title ?? '');
  let address = $state(existing?.url ?? '');
  let problem = $state<string | null>(null);

  function save(event: SubmitEvent) {
    event.preventDefault();
    const url = asUrl(address);
    if (!url) {
      problem = 'That does not look like a web address.';
      return;
    }
    const name = title.trim() || nameFor(url);
    if (existing) links.update(existing.id, { title: name, url });
    else links.add(name, url);
    onclose();
  }

  function remove() {
    if (existing) links.remove(existing.id);
    onclose();
  }
</script>

<Modal title={existing ? 'Edit link' : 'Add a link'} {onclose} width={360}>
  <form class="form" onsubmit={save}>
    <label class="field">
      <span>Address</span>
      <input bind:value={address} placeholder="example.com" aria-label="Address" oninput={() => (problem = null)} />
    </label>
    <label class="field">
      <span>Name</span>
      <input bind:value={title} placeholder={asUrl(address) ? nameFor(asUrl(address) as string) : 'Optional'} aria-label="Name" />
    </label>
    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    <div class="buttons">
      {#if existing}<button type="button" class="danger" onclick={remove}>Remove</button>{/if}
      <span class="spacer"></span>
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary">{existing ? 'Save' : 'Add'}</button>
    </div>
  </form>
</Modal>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .field span {
    font-size: calc(10px * var(--text-scale, 1));
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--panel-fg-muted);
  }

  input {
    padding: 6px 8px;
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    border-radius: calc(8px * var(--round, 1));
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-100, #333) 50%, transparent);
  }

  .problem {
    font-size: calc(12px * var(--text-scale, 1));
    color: var(--color-red-700, #f77);
  }

  .buttons {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .spacer {
    flex: 1;
  }

  .buttons button {
    padding: 6px 12px;
    font-size: calc(12px * var(--text-scale, 1));
    border-radius: calc(8px * var(--round, 1));
    cursor: pointer;
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-300, #666) 22%, transparent);
  }

  .buttons button:hover {
    background: color-mix(in oklab, var(--color-gray-300, #666) 38%, transparent);
  }

  .buttons .primary {
    background: color-mix(in oklab, var(--accent, #7aa2f7) 60%, transparent);
  }

  .buttons .danger {
    color: var(--color-red-700, #f77);
  }
</style>
