# 💻 Installation & Hardware Setup Guide

This guide provides step-by-step instructions for installing and running **SteMidi Studio** on **Linux** and **Windows**.

---

## 📋 System Requirements

| Component | Minimum Requirements | Recommended Specification |
| :--- | :--- | :--- |
| **Operating System** | Ubuntu 20.04+, Debian 11+, Windows 10 | Ubuntu 22.04+ or Windows 11 (64-bit) |
| **Processor (CPU)** | 4-Core x86_64 CPU (Intel i5 / AMD Ryzen 5) | 8-Core+ modern CPU (Intel i7/i9 or Ryzen 7/9) |
| **System Memory (RAM)**| 8 GB RAM | 16 GB to 32 GB RAM |
| **Graphics (GPU)** | CPU Mode (Slow inference) | **NVIDIA RTX 3060, 4060, 4070, 4080, 4090** (6 GB+ VRAM) |
| **CUDA Toolkit** | CPU Fallback | CUDA 12.1+ / 12.4+ with latest NVIDIA drivers |
| **Disk Storage** | 2 GB for code & base environment | 15 GB+ NVMe SSD (for model weights and session audio) |
| **FFmpeg** | Required for audio conversion | Latest stable FFmpeg release |

---

## 🐧 Linux Setup (Ubuntu / Debian / Fedora / Arch)

### 1. Install System Dependencies & FFmpeg

#### Ubuntu / Debian:
```bash
sudo apt update
sudo apt install -y python3-venv python3-pip ffmpeg git
```

#### Fedora:
```bash
sudo dnf install -y python3-pip python3-devel ffmpeg git
```

#### Arch Linux:
```bash
sudo pacman -S python python-pip ffmpeg git
```

Verify that FFmpeg is accessible:
```bash
ffmpeg -version
```

### 2. Clone the Repository

```bash
git clone https://github.com/your-username/stemidi-studio.git
cd stemidi-studio
```

### 3. Configure Python Virtual Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Configure PyTorch with CUDA 12 Support

If you have an NVIDIA GPU, install the official CUDA-accelerated PyTorch build:

```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
```

Verify CUDA detection:
```bash
python3 -c "import torch; print('CUDA Available:', torch.cuda.is_available(), '| Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
```
Expected output:
```
CUDA Available: True | Device: NVIDIA GeForce RTX ...
```

---

## 🪟 Windows 10 / 11 Setup

### 1. Prerequisites on Windows

1. **Python 3.10, 3.11, or 3.12**:
   - Download from [python.org](https://www.python.org/downloads/windows/).
   - **IMPORTANT**: During installation, check the box: **"Add python.exe to PATH"**.
2. **FFmpeg**:
   - Install using Windows Package Manager (`winget` in PowerShell):
     ```powershell
     winget install Gyan.FFmpeg
     ```
   - *Or via Chocolatey*: `choco install ffmpeg`
   - Reopen your terminal and verify: `ffmpeg -version`
3. **NVIDIA GPU Driver**:
   - Ensure the latest Game Ready or Studio driver is installed from [nvidia.com/drivers](https://www.nvidia.com/Download/index.aspx).

### 2. Clone the Repository

Open PowerShell or Command Prompt:
```powershell
git clone https://github.com/your-username/stemidi-studio.git
cd stemidi-studio
```

### 3. Create & Activate Virtual Environment

```powershell
python -m venv .venv
.venv\Scripts\activate
```

> [!TIP]
> If PowerShell displays an execution policy error (`running scripts is disabled on this system`), enable script execution for your user account:
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```

### 4. Install Dependencies & CUDA PyTorch

```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
```

Verify CUDA detection in PowerShell:
```powershell
python -c "import torch; print('CUDA Available:', torch.cuda.is_available(), '| Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
```

---

## 📦 Downloading AI Model Checkpoints

Before starting separation or transcription, download the model weights:

```bash
# Set your Hugging Face authentication token (create at huggingface.co/settings/tokens):
export HF_TOKEN="hf_..."        # On Windows: $env:HF_TOKEN="hf_..."

# Download MuScriptor Large (AMT) and BS-RoFormer Mega-53 stems:
python scripts/download_models.py --muscriptor-large --mega-53
```

*(See [AI Models & Checkpoints](models.md) for full instructions, licensing details, and stem options).*

---

## 🚀 Launching the Studio

Run the unified launcher:

```bash
python run_studio.py
```

The launcher will:
1. Detect and activate your project's `.venv` automatically.
2. Configure GPU shared libraries and CUDA execution environment.
3. Serve the pre-compiled production frontend from `client/dist/`.
4. Launch the FastAPI server at `http://localhost:8000`.
5. Open your default web browser to the studio interface.

### Advanced Launcher Arguments

| Argument | Default | Description |
| :--- | :--- | :--- |
| `--host` | `0.0.0.0` | IP address to bind to (`127.0.0.1` for local-only, `0.0.0.0` for LAN access). |
| `--port` | `8000` | Port number to bind the server to. |
| `--no-browser` | `False` | Prevents automatically launching a browser window. |
| `--rebuild` | `False` | Forces a complete rebuild of the client Vite bundle using `npm`. |
| `--dev` | `False` | Starts Vite hot-reload server alongside FastAPI for frontend developers. |

#### Example: Running for LAN access without opening browser:
```bash
python run_studio.py --host 0.0.0.0 --port 8080 --no-browser
```

---

## 🛠️ Frontend Development Setup (Optional)

> [!NOTE]
> SteMidi Studio includes pre-compiled, optimized production assets in `client/dist/`. You **do NOT need Node.js or npm** if you only intend to run and use the application.

If you are a developer looking to customize UI components, install **Node.js 18+** and run in development mode:

```bash
# 1. Install frontend dependencies
cd client
npm install

# 2. Start hot-reload development mode
cd ..
python run_studio.py --dev
```

In `--dev` mode:
- The FastAPI backend runs with auto-reload on `http://localhost:8000`.
- The Vite development server runs on `http://localhost:5173` with instant Hot Module Replacement (HMR).
- API requests are proxied seamlessly to the FastAPI backend.
