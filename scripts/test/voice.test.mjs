/**
 * The voice mode's pure parts: reading a reply aloud, cutting it while it
 * streams, cleaning what a recogniser heard, the audio maths, the end-of-speech
 * detector, and every engine's request shape.
 *
 * Run with `npm test`, which bundles each module with esbuild first so this
 * exercises the shipped TypeScript.
 */
import { speakable, lastSentenceEnd, SpeechChunker, cleanTranscript, approvalAnswer, guessLanguage, transcriptionPrompt } from '../../.test/speech.mjs';
import { encodeWav, wrapPcm16, resample, levelDb, normalise, bytesToBase64, base64ToBytes } from '../../.test/pcm.mjs';
import { Endpointer } from '../../.test/vad.mjs';
import {
  transcriptionRequest,
  readTranscription,
  speechRequest,
  geminiAudio,
  readVoices,
  voiceLanguage,
  pickVoice,
  chooseStt,
  chooseTts,
  audioModelFor,
  voiceLabel,
} from '../../.test/voice-engines.mjs';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};

// ------------------------------------------------------------ speaking text
{
  const reply = [
    '**CPU 25%**, see [docs](https://x.com/a) and https://www.example.com/page.',
    '',
    '```js',
    'const a = 1. b = 2.',
    '```',
    '- first item',
    '- second item',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '## Weather ☀️',
    'Done ✅.',
  ].join('\n');
  check('a reply is said without its Markdown, code or tables', speakable(reply), 'CPU 25%, see docs and example.com. first item. second item. Weather. Done.');
  check('an arrow is a pause, not a symbol', speakable('Downloads → Invoices'), 'Downloads, Invoices');
}
{
  const ordinal = 'Es ist der 13. September. Und';
  check('a German ordinal does not end a sentence', lastSentenceEnd(ordinal), 'Es ist der 13. September.'.length);
  check('an abbreviation does not end a sentence', lastSentenceEnd('Use e.g. this. Next'), 'Use e.g. this.'.length);
  check('a title does not end a sentence', lastSentenceEnd('Dr. Smith is in'), 0);
  check('a decimal still arriving does not end a sentence', lastSentenceEnd('It is 3.'), 0);
}
{
  const chunker = new SpeechChunker();
  const out = [];
  for (const delta of ['Hel', 'lo there. How ', 'are you? I am fine and this is a longer second sentence that goes on.', '\nSecond para.']) {
    out.push(...chunker.push(delta));
  }
  check('the first sentence goes at once', out, ['Hello there.']);
  out.push(...chunker.flush());
  check('later sentences gather into one piece', out, ['Hello there.', 'How are you? I am fine and this is a longer second sentence that goes on. Second para.']);
}
{
  const chunker = new SpeechChunker();
  const out = [...chunker.push("Here:\n```py\nprint('x. y. z')\n```\nDone. "), ...chunker.flush()];
  check('a code block split across the stream is never said', out, ['Here:', 'Done.']);
}
{
  const chunker = new SpeechChunker();
  const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
  const out = [...chunker.push(words), ...chunker.flush()];
  check('a sentence that never ends is cut to what a voice takes', out.every((piece) => piece.length <= 320) && out.length > 1, true);
  check('and nothing is lost in the cutting', out.join(' ').split(' ').length, 80);
}

// -------------------------------------------------------------- transcripts
check('a transcript said twice on two lines is said once', cleanTranscript("Wie geht's?\nWie geht's?"), "Wie geht's?");
check('a transcript repeated in one line is said once', cleanTranscript("Hallo. Wie geht's? Hallo. Wie geht's?"), "Hallo. Wie geht's?");
check('labels and quotes are removed', cleanTranscript('Transcript: "Hello there."'), 'Hello there.');
check('a model refusing silence heard nothing', cleanTranscript("I'm sorry, but I cannot fulfill this request. I am a text-based AI and cannot hear or process audio files."), '');
check('whisper silence markers are nothing', cleanTranscript('[BLANK_AUDIO]'), '');
check('a bracketed silence is nothing', cleanTranscript('(silence)'), '');
check('a real sentence about audio is kept', cleanTranscript('Can you turn the audio up?'), 'Can you turn the audio up?');

check('yes is yes', approvalAnswer('Yes, go ahead.'), 'yes');
check('ja klar is yes', approvalAnswer('Ja klar'), 'yes');
check('"don\'t do it" is no', approvalAnswer("Don't do it"), 'no');
check('nein, lieber nicht is no', approvalAnswer('Nein, lieber nicht.'), 'no');
check('always is always', approvalAnswer('Always allow that'), 'always');
check('anything else is not an answer', approvalAnswer('What?'), null);

check('German is recognised', guessLanguage('Wie wird das Wetter morgen in Berlin?'), 'de');
check('English is recognised', guessLanguage('What is the weather like tomorrow?'), 'en');
check('a set language is named to the recogniser', /in German\./.test(transcriptionPrompt('de')), true);

// -------------------------------------------------------------------- audio
{
  const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
  const view = new DataView(wav.buffer);
  check('a WAV has its header', [String.fromCharCode(...wav.slice(0, 4)), String.fromCharCode(...wav.slice(8, 12)), wav.length], ['RIFF', 'WAVE', 50]);
  check('a WAV says its rate and size', [view.getUint32(24, true), view.getUint16(34, true), view.getUint32(40, true)], [16000, 16, 6]);
  check('samples are clipped to 16 bits', [view.getInt16(46, true), view.getInt16(48, true)], [32767, -32768]);
  check('odd PCM bytes are dropped when wrapped', wrapPcm16(new Uint8Array(5), 24000).length, 48);
}
{
  const sine = (hz) => Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * hz * i) / 48000));
  const rms = (a) => Math.sqrt(a.slice(200, -200).reduce((s, x) => s + x * x, 0) / (a.length - 400));
  const voice = resample(sine(440), 48000, 16000);
  check('resampling keeps the length in time', voice.length, 16000);
  check('resampling keeps a voice-band tone', Math.abs(rms(voice) - Math.SQRT1_2) < 0.02, true);
  check('resampling filters out what would alias', rms(resample(sine(12000), 48000, 16000)) < 0.05, true);
  check('a full-scale sine is -3 dB', Math.round(levelDb(sine(440))), -3);
  check('silence is -100 dB', levelDb(new Float32Array(10)), -100);
  const quiet = normalise(Float32Array.from([0.1, -0.05]));
  check('a quiet clip is brought up, within limits', Array.from(quiet, (x) => Math.round(x * 100) / 100), [0.6, -0.3]);
  check('a loud clip is left alone', Array.from(normalise(Float32Array.from([0.95]))), [Float32Array.from([0.95])[0]]);
  check('base64 round-trips', Array.from(base64ToBytes(bytesToBase64(Uint8Array.from([0, 1, 254, 255])))), [0, 1, 254, 255]);
}

// ---------------------------------------------------------- end of speech
/** Plays `runs` of [dB, frames] at 20 ms a frame and returns what was detected, and when. */
const listen = (runs, options = {}, strict = false) => {
  const vad = new Endpointer({ pauseMs: 700, sensitivity: 'normal', ...options });
  const events = [];
  let t = 0;
  for (const [db, frames] of runs) {
    for (let i = 0; i < frames; i++, t += 20) {
      const event = vad.update(db, t, strict);
      if (event) events.push([event, t]);
    }
  }
  return events;
};
{
  const said = listen([[-62, 50], [-28, 40], [-62, 60]]);
  check('a sentence starts and ends', said.map(([e]) => e), ['start', 'end']);
  check('it starts 100 ms into the voice', said[0][1], 1080);
  check('it ends after the pause', said[1][1], 2480);
  check('a click is not speech', listen([[-62, 50], [-20, 3], [-62, 60]]), []);
  check('a cough starts and is discarded', listen([[-62, 50], [-25, 8], [-62, 60]]).map(([e]) => e), ['start', 'discard']);
  check('while the assistant talks, a short burst does not interrupt', listen([[-62, 50], [-28, 8], [-62, 20]], {}, true), []);
  check('while the assistant talks, a sustained voice does', listen([[-62, 50], [-28, 15]], {}, true).map(([e]) => e), ['start']);
  check('a long utterance is cut to what a recogniser takes', listen([[-62, 50], [-28, 75]], { maxSpeechMs: 1000 }).map(([e]) => e), ['start', 'cut']);
}

// ------------------------------------------------------------------ engines
{
  const wav = encodeWav(new Float32Array(4), 16000);
  const ollama = transcriptionRequest({ engine: 'ollama', base: 'http://h:1', model: 'gemma4:12b', key: '', wav, language: '', seconds: 2, numCtx: 16384, keepAlive: '30m', think: false });
  const body = JSON.parse(ollama.body);
  check('ollama transcribes through native chat', ollama.url, 'http://h:1/api/chat');
  check('ollama keeps the chat context so the model is not reloaded', body.options, { temperature: 0, num_ctx: 16384, num_predict: 92 });
  check('ollama hears the audio as an image attachment', body.messages[0].images, [bytesToBase64(wav)]);
  check('ollama is told not to think about it', [body.think, body.keep_alive, body.stream], [false, '30m', false]);

  const groq = transcriptionRequest({ engine: 'groq', base: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', key: 'k', wav, language: 'de', seconds: 2 });
  check('groq takes a multipart upload', [groq.url, groq.body instanceof FormData, groq.body.get('model'), groq.body.get('language'), groq.headers.authorization], ['https://api.groq.com/openai/v1/audio/transcriptions', true, 'whisper-large-v3-turbo', 'de', 'Bearer k']);
  const local = transcriptionRequest({ engine: 'server', base: 'http://127.0.0.1:8000/v1', model: 'whisper-1', key: '', wav, language: '', seconds: 1 });
  check('a keyless server gets no credential and no language', [local.headers.authorization, local.body.get('language')], [undefined, null]);

  const gemini = transcriptionRequest({ engine: 'gemini', base: 'https://g', model: 'gemini-2.5-flash', key: 'gk', wav, language: '', seconds: 1 });
  check('gemini hears inline WAV', [gemini.headers['x-goog-api-key'], JSON.parse(gemini.body).contents[0].parts[1].inlineData.mimeType], ['gk', 'audio/wav']);

  check('ollama transcripts are cleaned', readTranscription('ollama', { message: { content: 'Hallo.\nHallo.' } }), 'Hallo.');
  check('server transcripts are cleaned', readTranscription('server', { text: ' hi ' }), 'hi');
  check('gemini transcripts are read from parts', readTranscription('gemini', { candidates: [{ content: { parts: [{ text: 'Guten ' }, { text: 'Tag.' }] } }] }), 'Guten Tag.');
}
{
  const kokoro = speechRequest({ engine: 'server', base: 'http://127.0.0.1:8880/v1', model: 'kokoro', key: '', voice: 'af_heart', text: 'Hi', speed: 1 });
  check('a voice server gets the OpenAI speech shape', [kokoro.url, JSON.parse(kokoro.body)], ['http://127.0.0.1:8880/v1/audio/speech', { model: 'kokoro', input: 'Hi', voice: 'af_heart', response_format: 'wav' }]);
  check('a changed speed is sent', JSON.parse(speechRequest({ engine: 'openai', base: 'b', model: 'm', key: 'k', voice: 'coral', text: 'Hi', speed: 1.2 }).body).speed, 1.2);
  const gemini = speechRequest({ engine: 'gemini', base: 'https://g', model: 'gemini-2.5-flash-preview-tts', key: 'k', voice: 'Puck', text: 'Hallo', speed: 1 });
  check('gemini is asked for audio in a voice', JSON.parse(gemini.body).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
  const audio = geminiAudio({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: bytesToBase64(new Uint8Array(4)) } }] } }] });
  check('gemini PCM becomes a WAV at its rate', [audio.length, new DataView(audio.buffer).getUint32(24, true)], [48, 24000]);
}
{
  check('voice lists as strings', readVoices({ voices: ['af_heart', 'bf_emma'] }), ['af_heart', 'bf_emma']);
  check('voice lists as objects', readVoices([{ id: 'x' }, { voice_id: 'y' }]), ['x', 'y']);
  check('voice lists as data', readVoices({ data: [{ id: 'z' }] }), ['z']);
  check('voice languages from their ids', ['af_heart', 'bm_george', 'ff_siwis', 'df_victoria', 'de_DE-thorsten-high', 'alloy'].map(voiceLanguage), ['en', 'en', 'fr', 'de', 'de', null]);
  check('voices are named as people', ['af_heart', 'dm_martin', 'bm_george', 'alloy'].map(voiceLabel), ['Heart · American female', 'Martin · German male', 'George · British male', 'alloy']);
  const voices = ['af_heart', 'df_victoria', 'dm_martin'];
  check('German text gets a German voice', pickVoice(voices, 'de', { en: 'af_heart' }), 'df_victoria');
  check('the chosen German voice wins', pickVoice(voices, 'de', { de: 'dm_martin' }), 'dm_martin');
  check('a language with no voice falls back', pickVoice(voices, 'fr', { en: 'af_heart' }), 'af_heart');
}
{
  const ctx = (patch) => ({ privacy: 'local-only', hasKey: (id) => id === 'gemini', ollamaAudioModel: 'gemma4:12b', sttServer: false, ttsServer: false, ...patch });
  check('local-only listens with the Ollama model', chooseStt('auto', ctx()), 'ollama');
  check('local-only never falls back to a cloud recogniser', chooseStt('auto', ctx({ ollamaAudioModel: null })), null);
  check('a chosen cloud recogniser is refused under local-only', chooseStt('gemini', ctx()), null);
  check('without local-only the key is used', chooseStt('auto', ctx({ privacy: 'normal', ollamaAudioModel: null })), 'gemini');
  check('a configured speech server comes first', chooseStt('auto', ctx({ sttServer: true })), 'server');
  check('local-only with no voice server speaks with Windows', chooseTts('auto', ctx()), 'system');
  check('a voice server is preferred', chooseTts('auto', ctx({ ttsServer: true })), 'server');
  check('otherwise a cloud voice with a key', chooseTts('auto', ctx({ privacy: 'normal' })), 'gemini');
  const models = [{ name: 'a', capabilities: ['audio'] }, { name: 'gemma4:12b', capabilities: ['audio', 'tools'] }, { name: 'b', capabilities: ['tools'] }];
  check('the chat model transcribes when it can hear', audioModelFor(models, 'gemma4:12b'), 'gemma4:12b');
  check('otherwise the first model that can', audioModelFor(models, 'b'), 'a');
}

console.log(`\n${failures === 0 ? 'All voice checks passed.' : `${failures} voice check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
