<script lang="ts">
  import { parseMarkdown, type Inline } from '$lib/markdown';
  import { launch } from '$lib/launch.svelte';

  interface Props {
    source: string;
    /** Takes a link instead of the default browser - the Browser module's reader keeps it in the panel. */
    onlink?: (href: string) => void;
  }

  let { source, onlink }: Props = $props();

  /** Tokens, not HTML: see `markdown.ts` for why nothing here is `{@html}`. */
  const blocks = $derived(parseMarkdown(source));

  let copied = $state(-1);

  async function copy(text: string, index: number): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied = index;
      setTimeout(() => {
        if (copied === index) copied = -1;
      }, 1200);
    } catch {
      // The webview can refuse clipboard writes while it is not the foreground
      // window; the text is still selectable.
    }
  }

  /** Links open in the default browser, never inside the widget, unless `onlink` takes them. */
  function follow(event: MouseEvent, href: string): void {
    event.preventDefault();
    if (onlink) onlink(href);
    else void launch(href, 'url');
  }
</script>

{#snippet inline(tokens: Inline[])}{#each tokens as token, i (i)}{#if token.kind === 'code'}<code>{token.text}</code>{:else if token.kind === 'bold'}<strong>{token.text}</strong>{:else if token.kind === 'italic'}<em>{token.text}</em>{:else if token.kind === 'link'}<a href={token.href} title={token.href} onclick={(e) => follow(e, token.href)}>{token.text}</a>{:else}{token.text}{/if}{/each}{/snippet}

<div class="md">
  {#each blocks as block, index (index)}
    {#if block.kind === 'para'}
      <p>{@render inline(block.inlines)}</p>
    {:else if block.kind === 'heading'}
      <p class="heading">{@render inline(block.inlines)}</p>
    {:else if block.kind === 'code'}
      <div class="code">
        <div class="code-bar">
          <span>{block.lang}</span>
          <button onclick={() => copy(block.text, index)}>{copied === index ? 'Copied' : 'Copy'}</button>
        </div>
        <pre><code>{block.text}</code></pre>
      </div>
    {:else if block.kind === 'list'}
      {#if block.ordered}
        <ol>{#each block.items as item, j (j)}<li>{@render inline(item)}</li>{/each}</ol>
      {:else}
        <ul>{#each block.items as item, j (j)}<li>{@render inline(item)}</li>{/each}</ul>
      {/if}
    {:else if block.kind === 'quote'}
      <blockquote>{@render inline(block.inlines)}</blockquote>
    {:else if block.kind === 'table'}
      <div class="table">
        <table>
          <thead>
            <tr>{#each block.header as cell, j (j)}<th>{@render inline(cell)}</th>{/each}</tr>
          </thead>
          <tbody>
            {#each block.rows as row, r (r)}
              <tr>{#each row as cell, j (j)}<td>{@render inline(cell)}</td>{/each}</tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if block.kind === 'rule'}
      <hr />
    {/if}
  {/each}
</div>

<style>
  .md {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    user-select: text;
    cursor: text;
  }

  p,
  li,
  blockquote {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .heading {
    font-weight: 600;
  }

  ul,
  ol {
    margin: 0;
    padding-left: 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  blockquote {
    padding-left: 8px;
    border-left: 2px solid color-mix(in oklab, var(--accent, #7aa2f7) 60%, transparent);
    color: var(--panel-fg-muted);
  }

  code {
    font-family: var(--mono-font, 'Cascadia Code', Consolas, ui-monospace, monospace);
    font-size: 0.92em;
    padding: 0 3px;
    border-radius: calc(4px * var(--round, 1));
    background: color-mix(in oklab, var(--color-gray-100, #333) 55%, transparent);
  }

  .code {
    border-radius: calc(7px * var(--round, 1));
    overflow: hidden;
    background: color-mix(in oklab, var(--color-gray-100, #222) 65%, transparent);
  }

  .code-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 7px;
    font-size: calc(9.5px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
  }

  .code-bar button {
    font-size: calc(9.5px * var(--text-scale, 1));
    color: var(--panel-fg-muted);
    cursor: pointer;
    padding: 0;
  }

  .code-bar button:hover {
    color: var(--panel-fg);
  }

  pre {
    margin: 0;
    padding: 2px 8px 7px;
    overflow-x: auto;
    font-size: calc(11px * var(--text-scale, 1));
    line-height: 1.45;
  }

  pre code {
    padding: 0;
    background: transparent;
    white-space: pre;
  }

  a {
    color: color-mix(in oklab, var(--accent, #7aa2f7) 85%, var(--panel-fg));
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .table {
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    font-size: calc(11px * var(--text-scale, 1));
  }

  th,
  td {
    padding: 2px 6px;
    text-align: left;
    border-bottom: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 25%, transparent);
  }

  hr {
    width: 100%;
    border: 0;
    border-top: 1px solid color-mix(in oklab, var(--color-gray-300, #666) 30%, transparent);
  }
</style>
