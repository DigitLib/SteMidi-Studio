#!/usr/bin/env python3
"""SteMidi Studio - Model Weights Downloader.

Downloads neural network checkpoints from Hugging Face for:
1. MuScriptor Large (1.3B) & Medium (350M) polyphonic multi-instrument MIDI transcription.
   *NOTE: MuScriptor models are gated under CC BY-NC 4.0. You must accept the license on
   Hugging Face (https://huggingface.co/MuScriptor) and provide an authentication token.
2. BS-RoFormer MVSep Mega 53-stems audio source separation checkpoints (public).

Usage Examples:
    # Set your HF token (get one at https://huggingface.co/settings/tokens):
    export HF_TOKEN="hf_..."

    # Or pass token directly:
    python scripts/download_models.py --muscriptor-large --hf-token "hf_..."

    # Download everything (flagship models + all 53 stems):
    python scripts/download_models.py --all

    # Download MuScriptor Large (Recommended Flagship AMT model, ~5.4 GB):
    python scripts/download_models.py --muscriptor-large

    # Download MuScriptor Medium (Fast/lightweight AMT model, ~1.2 GB):
    python scripts/download_models.py --muscriptor-medium

    # Download all 53 BS-RoFormer separation stems (~4.1 GB, no token required):
    python scripts/download_models.py --mega-53

    # Download only essential BS-RoFormer stems:
    python scripts/download_models.py --mega-stems lead-vocal drums bass electric-guitar piano
"""

import argparse
import os
from pathlib import Path
import sys

# Locate studio root relative to this script
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
MODELS_DIR = ROOT_DIR / "models"


def check_hf_hub():
    """Verify huggingface_hub is installed."""
    try:
        import huggingface_hub
        return huggingface_hub
    except ImportError:
        print("\n[ERROR] 'huggingface_hub' is required to download model weights.")
        print("Please install it with: pip install huggingface_hub\n")
        sys.exit(1)


def print_hf_license_banner(model_name: str = "MuScriptor"):
    """Display clear instructions for accepting the MuScriptor license."""
    print("\n" + "=" * 76)
    print(f"🔒 HUGGING FACE AUTHENTICATION & LICENSE ACCEPTANCE REQUIRED ({model_name})")
    print("=" * 76)
    print("MuScriptor models are released under the CC BY-NC 4.0 license.")
    print("To download the weights, please complete these two simple steps:\n")
    print("1. ACCEPT THE LICENSE IN YOUR BROWSER:")
    print("   • Large (1.3B):  https://huggingface.co/MuScriptor/muscriptor-large")
    print("   • Medium (350M): https://huggingface.co/MuScriptor/muscriptor-medium")
    print("   (Click 'Agree and access repository' - access is granted immediately)\n")
    print("2. PROVIDE AN AUTHENTICATION TOKEN (create one at https://huggingface.co/settings/tokens):")
    print("   • Method A: export HF_TOKEN=\"hf_...\"")
    print("   • Method B: uvx hf auth login   (or: huggingface-cli login)")
    print("   • Method C: Pass argument: --hf-token \"hf_...\"")
    print("=" * 76 + "\n")


def resolve_hf_token(cli_token: str = None) -> str:
    """Retrieve HF token from CLI flag, env var, or cached credentials."""
    hf = check_hf_hub()

    # 1. Direct CLI argument
    if cli_token:
        return cli_token.strip()

    # 2. Environment variables
    env_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if env_token:
        return env_token.strip()

    # 3. Cached login token from `huggingface-cli login` or `hf auth login`
    cached_token = None
    try:
        if hasattr(hf, "get_token"):
            cached_token = hf.get_token()
    except Exception:
        pass

    return cached_token


def ensure_hf_token(cli_token: str = None, model_name: str = "MuScriptor") -> str:
    """Ensure a valid HF token is present for gated MuScriptor models."""
    token = resolve_hf_token(cli_token)
    if token:
        return token

    # No token found - show guidance banner
    print_hf_license_banner(model_name)

    # If running interactively in terminal, prompt for token
    if sys.stdin.isatty():
        try:
            user_input = input("👉 Paste your Hugging Face User Access Token (or press Enter to cancel): ").strip()
            if user_input:
                return user_input
        except (KeyboardInterrupt, EOFError):
            print("\nCancelled.")
            sys.exit(0)

    print("[ERROR] Hugging Face authentication token is required to download MuScriptor.")
    print("Please set your token via 'export HF_TOKEN=hf_...' or run with '--hf-token hf_...'.")
    sys.exit(1)


def download_muscriptor_large(token: str = None):
    """Download MuScriptor Large 1.3B safetensors model (~5.4 GB)."""
    hf = check_hf_hub()
    auth_token = ensure_hf_token(token, model_name="MuScriptor Large (1.3B)")
    repo_id = "MuScriptor/muscriptor-large"
    target_dir = MODELS_DIR / "muscriptor-large"
    target_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n[1/3] Downloading MuScriptor Large (1.3B parameters) from {repo_id}...")
    for filename in ["model.safetensors", "config.json"]:
        print(f"  -> Downloading {filename} to {target_dir}...")
        try:
            hf.hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                local_dir=str(target_dir),
                local_dir_use_symlinks=False,
                token=auth_token,
            )
        except Exception as err:
            err_msg = str(err)
            if "401" in err_msg or "403" in err_msg or "GatedRepo" in err_msg:
                print(f"\n[AUTHENTICATION / LICENSE ERROR] Access denied for {repo_id}:")
                print("Make sure you have accepted the license at:")
                print("  https://huggingface.co/MuScriptor/muscriptor-large")
                print("and that your HF_TOKEN has 'read' permissions.\n")
            raise
    print(f"✓ MuScriptor Large downloaded successfully to {target_dir}")


def download_muscriptor_medium(token: str = None):
    """Download MuScriptor Medium 350M safetensors model (~1.2 GB)."""
    hf = check_hf_hub()
    auth_token = ensure_hf_token(token, model_name="MuScriptor Medium (350M)")
    repo_id = "MuScriptor/muscriptor-medium"
    target_dir = MODELS_DIR / "muscriptor-medium"
    target_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n[2/3] Downloading MuScriptor Medium (350M parameters) from {repo_id}...")
    for filename in ["model.safetensors", "config.json"]:
        print(f"  -> Downloading {filename} to {target_dir}...")
        try:
            hf.hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                local_dir=str(target_dir),
                local_dir_use_symlinks=False,
                token=auth_token,
            )
        except Exception as err:
            err_msg = str(err)
            if "401" in err_msg or "403" in err_msg or "GatedRepo" in err_msg:
                print(f"\n[AUTHENTICATION / LICENSE ERROR] Access denied for {repo_id}:")
                print("Make sure you have accepted the license at:")
                print("  https://huggingface.co/MuScriptor/muscriptor-medium")
                print("and that your HF_TOKEN has 'read' permissions.\n")
            raise
    print(f"✓ MuScriptor Medium downloaded successfully to {target_dir}")


def download_mega_53(specific_stems=None, token: str = None):
    """Download BS-RoFormer Mega 53-stems checkpoints from Hugging Face (Public repo)."""
    hf = check_hf_hub()
    auth_token = resolve_hf_token(token)
    repo_id = "noblebarkrr/BS-Roformer-MVSep-Mega-53-stems"
    target_dir = MODELS_DIR / "BS-Roformer-MVSep-Mega-53-stems"
    v1_dir = target_dir / "v1"
    v1_dir.mkdir(parents=True, exist_ok=True)

    if specific_stems:
        print(f"\n[3/3] Downloading selective BS-RoFormer stems ({len(specific_stems)} stems) from {repo_id}...")
        for stem in specific_stems:
            ckpt_name = f"bs_mega_53stem_{stem}_mvsep.ckpt"
            yaml_name = f"bs_mega_53stem_{stem}_mvsep_config.yaml"
            for fn in [ckpt_name, yaml_name]:
                rel_path = f"v1/{fn}"
                try:
                    print(f"  -> Downloading {rel_path}...")
                    hf.hf_hub_download(
                        repo_id=repo_id,
                        filename=rel_path,
                        local_dir=str(target_dir),
                        local_dir_use_symlinks=False,
                        token=auth_token,
                    )
                except Exception as err:
                    print(f"  ⚠️ Warning: could not download {rel_path}: {err}")
        print(f"✓ Selected BS-RoFormer stems downloaded to {v1_dir}")
    else:
        print(f"\n[3/3] Downloading all 53 BS-RoFormer Mega stems (~4.1 GB) from {repo_id}...")
        hf.snapshot_download(
            repo_id=repo_id,
            local_dir=str(target_dir),
            local_dir_use_symlinks=False,
            allow_patterns=["v1/*", "README.md"],
            token=auth_token,
        )
        print(f"✓ All 53 BS-RoFormer stems downloaded successfully to {v1_dir}")


def main():
    parser = argparse.ArgumentParser(
        description="SteMidi Studio - Model Weights Downloader",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--all", action="store_true", help="Download all models (MuScriptor Large + Medium + 53 BS-RoFormer stems)")
    parser.add_argument("--muscriptor-large", action="store_true", help="Download MuScriptor Large (1.3B parameters, ~5.4 GB, requires license acceptance)")
    parser.add_argument("--muscriptor-medium", action="store_true", help="Download MuScriptor Medium (350M parameters, ~1.2 GB, requires license acceptance)")
    parser.add_argument("--mega-53", action="store_true", help="Download all 53 BS-RoFormer stem separation checkpoints (~4.1 GB, public)")
    parser.add_argument(
        "--mega-stems",
        nargs="+",
        metavar="STEM",
        help="Download only specific BS-RoFormer stem models (e.g. vocals lead-vocal drums bass guitar piano saxophone)",
    )
    parser.add_argument(
        "--hf-token",
        type=str,
        default=None,
        help="Hugging Face User Access Token (or set export HF_TOKEN=...)",
    )

    args = parser.parse_args()

    # Default action if no flags provided: prompt user
    if not (args.all or args.muscriptor_large or args.muscriptor_medium or args.mega_53 or args.mega_stems):
        print("=" * 60)
        print("         🎵 SteMidi Studio - Model Downloader")
        print("=" * 60)
        print("1) MuScriptor Large 1.3B (Recommended Flagship AMT, ~5.4 GB)*")
        print("2) MuScriptor Medium 350M (Fast & Lightweight AMT, ~1.2 GB)*")
        print("3) All 53 BS-RoFormer Stem Separation Checkpoints (~4.1 GB)")
        print("4) Essential BS-RoFormer Stems (Vocals, Drums, Bass, Guitar, Piano, Synth)")
        print("5) All Models (Full Suite, ~10.7 GB)*")
        print("q) Quit")
        print("\n* Models marked with (*) require Hugging Face license acceptance.")
        choice = input("\nEnter choice [1-5]: ").strip().lower()

        if choice == "1":
            args.muscriptor_large = True
        elif choice == "2":
            args.muscriptor_medium = True
        elif choice == "3":
            args.mega_53 = True
        elif choice == "4":
            args.mega_stems = ["lead-vocal", "vocal", "drums", "bass", "guitar", "electric-guitar", "acoustic-guitar", "piano", "synth"]
        elif choice == "5":
            args.all = True
        else:
            print("Exiting.")
            sys.exit(0)

    try:
        if args.all or args.muscriptor_large:
            download_muscriptor_large(token=args.hf_token)

        if args.all or args.muscriptor_medium:
            download_muscriptor_medium(token=args.hf_token)

        if args.all or args.mega_53:
            download_mega_53(token=args.hf_token)
        elif args.mega_stems:
            download_mega_53(specific_stems=args.mega_stems, token=args.hf_token)

        print("\n🎉 Model setup complete! You can now start the studio with:")
        print("   python run_studio.py\n")

    except KeyboardInterrupt:
        print("\nDownload interrupted by user.")
        sys.exit(1)
    except Exception as err:
        print(f"\n❌ Download failed: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
