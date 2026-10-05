# 📚 SteMidi Studio Documentation

Welcome to the comprehensive technical documentation for **SteMidi Studio** — the high-performance AI Audio Stem Separation & Multi-Instrument MIDI Transcription suite.

---

## 🧭 Documentation Index

| Document | Description | Target Audience |
| :--- | :--- | :--- |
| [**Architecture**](architecture.md) | Deep dive into client-server topology, PyTorch inference, Web Audio engine, and data flow. | Engineers, Developers |
| [**Installation & Setup**](installation.md) | Step-by-step setup for Linux & Windows, NVIDIA CUDA 12 configuration, and FFmpeg. | All Users |
| [**AI Models & Checkpoints**](models.md) | BS-RoFormer Mega-53 and MuScriptor 1.3B/350M architectures, Hugging Face licensing, and weights management. | AI Engineers, Users |
| [**Studio User Guide**](user-guide.md) | End-to-end walkthrough: audio import, stem mixing, selective separation, MIDI transcription, and Piano Roll editing. | Musicians, Producers |
| [**REST & WebSocket API**](api-reference.md) | Complete OpenAPI specification, REST endpoints, payloads, and WebSocket progress streaming. | Developers, Integrators |
| [**Troubleshooting & FAQ**](troubleshooting.md) | Diagnostic solutions for CUDA VRAM, Windows socket resets, FFmpeg, audio sync, and DAW export. | All Users |

---

## 🚀 Quick Navigation by Use Case

### 🎹 For Musicians & Music Producers
1. Review the [Installation Guide](installation.md) to set up your Python environment and GPU acceleration.
2. Read the [Model Guide](models.md) to download the BS-RoFormer Mega stems and MuScriptor models.
3. Follow the [Studio User Guide](user-guide.md) to learn how to separate instruments, transcribe chords and melodies, and export clean Type 1 Standard MIDI files (`.mid`) into your DAW.

### 💻 For Developers & Audio Engineers
1. Understand the decoupled design in [Architecture](architecture.md).
2. Explore available REST endpoints and real-time WebSocket progress in [API Reference](api-reference.md).
3. Check the [Installation Guide](installation.md) for instructions on running the frontend Vite development server alongside the FastAPI backend.

### 🔬 For AI Researchers
1. Learn how the Band-Split RoFormer (BS-RoFormer) STFT chunking and 8x Hann overlap-add operate in [AI Models & Checkpoints](models.md).
2. Inspect the 48-layer / 24-layer MuScriptor transformer specifications and instrument conditioning mechanisms in [AI Models & Checkpoints](models.md).

---

## ⚡ Quick Start Summary

```bash
# 1. Clone repository
git clone https://github.com/your-username/stemidi-studio.git
cd stemidi-studio

# 2. Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate       # On Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# 4. Download models (requires free Hugging Face token for MuScriptor)
export HF_TOKEN="hf_..."
python scripts/download_models.py --muscriptor-large --mega-53

# 5. Launch studio
python run_studio.py
```

The studio dashboard will open automatically in your browser at `http://localhost:8000`.
