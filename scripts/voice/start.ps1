# Starts the voice server with no window. Copied beside it by install.ps1; the
# assistant runs this when it needs a voice and the server is not answering.
# A second start while one is running exits on its own (the port is taken).
$d = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:HF_HOME = Join-Path $d 'hf'
Start-Process -FilePath (Join-Path $d '.venv\Scripts\pythonw.exe') -ArgumentList @('"' + (Join-Path $d 'server.py') + '"') -WorkingDirectory $d -WindowStyle Hidden
