# 🏛️ System Architecture

SteMidi Studio is designed as a decoupled, high-performance client-server application. It separates resource-intensive neural network inference (PyTorch CUDA) from client-side audio playback, waveform rendering, and MIDI editing, ensuring zero UI lag and keeping your GPU 100% available for AI computation.

---

## 📐 High-Level Architecture

```mermaid
graph TB
    subgraph Client ["Client Interface (React 19 + Mantine UI v9)"]
        UI[Studio GUI & Controls]
        WS[WaveSurfer.js Waveform Engine]
        MIX[Web Audio Multi-Track Mixer]
        SCHED[Lookahead Synthesizer Scheduler]
        PLAYHEAD[60/144 FPS RAF Playhead Driver]
        ROLL[Interactive Piano Roll Editor]
    end

    subgraph Server ["FastAPI Backend (Port 8000)"]
        API[FastAPI REST Router]
        WS_HUB[WebSocket Progress Broadcaster]
        SM[Session Manager]
        STORAGE[(Session Disk Storage /output/sessions/)]
        POSTPROC[MIDI Quantizer & BPM Alignment]
    end

    subgraph Inference ["AI Neural Inference Engine (PyTorch CUDA)"]
        ROFORMER[BS-RoFormer Mega-53<br/>Band-Split Rotary Transformer]
        MUSCRIPTOR[MuScriptor 1.3B / 350M<br/>48/24-Layer Transformer]
        VRAM[Dynamic VRAM Cache Manager]
    end

    UI -->|HTTP POST /api/upload| API
    API --> SM
    SM --> STORAGE
    
    UI -->|WS /api/ws/{id}| WS_HUB
    
    SM -->|Audio Tensors| ROFORMER
    SM -->|Stem Tensors| MUSCRIPTOR
    VRAM -.->|Purge Unused Weights| ROFORMER
    VRAM -.->|CUDA Cache GC| MUSCRIPTOR
    
    ROFORMER -->|Isolated 44.1kHz WAVs| SM
    MUSCRIPTOR -->|Token Sequences| POSTPROC
    POSTPROC -->|Type 1 MIDI (.mid)| SM
    
    SM -->|Waveform Peaks & Events JSON| UI
    UI --> WS
    UI --> MIX
    UI --> ROLL
    ROLL --> SCHED
    SCHED --> PLAYHEAD
```

---

## 🖥️ Client Architecture

The frontend is built with **React 19** and bundled with **Vite**. It operates entirely within modern web standards (HTML5 Web Audio, WebSockets, Canvas 2D) without requiring proprietary plugins.

### 1. Zero-GPU Audio Playback & Multi-Track Mixer (`webAudioMixer.js`)
- **Native Web Audio API**: Rather than decoding and playing audio via heavy canvas/video frames, playback runs directly on the browser's audio processing thread using `AudioContext`, `GainNode`, and `ChannelMergerNode`.
- **Independent Stem Controls**: Each stem audio track has dedicated gain nodes for volume faders, mute states, and solo routing.
- **A/B Mix Comparison**: Seamlessly switch between the full original audio mix and isolated separated stems with zero playback interruption.

### 2. Sample-Accurate Lookahead Synthesizer (`StudioSynth`)
A primary innovation in SteMidi Studio is the sample-accurate Web Audio lookahead synthesizer implemented in `PianoRoll.jsx`:
- **180 ms Lookahead Scheduler**: Instead of relying on imprecise JavaScript `setInterval` or React state changes, the synthesizer looks ahead 180 ms into the musical timeline and schedules `AudioParam` events directly on the browser's high-resolution audio clock (`ctx.currentTime`).
- **4 ms Transient Attack Envelope**: Synthesized piano waveforms feature a crisp 4 ms attack, preventing the sluggish, muffled onset typical of generic Web Audio oscillators.
- **Dynamic Polyphony Bounding**: Active voices are tracked in a set and bounded (up to 48 concurrent voices). When older notes decay, their audio nodes are disconnected to prevent memory leaks and browser CPU throttling.
- **Dynamics Compressor**: Master audio passes through a dedicated dynamics compressor (`threshold: -14 dB, ratio: 6:1, knee: 10 dB`) to avoid digital clipping when large polyphonic chords are struck.

### 3. Decoupled 60/144 FPS Playhead Driver
- **Smooth Animation Loop**: In traditional web piano rolls, re-rendering hundreds of notes on every audio time update causes visible frame stuttering (~20 FPS).
- **DOM Ref Direct Manipulation**: In SteMidi Studio, the cyan playhead indicator is decoupled from React's Virtual DOM. A high-priority `requestAnimationFrame` loop calculates sub-millisecond interpolation:
  $$\text{smoothTime} = \text{lastAudioTime} + \frac{\text{performance.now()} - \text{lastSync}}{1000}$$
  The playhead DOM ref's `style.left` property is updated directly, delivering a fluid 60 to 144 FPS animation matching the monitor's native refresh rate.

### 4. Interactive Real-Time Latency Offset Compensation (`midiOffsetMs`)
- Browser audio output pipelines introduce an operating system buffer delay (typically 40–80 ms on Windows WASAPI and Linux ALSA/PulseAudio).
- SteMidi Studio incorporates real-time latency compensation (`default: -60 ms`). The lookahead scheduler shifts note dispatch times so that synthesized MIDI notes land in unison with the acoustic audio track transients.
- Users can adjust this value on the fly via the `[-60 ms]` control in the Piano Roll toolbar.

---

## ⚙️ Backend Architecture

The backend is written in Python 3.10+ using **FastAPI** and served via **Uvicorn**.

### 1. Session Manager (`server/session_manager.py`)
- **Isolated Session Workspaces**: Each project session is assigned a unique identifier (e.g. `sess_ad5d5e3651`).
- **Directory Layout**:
  ```
  output/sessions/sess_.../
  ├── original.wav            # Converted standard 44.1 kHz stereo audio
  ├── peaks.json              # Pre-calculated normalized waveform peaks
  ├── metadata.json           # Session status, duration, options, and timestamps
  ├── stems/                  # Isolated stems from BS-RoFormer Mega-53
  │   ├── lead-vocal.wav
  │   ├── drums.wav
  │   ├── bass.wav
  │   └── piano.wav
  └── transcription/          # Multi-instrument MIDI output
      ├── transcription.mid   # Quantized Type 1 Multi-Track Standard MIDI
      └── events.json         # Raw note events with pitch, velocity, onset, offset
  ```

### 2. Real-Time Progress WebSocket Bus (`server/app.py`)
- Background AI tasks (stem separation and transcription) stream real-time progress updates over WebSocket (`/api/ws/{session_id}`).
- Progress events include:
  - Pipeline phase (e.g., `"separating"`, `"transcribing"`, `"quantizing"`)
  - Percent completion (`0–100%`)
  - Current stem or token batch information
  - Real-time ETA and status messages

### 3. Asynchronous Worker Execution
- AI inference runs in a dedicated `ThreadPoolExecutor`, preventing heavy PyTorch calculations from blocking FastAPI's asynchronous event loop or delaying client HTTP requests.

---

## 🧠 AI Inference Engine

### 1. BS-RoFormer Mega-53 Source Separation (`server/mega_roformer_separator.py`)
- **Band-Split Rotary Transformer**: Breaks the spectrogram into non-overlapping sub-bands corresponding to musical frequency perception, applies multi-head self-attention with rotary position embeddings (RoPE), and reconstructs the complex STFT representation.
- **Constant Overlap-Add (COLA) Chunking**: Audio is processed in chunks with an **8x Hann window overlap (87.5% overlap)**. This eliminates boundary clicks, amplitude dips, and phase anomalies between segments.
- **Dynamic VRAM Cache Management**: Neural checkpoints are cached in memory when active. If VRAM pressure exceeds defined limits, inactive checkpoints are unpinned and PyTorch CUDA caches are collected via `torch.cuda.empty_cache()`.

### 2. MuScriptor Polyphonic AMT (`server/muscriptor_transcriber.py`)
- **Deep Autoregressive Audio-to-MIDI Transformer**:
  - **Large (1.3B)**: 48 layers, 1536 hidden dimension, 24 attention heads.
  - **Medium (350M)**: 24 layers, 1024 hidden dimension, 16 attention heads.
- **Conditioning Constraints**: Enables musicians to constrain transcription to specific instruments (e.g., piano, acoustic guitar, vocals, strings, drums) or transcribe all audio unconditioned.
- **PyTorch Native BF16/FP16 CUDA Execution**: Models run with Bfloat16/Half precision on modern NVIDIA GPUs (RTX 3000/4000 series), transcribing typical 3-minute stems in 2 to 4 seconds.

### 3. MIDI Post-Processing & Beat-Grid Alignment (`server/transcription_postprocess.py`)
- **Automatic Tempo Detection**: Detects musical BPM from the audio beat envelope using onset autocorrelation.
- **Chord Snapping**: Note onsets occurring within a 32 ms window are snapped to identical start times, eliminating awkward micro-delays in polyphonic keyboard chords.
- **Ghost Note Elimination**: Glitch notes shorter than 30 ms or below threshold velocity are filtered out.
- **Standard Type 1 MIDI Serialization**: Note events are mapped to individual tracks with proper tempo headers, time signatures, instrument program changes, and channel numbers.
