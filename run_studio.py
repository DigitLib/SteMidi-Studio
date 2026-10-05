"""Unified launcher for SteMidi Studio."""

import argparse
import glob
import os
from pathlib import Path
import shutil
import site
import subprocess
import sys
import warnings
import webbrowser

# Filter known PyTorch / torchaudio / ONNX Runtime deprecation & window notices
warnings.filterwarnings("ignore", message=".*window was not provided.*")
warnings.filterwarnings("ignore", message=".*torch.backends.cuda.sdp_kernel.*")
warnings.filterwarnings("ignore", category=FutureWarning, module="torch.*")

# Robust path resolution: works both inside repo and as standalone folder
SCRIPT_DIR = Path(__file__).resolve().parent
if (SCRIPT_DIR / "server").is_dir() and (SCRIPT_DIR / "client").is_dir():
    STUDIO_DIR = SCRIPT_DIR
    ROOT_DIR = SCRIPT_DIR.parent
else:
    STUDIO_DIR = SCRIPT_DIR / "studio"
    ROOT_DIR = SCRIPT_DIR

# Auto-detect project virtual environment (Linux and Windows) and re-exec if launched with system python
def get_venv_python():
    candidates = [
        STUDIO_DIR / ".venv" / "bin" / "python3",
        STUDIO_DIR / ".venv" / "Scripts" / "python.exe",
        ROOT_DIR / ".venv" / "bin" / "python3",
        ROOT_DIR / ".venv" / "Scripts" / "python.exe",
    ]
    for c in candidates:
        if c.is_file():
            return c
    return None

VENV_PYTHON = get_venv_python()
if VENV_PYTHON and Path(sys.executable).resolve() != VENV_PYTHON.resolve():
    print(f"[Studio] Switching to project venv: {VENV_PYTHON}")
    os.execv(str(VENV_PYTHON), [str(VENV_PYTHON)] + sys.argv)


def ensure_nvidia_cuda_env():
    """Ensure LD_LIBRARY_PATH contains NVIDIA CUDA & cuDNN shared libraries on Linux.

    In Linux, glibc dlopen() only inspects LD_LIBRARY_PATH if present at process start.
    If the current process was started without them, we discover all nvidia/*/lib directories
    and re-exec with the updated LD_LIBRARY_PATH so CUDAExecutionProvider is fully active.
    """
    if sys.platform == "win32" or os.environ.get("_STUDIO_CUDA_CONFIGURED") == "1":
        return

    nvidia_dirs = []
    # 1. Project virtual environments
    for venv_candidate in (STUDIO_DIR / ".venv", ROOT_DIR / ".venv"):
        if venv_candidate.is_dir():
            for p in venv_candidate.glob("lib/python*/site-packages/nvidia/*/lib"):
                nvidia_dirs.append(str(p))

    # 2. Python site-packages
    try:
        for sp in site.getsitepackages():
            nvidia_dirs.extend(glob.glob(os.path.join(sp, "nvidia", "*", "lib")))
    except Exception:
        pass

    py_lib = Path(sys.executable).parent.parent / "lib"
    for p in py_lib.glob("python*/site-packages/nvidia/*/lib"):
        nvidia_dirs.append(str(p))

    current_ld = os.environ.get("LD_LIBRARY_PATH", "")
    current_parts = set(current_ld.split(":")) if current_ld else set()
    new_additions = [d for d in dict.fromkeys(nvidia_dirs) if os.path.isdir(d) and d not in current_parts]

    if new_additions:
        new_env = os.environ.copy()
        new_ld = ":".join(new_additions) + (f":{current_ld}" if current_ld else "")
        new_env["LD_LIBRARY_PATH"] = new_ld
        new_env["_STUDIO_CUDA_CONFIGURED"] = "1"
        try:
            os.execve(sys.executable, [sys.executable] + sys.argv, new_env)
        except Exception as e:
            print(f"[Studio] Notice: could not re-exec with LD_LIBRARY_PATH: {e}")


# Run CUDA environment check before other heavy imports
ensure_nvidia_cuda_env()

CLIENT_DIR = STUDIO_DIR / "client"
DIST_DIR = CLIENT_DIR / "dist"
PYTHON_BIN_DIR = Path(sys.executable).parent


def build_client_if_needed(force: bool = False):
    """Ensure client production build exists and is up to date with src modifications."""
    dist_html = DIST_DIR / "index.html"
    has_npm = shutil.which("npm") is not None

    if dist_html.is_file() and not force:
        # If npm is not installed, seamlessly serve pre-bundled assets
        if not has_npm:
            return
        # If npm is installed, rebuild only if source is significantly newer than bundle (+5s buffer for git checkout)
        dist_mtime = dist_html.stat().st_mtime
        src_files = list((CLIENT_DIR / "src").rglob("*")) + [CLIENT_DIR / "index.html"]
        needs_build = False
        for sf in src_files:
            if sf.is_file() and sf.stat().st_mtime > dist_mtime + 5:
                needs_build = True
                print(f"[Studio] Client source changed ({sf.name}). Rebuilding bundle...")
                break
        if not needs_build:
            return

    if not has_npm:
        if dist_html.is_file():
            return
        raise RuntimeError(
            "Frontend bundle (client/dist) is missing and Node.js/npm is not installed.\n"
            "Please install Node.js 18+ to build the frontend, or ensure client/dist is present."
        )

    print("Building studio frontend bundle...")
    if not (CLIENT_DIR / "node_modules").is_dir():
        subprocess.run(["npm", "install"], cwd=str(CLIENT_DIR), check=True)
    subprocess.run(["npm", "run", "build"], cwd=str(CLIENT_DIR), check=True)
    print("✓ Frontend build complete.")


def main():
    parser = argparse.ArgumentParser(description="Launch SteMidi Studio Web GUI")
    parser.add_argument("--host", default="0.0.0.0", help="Host IP (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    parser.add_argument("--no-browser", action="store_true", help="Don't open browser automatically")
    parser.add_argument("--dev", action="store_true", help="Run with Vite dev server")
    parser.add_argument("--rebuild", action="store_true", help="Force rebuild of frontend client bundle")
    args = parser.parse_args()

    # Prepend Python environment bin directory to PATH for ffmpeg and python binaries
    os.environ["PATH"] = f"{PYTHON_BIN_DIR}{os.pathsep}{os.environ.get('PATH', '')}"

    for p in (str(ROOT_DIR), str(STUDIO_DIR), str(STUDIO_DIR.parent)):
        if p not in sys.path:
            sys.path.insert(0, p)

    if args.dev:
        print("Starting in development mode (Vite dev server + FastAPI)...")
        app_target = "studio.server.app:app" if (ROOT_DIR / "studio" / "server").is_dir() else "server.app:app"
        backend_proc = subprocess.Popen([
            sys.executable, "-m", "uvicorn", app_target,
            "--host", args.host, "--port", str(args.port), "--reload"
        ], cwd=str(STUDIO_DIR.parent if (ROOT_DIR / "studio").is_dir() else STUDIO_DIR))
        frontend_proc = subprocess.Popen(["npm", "run", "dev"], cwd=str(CLIENT_DIR))
        try:
            backend_proc.wait()
        except KeyboardInterrupt:
            backend_proc.terminate()
            frontend_proc.terminate()
        return

    # Production single-server mode
    build_client_if_needed(force=args.rebuild)

    url = f"http://localhost:{args.port}"
    print("=" * 60)
    print(f"🎵 SteMidi Studio is launching at {url}")
    print(f"Server host: {args.host}:{args.port}")
    print("=" * 60)

    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    import uvicorn
    try:
        from studio.server.app import app
    except ImportError:
        from server.app import app

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
