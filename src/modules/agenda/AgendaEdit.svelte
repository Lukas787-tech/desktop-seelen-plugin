<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '../Modal.svelte';
  import { config } from '$lib/config.svelte';
  import { REPEATS, isValidDateKey, toDateKey, type AgendaEvent, type Repeat } from '$lib/agenda';
  import { AGENDA_COLOURS, agenda } from '$lib/agenda-store.svelte';
  import { newId } from '$lib/ids';

  type Props = {
    /** The event to edit, or null to make a new one. */
    eventId: string | null;
    /** The day a new event starts on. */
    date?: string;
    onclose: () => void;
  };

  let { eventId, date, onclose }: Props = $props();

  // A snapshot taken as the dialog opens: an edit arriving from the other
  // display while this is open must not rewrite the fields under the cursor.
  const existing = untrack(() => agenda.events.find((e) => e.id === eventId) ?? null);
  const defaultRemind = untrack(() => config.current.agendaDefaultRemind);

  let title = $state(existing?.title ?? '');
  let day = $state(existing?.date ?? untrack(() => date) ?? toDateKey(new Date()));
  let allDay = $state(existing ? existing.time === null : false);
  let time = $state(existing?.time ?? '09:00');
  let duration = $state(existing?.duration ? String(existing.duration) : '');
  let repeat = $state<Repeat>(existing?.repeat ?? 'none');
  let until = $state(existing?.until ?? '');
  let remind = $state(existing ? (existing.remind === null ? 'none' : String(existing.remind)) : defaultRemind);
  let colour = $state(existing?.colour ?? 'blue');
  let note = $state(existing?.note ?? '');
  let problem = $state<string | null>(null);

  const DURATIONS = [
    ['', 'No end time'],
    ['15', '15 min'],
    ['30', '30 min'],
    ['45', '45 min'],
    ['60', '1 hour'],
    ['90', '1½ hours'],
    ['120', '2 hours'],
    ['180', '3 hours'],
    ['240', '4 hours'],
    ['480', 'All day long'],
  ] as const;

  const REMINDERS = [
    ['none', 'No reminder'],
    ['0', 'At the start'],
    ['5', '5 minutes before'],
    ['10', '10 minutes before'],
    ['15', '15 minutes before'],
    ['30', '30 minutes before'],
    ['60', '1 hour before'],
    ['120', '2 hours before'],
    ['1440', 'A day before'],
  ] as const;

  function save(event: SubmitEvent) {
    event.preventDefault();
    const name = title.trim();
    if (!name) return void (problem = 'Give it a name.');
    if (!isValidDateKey(day)) return void (problem = 'That date is not valid.');
    if (repeat !== 'none' && until && until < day) return void (problem = 'It cannot stop repeating before it starts.');

    const saved: AgendaEvent = {
      id: existing?.id ?? newId('event'),
      title: name,
      date: day,
      time: allDay ? null : time,
      duration: allDay || !duration ? null : Number(duration),
      repeat,
      until: repeat === 'none' || !until ? null : until,
      colour,
      remind: remind === 'none' ? null : Number(remind),
      note: note.trim(),
      updatedAt: Date.now(),
    };
    agenda.save(saved);
    onclose();
  }

  function remove() {
    if (existing) agenda.remove(existing.id);
    onclose();
  }
</script>

<Modal title={existing ? 'Edit event' : 'New event'} {onclose} width={400}>
  <form class="form" onsubmit={save}>
    <input class="title" bind:value={title} placeholder="What" aria-label="Title" />

    <div class="row">
      <label class="field">
        <span>Date</span>
        <input type="date" bind:value={day} required />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={allDay} />
        All day
      </label>
    </div>

    {#if !allDay}
      <div class="row">
        <label class="field">
          <span>Starts</span>
          <input type="time" bind:value={time} required />
        </label>
        <label class="field">
          <span>Lasts</span>
          <select bind:value={duration}>
            {#each DURATIONS as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
        </label>
      </div>
    {/if}

    <div class="row">
      <label class="field">
        <span>Repeats</span>
        <select bind:value={repeat}>
          {#each REPEATS as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>
      {#if repeat !== 'none'}
        <label class="field">
          <span>Until</span>
          <input type="date" bind:value={until} />
        </label>
      {/if}
    </div>

    <label class="field">
      <span>Reminder</span>
      <select bind:value={remind}>
        {#each REMINDERS as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>

    <div class="colours" role="radiogroup" aria-label="Colour">
      {#each Object.entries(AGENDA_COLOURS) as [name, value] (name)}
        <button
          type="button"
          class="swatch"
          class:on={colour === name}
          role="radio"
          aria-checked={colour === name}
          aria-label={name}
          style:background={value}
          onclick={() => (colour = name)}
        ></button>
      {/each}
    </div>

    <textarea bind:value={note} rows="3" placeholder="Notes" aria-label="Notes"></textarea>

    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}

    <div class="buttons">
      {#if existing}
        <button type="button" class="danger" onclick={remove}>
          {existing.repeat === 'none' ? 'Delete' : 'Delete every time'}
        </button>
      {/if}
      <span class="spacer"></span>
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>
</Modal>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  input,
  select,
  textarea {
    padding: 6px 8px;
    font: inherit;
    font-size: calc(12px * var(--text-scale, 1));
    border-radius: calc(8px * var(--round, 1));
    color: var(--panel-fg);
    background: color-mix(in oklab, var(--color-gray-100, #333) 50%, transparent);
  }

  .title {
    font-size: calc(14px * var(--text-scale, 1));
  }

  textarea {
    resize: vertical;
  }

  .row {
    display: flex;
    gap: 10px;
    align-items: flex-end;
  }

  .field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .field span {
    font-size: calc(10px * var(--text-scale, 1));
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--panel-fg-muted);
  }

  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-bottom: 6px;
    font-size: calc(12px * var(--text-scale, 1));
    cursor: pointer;
  }

  .colours {
    display: flex;
    gap: 6px;
  }

  .swatch {
    width: 20px;
    height: 20px;
    border-radius: calc(999px * var(--round, 1));
    cursor: pointer;
    outline: 2px solid transparent;
    outline-offset: 2px;
  }

  .swatch.on {
    outline-color: var(--panel-fg);
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
