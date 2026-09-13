"""
The assistant's local voice.

Kokoro-82M speaks English and the kikiri fine-tune of it speaks German, behind
the two OpenAI speech endpoints the widget already talks to:

    GET  /v1/audio/voices     {"voices": ["af_heart", ..., "dm_martin"]}
    POST /v1/audio/speech     {"input": "...", "voice": "af_heart", "speed": 1, "response_format": "wav"}

    python server.py [--port 8880] [--idle-minutes 60]
    python server.py --download       fetch every model and voice, then exit

It listens on 127.0.0.1 only and never reaches the network once installed
(Hugging Face is put in offline mode). A browser refuses audio from another
origin without CORS headers, so it answers the widget's origin
(http://tauri.localhost) and localhost pages, and nobody else.

It exits after an idle hour to give its ~1.5 GB of VRAM back; the assistant
starts it again through start.ps1 when it next needs a voice.
"""

import argparse
import io
import json
import logging
import os
import re
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(HERE / "hf"))

# Started windowless through pythonw, there is no console and sys.stdout and
# sys.stderr are None - and kokoro's own logger setup crashes on import when
# handed None. Whatever the libraries print goes to a file instead.
if sys.stdout is None or sys.stderr is None:
    _console = open(HERE / "server.out.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115 - lives as long as the process
    sys.stdout = sys.stdout or _console
    sys.stderr = sys.stderr or _console

BASE_REPO = "hexgrad/Kokoro-82M"
ENGLISH_VOICES = [
    "af_heart", "af_bella", "af_nicole", "af_sarah", "am_michael", "am_fenrir",
    "am_puck", "bf_emma", "bf_isabella", "bm_george", "bm_fable",
]
# The German model shares Kokoro's config and vocabulary exactly (n_token 178),
# so it is Kokoro's own config with the fine-tuned weights. The voice id follows
# Kokoro's convention - language letter, sex, name - with `d` for Deutsch.
GERMAN_REPO = "kikiri-tts/kikiri-german-martin"
GERMAN_WEIGHTS = "kikiri_german_martin_ep10.pth"
GERMAN_VOICES = {"dm_martin": "voices/martin.pt"}

# The German checkpoint was saved by a newer PyTorch, which names a
# weight-normalised layer's two tensors `parametrizations.weight.original0/1`
# where Kokoro builds its layers with the old `weight_g`/`weight_v`. Handed over
# as it is, kokoro's loader falls back to `strict=False` and silently skips all
# 178 of them, and the voice speaks noise - which a recogniser reports as "no
# speech in the provided file". So the German weights are laid over Kokoro's
# own, name by name, and strictly.
WEIGHT_NORM_NAMES = [(".parametrizations.weight.original0", ".weight_g"), (".parametrizations.weight.original1", ".weight_v")]

SAMPLE_RATE = 24_000
MAX_INPUT = 4_000
ALLOWED_ORIGIN = re.compile(r"^https?://(tauri\.localhost|localhost|127\.0\.0\.1)(:\d+)?$")

log = logging.getLogger("ralfm-voice")
last_used = time.monotonic()


def download() -> None:
    from huggingface_hub import hf_hub_download

    for name in ["config.json", "kokoro-v1_0.pth", *(f"voices/{v}.pt" for v in ENGLISH_VOICES)]:
        print(hf_hub_download(BASE_REPO, name), flush=True)
    for name in [GERMAN_WEIGHTS, *GERMAN_VOICES.values()]:
        print(hf_hub_download(GERMAN_REPO, name), flush=True)


def load_german(kmodel, config: str):
    import torch
    from huggingface_hub import hf_hub_download

    model = kmodel(repo_id=BASE_REPO, config=config, model=hf_hub_download(BASE_REPO, "kokoro-v1_0.pth"))
    weights = torch.load(hf_hub_download(GERMAN_REPO, GERMAN_WEIGHTS), map_location="cpu", weights_only=True)
    renamed = 0
    for part, tensors in weights.items():
        target = getattr(model, part).state_dict()
        mapped = {}
        for key, tensor in tensors.items():
            name = key[7:] if key.startswith("module.") else key
            names = [name, *(name.replace(new, old) for new, old in WEIGHT_NORM_NAMES if new in name)]
            hit = next((n for n in names if n in target and target[n].shape == tensor.shape), None)
            if hit is None:
                raise RuntimeError(f"the German weight {key} fits nothing in Kokoro's {part}")
            renamed += hit != name
            mapped[hit] = tensor
        getattr(model, part).load_state_dict({**target, **mapped}, strict=True)
    log.info("German voice loaded, %d weight-norm tensors renamed", renamed)
    return model


def split_phonemes(phonemes: str, limit: int = 400) -> list[str]:
    """Kokoro reads at most 510 tokens a pass; cut at punctuation, then at spaces."""
    pieces: list[str] = []
    current = ""
    for part in re.split(r"(?<=[.!?;:,—…])\s+", phonemes.strip()):
        while len(part) > limit:
            cut = part.rfind(" ", 0, limit)
            cut = cut if cut > 0 else limit
            if current:
                pieces.append(current)
                current = ""
            pieces.append(part[:cut])
            part = part[cut:].lstrip()
        if current and len(current) + 1 + len(part) > limit:
            pieces.append(current)
            current = part
        else:
            current = f"{current} {part}".strip()
    if current:
        pieces.append(current)
    return pieces


class Voices:
    """Every model loaded up front, so the first sentence is not the one that waits."""

    def __init__(self) -> None:
        import torch
        from huggingface_hub import hf_hub_download
        from kokoro import KModel, KPipeline
        from misaki.de import DEG2P

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        config = hf_hub_download(BASE_REPO, "config.json")
        english = KModel(repo_id=BASE_REPO, config=config, model=hf_hub_download(BASE_REPO, "kokoro-v1_0.pth"))
        self.english = english.to(self.device).eval()
        self.pipelines = {code: KPipeline(lang_code=code, repo_id=BASE_REPO, model=self.english) for code in "ab"}
        self.german = load_german(KModel, config).to(self.device).eval()
        self.german_g2p = DEG2P()
        self.packs: dict = {}
        # One GPU, one voice at a time: parallel passes only fight over it.
        self.lock = threading.Lock()

    def names(self) -> list[str]:
        return [*ENGLISH_VOICES, *GERMAN_VOICES]

    def _pack(self, voice: str):
        if voice not in self.packs:
            from huggingface_hub import hf_hub_download

            path = hf_hub_download(GERMAN_REPO, GERMAN_VOICES[voice])
            self.packs[voice] = self.torch.load(path, weights_only=True).to(self.device)
        return self.packs[voice]

    def speak(self, text: str, voice: str, speed: float):
        if voice not in ENGLISH_VOICES and voice not in GERMAN_VOICES:
            raise ValueError(f"unknown voice {voice!r}")
        with self.lock, self.torch.inference_mode():
            if voice in GERMAN_VOICES:
                return self._german(text, voice, speed)
            pipeline = self.pipelines["b" if voice.startswith("b") else "a"]
            parts = [result.audio for result in pipeline(text, voice=voice, speed=speed) if result.audio is not None]
            if not parts:
                raise ValueError("nothing to say")
            return self.torch.cat([p.float().cpu() for p in parts])

    def _german(self, text: str, voice: str, speed: float):
        result = self.german_g2p(text)
        phonemes = result[0] if isinstance(result, tuple) else result
        pack = self._pack(voice)
        parts = []
        for chunk in split_phonemes(phonemes or ""):
            out = self.german(chunk, pack[len(chunk) - 1], speed)
            audio = getattr(out, "audio", out)
            parts.append(audio.float().cpu())
        if not parts:
            raise ValueError("nothing to say")
        return self.torch.cat(parts)


VOICES: Voices


def wav_bytes(audio) -> bytes:
    import numpy as np

    samples = audio.clamp(-1, 1).numpy()
    # A breath between one piece of a reply and the next.
    samples = np.concatenate([samples, np.zeros(int(SAMPLE_RATE * 0.08), dtype=samples.dtype)])
    pcm = (samples * 32767).astype("<i2").tobytes()
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(pcm)
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "ralfm-voice/1"

    def log_message(self, fmt, *args) -> None:
        log.info("%s", fmt % args)

    def _cors(self) -> None:
        origin = self.headers.get("Origin", "")
        if ALLOWED_ORIGIN.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload) -> None:
        self._send(status, json.dumps(payload).encode(), "application/json")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type, authorization")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:
        global last_used
        last_used = time.monotonic()
        path = urlparse(self.path).path.rstrip("/")
        if path in ("", "/health"):
            self._json(200, {"status": "ok", "device": VOICES.device})
        elif path == "/v1/models":
            self._json(200, {"object": "list", "data": [{"id": "kokoro", "object": "model"}]})
        elif path == "/v1/audio/voices":
            self._json(200, {"voices": VOICES.names()})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        global last_used
        last_used = time.monotonic()
        if urlparse(self.path).path.rstrip("/") != "/v1/audio/speech":
            self._json(404, {"error": "not found"})
            return
        try:
            request = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            text = str(request.get("input") or "").strip()
            voice = str(request.get("voice") or "af_heart")
            speed = max(0.5, min(2.0, float(request.get("speed") or 1)))
            if not text:
                raise ValueError("input is empty")
            if len(text) > MAX_INPUT:
                raise ValueError(f"input is longer than {MAX_INPUT} characters")
            started = time.perf_counter()
            audio = VOICES.speak(text, voice, speed)
            if request.get("response_format") == "pcm":
                body, content_type = (audio.clamp(-1, 1).numpy() * 32767).astype("<i2").tobytes(), "audio/pcm"
            else:
                body, content_type = wav_bytes(audio), "audio/wav"
            log.info("spoke %d chars as %s: %.2fs of audio in %.0f ms", len(text), voice, len(audio) / SAMPLE_RATE, (time.perf_counter() - started) * 1000)
            self._send(200, body, content_type)
        except ValueError as err:
            self._json(400, {"error": str(err)})
        except Exception as err:  # noqa: BLE001 - reported to the widget, logged in full here
            log.exception("speech failed")
            self._json(500, {"error": str(err)})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8880)
    parser.add_argument("--idle-minutes", type=float, default=60)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()

    handlers: list[logging.Handler] = [logging.FileHandler(HERE / "server.log", encoding="utf-8")]
    if sys.stdout.isatty():
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=handlers)

    if args.download:
        download()
        return
    os.environ["HF_HUB_OFFLINE"] = "1"

    # Bound before the models load, so a second copy started by another display
    # finds the port taken and leaves at once instead of loading them again.
    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as err:
        log.info("port %d is taken (%s); another copy is running", args.port, err)
        return

    global VOICES
    started = time.perf_counter()
    VOICES = Voices()
    VOICES.speak("Hello.", "af_heart", 1)
    VOICES.speak("Hallo.", "dm_martin", 1)
    log.info("ready on %s:%d on %s in %.1fs", args.host, args.port, VOICES.device, time.perf_counter() - started)

    def watch_idle() -> None:
        while True:
            time.sleep(30)
            if args.idle_minutes > 0 and time.monotonic() - last_used > args.idle_minutes * 60:
                log.info("idle for %g minutes; exiting", args.idle_minutes)
                server.shutdown()
                return

    threading.Thread(target=watch_idle, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001 - pythonw has no console to print to
        logging.getLogger("ralfm-voice").exception("voice server failed")
        raise
