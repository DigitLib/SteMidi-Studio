# 🩺 Troubleshooting & Frequently Asked Questions (FAQ)

This guide covers common diagnostic scenarios, hardware errors, operating system peculiarities, and workflow solutions.

---

## ⚡ 1. NVIDIA CUDA & GPU Acceleration

### Q: SteMidi Studio displays "Running on CPU" instead of my GPU.
**Cause**: PyTorch was installed from generic PyPI wheels without CUDA runtime libraries, or your NVIDIA driver is outdated.

**Solution**:
1. Check that your NVIDIA driver is functioning:
   ```bash
   nvidia-smi
   ```
   If this command is missing or errors, update your graphics driver from [nvidia.com/drivers](https://www.nvidia.com/Download/index.aspx).
2. Activate your virtual environment and install PyTorch with CUDA 12.1:
   ```bash
   pip install torch torchaudio --force-reinstall --index-url https://download.pytorch.org/whl/cu121
   ```
3. Test detection:
   ```bash
   python -c "import torch; print('CUDA Available:', torch.cuda.is_available(), '| GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'None')"
   ```

---

### Q: I get a `torch.cuda.OutOfMemoryError` during separation or transcription.
**Cause**: The neural network exceeded your GPU's physical VRAM capacity.

**Solutions**:
1. **Purge VRAM**: Click the **"Purge VRAM"** button in the Model Hub or top bar to free cached PyTorch buffers.
2. **Use MuScriptor Medium**: If your GPU has 4 GB to 6 GB of VRAM, switch to **MuScriptor Medium (350M)** in Settings. It requires only ~1.2 GB of VRAM compared to ~3.1 GB for MuScriptor Large.
3. **Separate Fewer Stems Concurrently**: Rather than selecting 10+ stems in a single pass, separate in batches of 2 to 4 stems (e.g. separate `lead-vocal` + `drums`, then `bass` + `piano`).
4. **Close Background GPU Applications**: Close hardware-accelerated games, 3D software, or browser tabs playing 4K video.

---

## 🪟 2. Windows Specific Solutions

### Q: What is `ConnectionResetError: [WinError 10054]` in the terminal?
**Cause**: In Windows, when a web browser navigates, closes a tab, or aborts an audio stream during playback, Windows Winsock forcibly resets the socket connection. This is standard HTTP/WebSocket behavior.

**Status in SteMidi Studio**:
SteMidi Studio incorporates an automatic startup event handler in `server/app.py` that intercepts and silences these benign socket disconnection traces. If you ever see one, it is completely harmless and does not affect ongoing processing.

---

### Q: PowerShell shows `running scripts is disabled on this system`.
**Cause**: Windows restricts unsigned script execution by default.

**Solution**:
Enable script execution for your current user account:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
Then reactivate your environment:
```powershell
.venv\Scripts\activate
```

---

### Q: File path errors or filenames exceeding 260 characters.
**Cause**: Legacy Windows MAX_PATH limitation.

**Solution**:
Enable Long Paths in Windows 10/11:
1. Open PowerShell as Administrator.
2. Run:
   ```powershell
   New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
   ```

---

## 🔊 3. Audio Decoding & FFmpeg

### Q: Error: `FFmpeg is not installed or not in PATH`.
**Cause**: SteMidi Studio relies on FFmpeg to convert incoming MP3, FLAC, M4A, and OGG files into 44.1 kHz stereo audio arrays.

**Solution**:
- **On Linux (Ubuntu/Debian)**:
  ```bash
  sudo apt update && sudo apt install -y ffmpeg
  ```
- **On Windows (PowerShell)**:
  ```powershell
  winget install Gyan.FFmpeg
  ```
  *(Restart PowerShell after installation so PATH changes take effect).*
- Verify in your terminal:
  ```bash
  ffmpeg -version
  ```

---

## 🔑 4. Hugging Face & Model Downloading

### Q: `401 Unauthorized` or `403 Forbidden` error when downloading MuScriptor.
**Cause**: MuScriptor Large and Medium are gated models released under the **CC BY-NC 4.0** license. You must accept the license agreement in your browser before Hugging Face allows checkpoint downloads.

**Solution**:
1. Log into [huggingface.co](https://huggingface.co).
2. Visit [MuScriptor Large](https://huggingface.co/MuScriptor/muscriptor-large) and click **"Agree and access repository"**.
3. Create an Access Token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) (Read permissions).
4. Set the token and re-run the downloader:
   ```bash
   export HF_TOKEN="hf_..."        # Windows: $env:HF_TOKEN="hf_..."
   python scripts/download_models.py --muscriptor-large
   ```

---

### Q: The download was interrupted and the model file is corrupted.
**Solution**:
Delete the partial checkpoint and download it cleanly:
```bash
rm -rf models/muscriptor-large/model.safetensors
python scripts/download_models.py --muscriptor-large
```

---

## ⏱️ 5. Audio-to-MIDI Latency & Playback Sync

### Q: The synthesized piano notes sound slightly late compared to the audio drums/vocals.
**Cause**: Operating system audio drivers and browser media pipelines introduce an acoustic output buffer delay (typically 50–90 ms on Windows WASAPI and Linux PulseAudio/PipeWire) between the reported playback time and when sound reaches your speakers.

**Solution**:
Use the built-in **`Sync`** micro-control located on the Piano Roll toolbar:
- Click `[-]` or `[+]` in 10 ms increments (default is `-60 ms`).
- While listening in **Mix** mode, adjust the offset until the synthesized acoustic strikes occur in phase unison with the underlying audio transients.

---

### Q: The browser produces no sound when hitting Play.
**Cause**: Modern web browsers (Chrome, Edge, Firefox) enforce strict **Autoplay Policies** that block Web Audio synthesis until the user interacts with the page.

**Solution**:
Click anywhere inside the studio interface (e.g., click on the waveform or piano roll) before pressing <kbd>Spacebar</kbd>.

---

## 🎛️ 6. DAW Integration FAQ

### Q: How do I import the exported MIDI into Ableton Live / FL Studio / Logic Pro?
1. Click **Export -> Export MIDI (`.mid`)**.
2. Drag the downloaded `.mid` file directly onto an instrument track in your DAW.
3. Assign your preferred virtual instrument (e.g. Pianoteq, Native Instruments Kontakt, Serum, Omnisphere, or stock DAW keys).
4. **Tempo Match**: SteMidi Studio writes the exact detected or chosen BPM into the MIDI file header. When your DAW prompts *"Import tempo map?"*, select **Yes** to align DAW grid bars with the transcribed music.

---

### Q: Why do notes show as awkward tuplets or 64th rests in Sibelius / MuseScore?
**Solution**:
Before transcribing, open the **Settings** modal and configure:
1. **Target Tempo / BPM**: Enter the known song tempo (e.g. `120 BPM`) instead of using raw audio clock timing.
2. **Consolidate into 1 Single Track**: Turn this switch **ON** so all voices are aligned to a single clean piano stave instead of being fragmented across multiple tracks.
