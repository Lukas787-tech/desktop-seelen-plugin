<#
  Installs the assistant's local voice server into %USERPROFILE%\.ralfm-voice.

    npm run voice:install

  Safe to run again: uv skips what is installed and Hugging Face what is
  downloaded. Delete the folder to uninstall; nothing else is touched - no
  service, no Run key, no PATH entry. The assistant starts the server through
  start.ps1 when it needs a voice, and the server exits after an idle hour.

  Not AppData: run from a packaged app's terminal, every write under AppData is
  redirected into that app's private container, and Seelen - which starts the
  server - would find nothing there.
#>
param([string]$Dir = (Join-Path $env:USERPROFILE '.ralfm-voice'))

# uv's cache may itself sit in such a container; copies keep the install whole
# whatever happens to it.
$env:UV_LINK_MODE = 'copy'

function Step([string]$what, [scriptblock]$run) {
  Write-Host "== $what"
  & $run
  if ($LASTEXITCODE) { throw "$what failed (exit $LASTEXITCODE)" }
}

New-Item -ItemType Directory -Force $Dir | Out-Null
$py = Join-Path $Dir '.venv\Scripts\python.exe'

if (-not (Test-Path $py)) {
  Step 'Python 3.11 environment' { uv venv --python 3.11 (Join-Path $Dir '.venv') }
}

# CUDA 12.8 is the first PyTorch build with kernels for RTX 50-series cards.
# Installed on its own and first, so nothing below settles for PyPI's CPU build.
# Without an NVIDIA card that build is 3 GB of kernels nothing can run, so the
# CPU build is taken instead - Kokoro still speaks faster than real time on one.
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
  Step 'PyTorch (CUDA 12.8)' { uv pip install --python $py torch --index-url https://download.pytorch.org/whl/cu128 }
} else {
  Step 'PyTorch (CPU)' { uv pip install --python $py torch --index-url https://download.pytorch.org/whl/cpu }
}

# kokoro wants misaki[en]; the fork is misaki plus the German G2P the German
# voice was trained with, so it satisfies both. Pinned to the commit the voice
# was verified with, and fetched as an archive so git need not be installed.
$misaki = 'https://github.com/semidark/misaki/archive/9cda9268309160120fffee216280a9ca83ac4644.zip'
Step 'Kokoro and the German G2P' {
  uv pip install --python $py 'kokoro==0.9.4' "misaki[en,de] @ $misaki" numpy huggingface_hub
}

Step 'spaCy English' { & $py -m spacy download en_core_web_sm }

Copy-Item (Join-Path $PSScriptRoot 'server.py') (Join-Path $Dir 'server.py') -Force
Copy-Item (Join-Path $PSScriptRoot 'start.ps1') (Join-Path $Dir 'start.ps1') -Force

$env:HF_HOME = Join-Path $Dir 'hf'
Step 'Models and voices' { & $py (Join-Path $Dir 'server.py') --download }

Write-Host "Installed in $Dir"
