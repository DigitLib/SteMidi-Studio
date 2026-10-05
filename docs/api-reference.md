# 📡 REST & WebSocket API Reference

SteMidi Studio exposes a comprehensive, well-structured REST API and real-time WebSocket interface for integrating stem separation and music transcription into external pipelines, automated workflows, or third-party tools.

---

## 🌐 General Information

- **Base URL**: `http://localhost:8000/api`
- **Documentation UI**: `http://localhost:8000/docs` (Interactive Swagger UI)
- **Alternative Docs**: `http://localhost:8000/redoc` (ReDoc)
- **CORS**: Enabled by default for all local development origins (`*`).
- **Data Formats**: Standard `application/json` for REST requests and responses; `multipart/form-data` for audio uploads.

---

## 🖥️ System & Hardware Endpoints

### 1. Get System & Hardware Status
```http
GET /api/status
```
Returns system capabilities, active GPU acceleration, VRAM utilization, and model availability.

#### Response Example:
```json
{
  "gpu_available": true,
  "gpu_name": "NVIDIA GeForce RTX 4060 Laptop GPU",
  "vram_total_mb": 8188,
  "vram_used_mb": 3120,
  "vram_free_mb": 5068,
  "active_session_id": "sess_ad5d5e3651",
  "active_model": "muscriptor_large",
  "loaded_models": [
    "muscriptor_large"
  ],
  "available_models": {
    "muscriptor_large": true,
    "muscriptor_medium": true,
    "bs_roformer_mega_53": true
  }
}
```

---

### 2. Purge GPU VRAM
```http
POST /api/purge-vram
```
Clears PyTorch CUDA cached memory allocations via `torch.cuda.empty_cache()` and unpins inactive stem models.

#### Response Example:
```json
{
  "success": true,
  "message": "GPU VRAM memory successfully purged and inactive models unloaded.",
  "vram_freed_mb": 1420
}
```

---

## 🎵 Audio & Session Management

### 1. Upload Audio File (Multipart)
```http
POST /api/upload
```
Uploads an audio file, converts it to 44.1 kHz stereo WAV, calculates normalized waveform peaks, and creates a session.

- **Content-Type**: `multipart/form-data`
- **Body**: `file` (Binary audio data)

#### Response Example (`200 OK`):
```json
{
  "session_id": "sess_ad5d5e3651",
  "filename": "guitar_riff.wav",
  "duration": 125.42,
  "peaks": [0.04, 0.12, 0.58, 0.89, 0.72, 0.34],
  "status": "ready"
}
```

---

### 2. Direct Local Path Audio Import (Zero-Copy)
```http
POST /api/upload-path
```
Imports an audio file directly from a local filesystem path without transferring binary data over HTTP.

- **Content-Type**: `application/json`
- **Body**:
```json
{
  "file_path": "/home/user/Music/project_take1.wav"
}
```

#### Response Example (`200 OK`):
```json
{
  "session_id": "sess_ad5d5e3651",
  "filename": "project_take1.wav",
  "duration": 125.42,
  "peaks": [0.04, 0.12, 0.58, 0.89, 0.72, 0.34],
  "status": "ready"
}
```

---

### 3. List All Saved Sessions
```http
GET /api/sessions
```
Retrieves a list of all historical audio sessions stored in `output/sessions/`.

#### Response Example:
```json
{
  "sessions": [
    {
      "session_id": "sess_ad5d5e3651",
      "filename": "subota 2.wav",
      "created_at": 1728076440,
      "duration": 125.42,
      "stems_count": 1,
      "stem_names": ["piano"],
      "has_midi": true
    }
  ]
}
```

---

### 4. Delete Session
```http
DELETE /api/sessions/{session_id}
```
Permanently removes a session and all its associated stem WAVs and MIDI files from disk.

---

### 5. Stream Session Audio
```http
GET /api/audio/{session_id}
GET /api/audio/{session_id}/stem/{stem_name}
```
Streams audio chunks with `Range` header support for seeking and scrubbing in HTML5 audio players.

---

## ⚡ AI Pipeline Execution

### 1. Trigger BS-RoFormer Mega-53 Separation
```http
POST /api/separate/{session_id}
```
- **Content-Type**: `application/x-www-form-urlencoded`
- **Parameters**:
  - `model_name` *(string, default: "bs_roformer_mega_53stem")*: Target model.
  - `instruments` *(string, optional)*: Comma-separated list of target stems to separate (e.g. `"lead-vocal,drums,electric-bass,piano"`). If omitted, default 4-stem bundle is processed.
  - `device` *(string, default: "auto")*: Compute accelerator (`"cuda"`, `"cpu"`, or `"auto"`).
  - `quality` *(string, default: "high_quality")*: Overlap mode (`"high_quality"` for 8x Hann OLA, `"fast"` for 4x OLA).

#### Response Example (`200 OK`):
```json
{
  "status": "processing",
  "session_id": "sess_ad5d5e3651",
  "model_name": "bs_roformer_mega_53stem",
  "instruments": ["lead-vocal", "drums", "electric-bass", "piano"]
}
```

---

### 2. Trigger MuScriptor MIDI Transcription
```http
POST /api/transcribe/{session_id}
```
- **Content-Type**: `application/x-www-form-urlencoded`
- **Parameters**:
  - `muscriptor_model` *(string, default: "large")*: `"large"` (1.3B) or `"medium"` (350M).
  - `target_stem` *(string, optional)*: Specific isolated stem to transcribe (e.g. `"piano"` or `"lead-vocal"`). If empty, transcribes the full audio mix.
  - `muscriptor_instruments` *(string, optional)*: Comma-separated list of instrument conditioning filters.
  - `manual_tempo` *(float, optional)*: Target BPM for beat-grid quantization (e.g. `120.0`). If omitted, tempo is auto-detected.
  - `single_track` *(bool, default: false)*: Consolidate all transcribed notes into 1 MIDI track.
  - `device` *(string, default: "auto")*: Compute accelerator (`"cuda"` or `"cpu"`).

#### Response Example (`200 OK`):
```json
{
  "status": "processing",
  "session_id": "sess_ad5d5e3651",
  "model": "muscriptor_large",
  "target_stem": "piano"
}
```

---

## 📦 Export Endpoints

### 1. Download Standard MIDI File
```http
GET /api/export/{session_id}/midi
```
- **Response**: Binary download of `transcription.mid` (`audio/midi`). Type 1 Standard Multi-Track MIDI.

### 2. Download Stems ZIP Archive
```http
GET /api/export/{session_id}/stems_zip
```
- **Response**: Binary download of `stems_{session_id}.zip` containing all isolated 44.1 kHz WAV stems.

### 3. Download Full Project Archive
```http
GET /api/export/{session_id}/zip
```
- **Response**: Complete ZIP archive containing original audio, stems, MIDI, and JSON metadata.

---

## 🔄 WebSocket Real-Time Progress Protocol

Connect to the WebSocket endpoint to receive real-time progress events for long-running AI jobs:

```
ws://localhost:8000/api/ws/{session_id}
```

### Event Message Schemas

#### Initial Connection Event:
```json
{
  "type": "initial",
  "status": "processing",
  "progress": {
    "stage": "starting",
    "percent": 0
  }
}
```

#### Separation Progress Event:
```json
{
  "type": "progress",
  "stage": "separating",
  "current_stem": "lead-vocal",
  "stem_index": 1,
  "total_stems": 4,
  "percent": 25,
  "message": "Separating stem 1/4 (lead-vocal)..."
}
```

#### Transcription Progress Event:
```json
{
  "type": "progress",
  "stage": "transcribing",
  "model": "muscriptor_large",
  "percent": 65,
  "message": "Decoding polyphonic note tokens..."
}
```

#### Completion Event:
```json
{
  "type": "completed",
  "stage": "done",
  "percent": 100,
  "result": {
    "midi_file": "output/sessions/sess_.../transcription/transcription.mid",
    "notes_count": 1324,
    "tempo_bpm": 120.0
  }
}
```

#### Error Event:
```json
{
  "type": "error",
  "error": "CUDA out of memory error. Try reducing batch size or selecting fewer stems."
}
```
