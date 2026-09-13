/**
 * The assistant's pure parts: request shapes for all four wires, the stream
 * assembler that turns fragments into tool calls, the Markdown reader, the
 * file merge between display replicas, the router and the approval rule.
 *
 * Run with `npm test`, which bundles each module with esbuild first so this
 * exercises the shipped TypeScript. The Ollama fixture is a real stream,
 * captured from gemma4:12b on Ollama 0.33.3.
 */
import { buildRequest, repairTurns } from '../../.test/wire.mjs';
import { StreamAssembler, sseFrames, ndjsonFrames, describeFailure, decodeWhole } from '../../.test/stream.mjs';
import { parseMarkdown, parseInline } from '../../.test/markdown.mjs';
import { migrate, mergeFiles, emptyFile, messagesToTurns } from '../../.test/assistant-state.mjs';
import { planRoute } from '../../.test/routing.mjs';
import { PROVIDERS } from '../../.test/providers.mjs';
import { needsApproval } from '../../.test/tool.mjs';
import { calculate, parseSearchResults } from '../../.test/web.mjs';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};

const call = { id: 'c1', name: 'get_weather', args: { city: 'Berlin' } };
const transcript = [
  { role: 'user', text: 'weather?', images: ['data:image/png;base64,QUJD'] },
  { role: 'assistant', text: '', calls: [call] },
  { role: 'tool', results: [{ call, result: { tempC: 18 } }] },
];
const base = { model: 'm', system: 'sys', turns: transcript, tools: [{ name: 'get_weather', description: 'd' }], stream: true, maxTokens: 100 };

// ------------------------------------------------------------------ requests
{
  const r = buildRequest({ ...base, wire: 'ollama', base: 'http://h:1', numCtx: 16384, keepAlive: '30m', think: true, temperature: null });
  check('ollama goes to /api/chat', r.url, 'http://h:1/api/chat');
  check('ollama carries num_ctx and no unset temperature', r.body.options, { num_ctx: 16384, num_predict: 100 });
  check('ollama keeps the model loaded', r.body.keep_alive, '30m');
  check('ollama sends images as bare base64', r.body.messages[1].images, ['QUJD']);
  check('ollama sends tool arguments as an object', r.body.messages[2].tool_calls[0].function.arguments, { city: 'Berlin' });
  check('ollama names the tool on its result', [r.body.messages[3].role, r.body.messages[3].tool_name], ['tool', 'get_weather']);
  const plain = buildRequest({ ...base, wire: 'ollama', base: 'http://h:1', think: null });
  check('ollama leaves think alone when unset', 'think' in plain.body, false);
}
{
  const r = buildRequest({ ...base, wire: 'openai', base: 'https://x/v1' });
  check('openai arguments are a JSON string', r.body.messages[2].tool_calls[0].function.arguments, '{"city":"Berlin"}');
  check('openai result is a tool message', [r.body.messages[3].role, r.body.messages[3].tool_call_id], ['tool', 'c1']);
  check('openai image is an image_url part', r.body.messages[1].content[1].type, 'image_url');
}
{
  const turns = [...transcript, { role: 'user', text: 'and tomorrow?' }];
  const r = buildRequest({ ...base, turns, wire: 'anthropic', base: 'https://a/v1' });
  check('anthropic merges tool results with the next user text', r.body.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  check('anthropic result then text in one message', r.body.messages[2].content.map((b) => b.type), ['tool_result', 'text']);
  const g = buildRequest({ ...base, turns, wire: 'gemini', base: 'https://g' });
  check('gemini wraps the result in an object', g.body.contents[2].parts[0].functionResponse.response, { result: '{"tempC":18}' });
}
{
  const repaired = repairTurns([{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'let me look', calls: [call] }]);
  check('a stopped call gets a result', repaired.map((t) => t.role), ['user', 'assistant', 'tool']);
  check('which says it was stopped', /stopped/.test(repaired[2].results[0].result.error), true);
}

// ------------------------------------------------------------------- streams
const body = (text, chunk = 7) =>
  new ReadableStream({
    start(c) {
      const bytes = new TextEncoder().encode(text);
      for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
      c.close();
    },
  });
const collect = async (gen) => {
  const out = [];
  for await (const f of gen) out.push(f);
  return out;
};

{
  const frames = await collect(sseFrames(body('event: a\r\ndata: {"x":1}\r\n\r\n: keepalive\n\ndata: [DONE]\n\n')));
  check('sse frames survive CRLF and split chunks', frames, [{ event: 'a', data: '{"x":1}' }, { event: '', data: '[DONE]' }]);
}
{
  const a = new StreamAssembler('openai');
  const chunks = [
    { choices: [{ delta: { content: 'Look' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'get_', arguments: '{"ci' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'weather', arguments: 'ty":"Oslo"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ];
  for (const c of chunks) a.push({ event: '', data: JSON.stringify(c) });
  const d = a.finish();
  check('openai fragments assemble into one call', d.calls, [{ id: 'call_a', name: 'get_weather', args: { city: 'Oslo' } }]);
  check('openai prose streams alongside', [d.text, d.stop], ['Look', 'tool_calls']);
}
{
  const a = new StreamAssembler('anthropic');
  const ev = (event, data) => a.push({ event, data: JSON.stringify(data) });
  ev('message_start', { message: { usage: { input_tokens: 12 } } });
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Sure' } });
  ev('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'calculate' } });
  ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"expres' } });
  ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: 'sion":"2+2"}' } });
  ev('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } });
  const d = a.finish();
  check('anthropic partial JSON assembles', d.calls, [{ id: 'tu_1', name: 'calculate', args: { expression: '2+2' } }]);
  check('anthropic usage is read', [d.usage.inputTokens, d.usage.outputTokens], [12, 9]);
  check('anthropic stream error surfaces', a.push({ event: 'error', data: '{"error":{"message":"overloaded"}}' }).error, 'overloaded');
}
{
  const a = new StreamAssembler('gemini');
  a.push({ event: '', data: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hmm', thought: true }, { functionCall: { name: 'get_time', args: {} }, thoughtSignature: 'sig' }] } }] }) });
  const d = a.finish();
  check('gemini thought parts are reasoning', d.thinking, 'hmm');
  check('gemini keeps the call signature', [d.calls[0].name, d.calls[0].signature], ['get_time', 'sig']);
}
{
  const captured = [
    '{"model":"gemma4:12b","message":{"role":"assistant","content":"","thinking":"The user"},"done":false}',
    '{"model":"gemma4:12b","message":{"role":"assistant","content":"","thinking":" wants weather."},"done":false}',
    '{"model":"gemma4:12b","message":{"role":"assistant","content":"","tool_calls":[{"id":"call_lmuigihk","function":{"index":0,"name":"get_weather","arguments":{"city":"Berlin"}}}]},"done":false}',
    '{"model":"gemma4:12b","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":75,"eval_count":75,"eval_duration":1821179000}',
  ].join('\n');
  const a = new StreamAssembler('ollama');
  for await (const f of ndjsonFrames(body(captured, 13))) a.push(f);
  const d = a.finish();
  check('ollama reasoning streams', d.thinking, 'The user wants weather.');
  check('ollama whole tool call is read', d.calls, [{ id: 'call_lmuigihk', name: 'get_weather', args: { city: 'Berlin' } }]);
  check('ollama speed is measured', d.usage.tokensPerSecond, 41.2);
  check('ollama in-stream error surfaces', new StreamAssembler('ollama').push({ event: '', data: '{"error":"model not found"}' }).error, 'model not found');
}
{
  const d = decodeWhole('anthropic', { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 't', name: 'n', input: { a: 1 } }], stop_reason: 'tool_use' });
  check('a whole anthropic reply decodes like a stream', [d.text, d.calls[0].args], ['hi', { a: 1 }]);
  check('failure text prefers the service message', describeFailure(429, '{"error":{"message":"slow down"}}'), 'slow down');
  check('an html error page falls back to the status', describeFailure(502, '<html>bad gateway</html>'), 'Request failed (502).');
}

// ------------------------------------------------------------------ markdown
{
  const blocks = parseMarkdown('Hi **there**\n\n- one\n- two `x`\n\n```js\nlet a = 1;');
  check('markdown block kinds', blocks.map((b) => b.kind), ['para', 'list', 'code']);
  check('an unclosed fence is still code', blocks[2], { kind: 'code', lang: 'js', text: 'let a = 1;' });
  check('inline tokens', parseInline('a **b** [c](https://d.e) `f`').map((t) => t.kind), ['text', 'bold', 'text', 'link', 'text', 'code']);
  check('no javascript links', parseInline('[x](javascript:alert(1))').every((t) => t.kind === 'text'), true);
  check('snake_case is not italic', parseInline('get_system_status').map((t) => t.kind), ['text']);
  const table = parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')[0];
  check('tables parse', [table.kind, table.rows.length, table.header.length], ['table', 1, 2]);
}

// --------------------------------------------------------------------- state
{
  const v1 = migrate({ version: 1, keys: { gemini: 'k' }, messages: [{ id: 'a', role: 'user', text: 'hello there' }, { id: 'b', role: 'assistant', text: 'hi' }] });
  check('a v1 file becomes one conversation', [v1.conversations.length, v1.conversations[0].title, v1.keys.gemini], [1, 'hello there', 'k']);
  check('defaults fill new preferences', [v1.prefs.numCtx, v1.prefs.toolGroups.web], [16384, true]);

  const disk = emptyFile();
  disk.conversations = [{ id: 'x', title: 'x', createdAt: 1, updatedAt: 5, messages: [] }, { id: 'gone', title: '', createdAt: 1, updatedAt: 1, messages: [] }];
  disk.prefsAt = 10;
  disk.prefs.maxSteps = 3;
  const mine = emptyFile();
  mine.conversations = [{ id: 'x', title: 'x-old', createdAt: 1, updatedAt: 2, messages: [] }, { id: 'y', title: 'y', createdAt: 1, updatedAt: 9, messages: [] }];
  mine.deleted = ['gone'];
  mine.prefsAt = 4;
  const merged = mergeFiles(disk, mine);
  check('merge keeps both replicas’ conversations, newest first', merged.conversations.map((c) => c.id), ['y', 'x']);
  check('merge keeps the newer edit', merged.conversations[1].title, 'x');
  check('merge honours a deletion', merged.conversations.some((c) => c.id === 'gone'), false);
  check('merge takes the newer preferences', merged.prefs.maxSteps, 3);
}
{
  const c1 = { id: 'k1', name: 'list_windows', args: {} };
  const turns = messagesToTurns(
    [
      { id: '1', role: 'user', at: 0, text: 'what is open' },
      { id: '2', role: 'assistant', at: 0, text: 'Two', parts: [{ kind: 'thinking', text: 'hm' }, { kind: 'tool', call: c1, label: '', status: 'done', result: { n: 2 } }, { kind: 'text', text: 'Two windows.' }] },
    ],
    30,
  );
  check('a reply replays as rounds', turns.map((t) => t.role), ['user', 'assistant', 'tool', 'assistant']);
  check('reasoning is not replayed', turns.some((t) => JSON.stringify(t).includes('"hm"')), false);
}

// ------------------------------------------------------------------- routing
{
  const input = (over) => ({
    prompt: 'how is my battery',
    configured: 'gemini',
    configuredModel: '',
    providers: PROVIDERS,
    usable: (id) => ['ollama', 'gemini', 'openai'].includes(id),
    isLocal: (id) => id === 'ollama' || id === 'lmstudio',
    localModel: (id) => (id === 'ollama' ? 'gemma4:12b' : null),
    pcEnabled: true,
    routing: true,
    privacy: 'normal',
    ...over,
  });
  check('about this PC answers locally first', planRoute(input({})).map((c) => c.provider), ['ollama', 'gemini', 'openai']);
  check('local-only never queues a cloud service', planRoute(input({ privacy: 'local-only', prompt: 'write a long essay about trade-offs' })).map((c) => c.provider), ['ollama']);
  check('routing off is the configured service alone', planRoute(input({ routing: false })).map((c) => c.provider), ['gemini']);
  check('a local service with no model is skipped', planRoute(input({ localModel: () => null })).map((c) => c.provider), ['gemini', 'openai']);
}

// ------------------------------------------------------------------ approval
{
  const ask = (over) => needsApproval({ risk: 'act', autonomy: 'ask-risky', alwaysAllowed: false, sensitive: false, local: true, tainted: false, ...over });
  check('reads never ask', ask({ risk: 'read', autonomy: 'ask-all' }), false);
  check('ask-risky lets reversible actions run', ask({}), false);
  check('ask-risky stops for danger', ask({ risk: 'danger' }), true);
  check('ask-all stops for any action', ask({ autonomy: 'ask-all' }), true);
  check('never-ask runs danger', ask({ risk: 'danger', autonomy: 'auto' }), false);
  check('but not after a web page was read', ask({ risk: 'danger', autonomy: 'auto', tainted: true }), true);
  check('personal data to a cloud model asks', ask({ risk: 'read', sensitive: true, local: false }), true);
}

// ---------------------------------------------------------------------- web
{
  check('calculator precedence', calculate('2 + 3 * 4 ^ 2'), 50);
  check('calculator functions', calculate('sqrt(16) + max(1, 7) - -1'), 12);
  check('calculator percent', calculate('200 * 15%'), 30);
  let threw = false;
  try {
    calculate('alert(1)');
  } catch {
    threw = true;
  }
  check('calculator refuses code', threw, true);
  const page = '1.[**Seelen** UI](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fseelen.io%2F&rut=a)\nDownload **Seelen** free.\nseelen.io\n\n2.[Ad](https://duckduckgo.com/y.js?ad=1)\nbuy\nx.com';
  check('search results parse and ads drop', parseSearchResults(page), [{ title: 'Seelen UI', url: 'https://seelen.io/', snippet: 'Download Seelen free.' }]);
}

console.log(failures ? `\n${failures} FAILED` : '\nall assistant checks passed');
process.exit(failures ? 1 : 0);
