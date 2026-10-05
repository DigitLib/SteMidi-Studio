"""Selective multi-stem separation engine using BS-RoFormer-MVSep-Mega-53-stems.

Supports 53 dedicated instrument checkpoints from noblebarkrr/BS-Roformer-MVSep-Mega-53-stems.
Each instrument runs on-demand with selective execution, low-latency CUDA inference,
Hann-window overlap-add, and automatic memory cleanup.
"""

import gc
import json
import os
import time
import warnings
from pathlib import Path
from typing import Callable, Dict, List, Optional

import numpy as np
import soundfile as sf
import torch
import torch.nn as nn
import yaml
from scipy import signal

warnings.filterwarnings("ignore", message=".*window was not provided.*")
warnings.filterwarnings("ignore", message=".*torch.backends.cuda.sdp_kernel.*")
warnings.filterwarnings("ignore", category=FutureWarning, module="torch.*")

from audio_separator.separator.uvr_lib_v5.roformer.bs_roformer import BSRoformer, MaskEstimator
from .utils import compute_waveform_peaks

STUDIO_DIR = Path(__file__).resolve().parent.parent
MODELS_ROOT = Path(os.environ.get("STUDIO_MODELS_DIR", STUDIO_DIR / "models"))
MEGA_MODELS_DIR = MODELS_ROOT / "BS-Roformer-MVSep-Mega-53-stems" / "v1"

# Complete catalog of all 53 instruments supported by the Mega model
MEGA_53_CATALOG = [
    # Vocals
    {"id": "lead-vocal", "name": "Lead Vocal", "category": "vocals", "icon": "🎤", "color": "#00e5ff"},
    {"id": "back-vocal", "name": "Backing Vocal", "category": "vocals", "icon": "🎙️", "color": "#80d8ff"},
    {"id": "vocal", "name": "Vocals (Full)", "category": "vocals", "icon": "🗣️", "color": "#40c4ff"},

    # Keyboards & Pianos
    {"id": "piano", "name": "Acoustic Piano", "category": "keyboards", "icon": "🎹", "color": "#00e676"},
    {"id": "digital-piano", "name": "Digital Piano", "category": "keyboards", "icon": "🎹", "color": "#69f0ae"},
    {"id": "organ", "name": "Organ", "category": "keyboards", "icon": "⛪", "color": "#b9f6ca"},
    {"id": "harpsichord", "name": "Harpsichord", "category": "keyboards", "icon": "🎼", "color": "#a7ffeb"},
    {"id": "keys", "name": "Keyboards", "category": "keyboards", "icon": "🎹", "color": "#1de9b6"},
    {"id": "synth", "name": "Synthesizer", "category": "keyboards", "icon": "🎛️", "color": "#00bfa5"},

    # Guitars & Plucked Strings
    {"id": "acoustic-guitar", "name": "Acoustic Guitar", "category": "guitars", "icon": "🎸", "color": "#ffab00"},
    {"id": "electric-guitar", "name": "Electric Guitar", "category": "guitars", "icon": "🎸", "color": "#ffd740"},
    {"id": "guitar", "name": "Guitar", "category": "guitars", "icon": "🎸", "color": "#ffc400"},
    {"id": "bass", "name": "Bass Guitar", "category": "guitars", "icon": "🎸", "color": "#b388ff"},
    {"id": "banjo", "name": "Banjo", "category": "guitars", "icon": "🪕", "color": "#ffe57f"},
    {"id": "mandolin", "name": "Mandolin", "category": "guitars", "icon": "🪕", "color": "#ffca28"},
    {"id": "ukulele", "name": "Ukulele", "category": "guitars", "icon": "🪕", "color": "#ffb300"},
    {"id": "sitar", "name": "Sitar", "category": "guitars", "icon": "🪕", "color": "#ffa000"},
    {"id": "harp", "name": "Harp", "category": "guitars", "icon": "🪗", "color": "#ff8f00"},
    {"id": "dobro", "name": "Dobro", "category": "guitars", "icon": "🎸", "color": "#ff6f00"},

    # Bowed Strings & Orchestral
    {"id": "strings", "name": "Strings Ensemble", "category": "strings", "icon": "🎻", "color": "#ea80fc"},
    {"id": "violin", "name": "Violin", "category": "strings", "icon": "🎻", "color": "#e040fb"},
    {"id": "viola", "name": "Viola", "category": "strings", "icon": "🎻", "color": "#d500f9"},
    {"id": "cello", "name": "Cello", "category": "strings", "icon": "🎻", "color": "#aa00ff"},
    {"id": "double-bass", "name": "Double Bass", "category": "strings", "icon": "🎻", "color": "#7c4dff"},
    {"id": "bowed_strings", "name": "Bowed Strings", "category": "strings", "icon": "🎻", "color": "#651fff"},

    # Brass
    {"id": "brass", "name": "Brass Section", "category": "brass", "icon": "🎺", "color": "#ff6e40"},
    {"id": "trumpet", "name": "Trumpet", "category": "brass", "icon": "🎺", "color": "#ff3d00"},
    {"id": "trombone", "name": "Trombone", "category": "brass", "icon": "🎺", "color": "#dd2c00"},
    {"id": "french-horn", "name": "French Horn", "category": "brass", "icon": "📯", "color": "#ff9e80"},
    {"id": "tuba", "name": "Tuba", "category": "brass", "icon": "📯", "color": "#ff5722"},

    # Woodwinds & Harmonicas
    {"id": "woodwind", "name": "Woodwinds Section", "category": "woodwinds", "icon": "🎷", "color": "#ff4081"},
    {"id": "saxophone", "name": "Saxophone", "category": "woodwinds", "icon": "🎷", "color": "#f50057"},
    {"id": "flute", "name": "Flute", "category": "woodwinds", "icon": "🪈", "color": "#c51162"},
    {"id": "clarinet", "name": "Clarinet", "category": "woodwinds", "icon": "🪵", "color": "#ff80ab"},
    {"id": "oboe", "name": "Oboe", "category": "woodwinds", "icon": "🪵", "color": "#ec407a"},
    {"id": "bassoon", "name": "Bassoon", "category": "woodwinds", "icon": "🪵", "color": "#ad1457"},
    {"id": "wind", "name": "Winds", "category": "woodwinds", "icon": "💨", "color": "#f06292"},
    {"id": "accordion", "name": "Accordion", "category": "woodwinds", "icon": "🪗", "color": "#ba68c8"},
    {"id": "harmonica", "name": "Harmonica", "category": "woodwinds", "icon": "🎵", "color": "#ab47bc"},

    # Drums & Percussion
    {"id": "drums", "name": "Drum Kit", "category": "drums", "icon": "🥁", "color": "#ff5252"},
    {"id": "kick", "name": "Kick Drum", "category": "drums", "icon": "🥁", "color": "#ff1744"},
    {"id": "snare", "name": "Snare Drum", "category": "drums", "icon": "🥁", "color": "#d50000"},
    {"id": "hh", "name": "Hi-Hat", "category": "drums", "icon": "🥢", "color": "#ff8a80"},
    {"id": "toms", "name": "Toms", "category": "drums", "icon": "🥁", "color": "#ff616f"},
    {"id": "percussion", "name": "Percussion", "category": "percussion", "icon": "🪘", "color": "#ff9800"},
    {"id": "congas", "name": "Congas", "category": "percussion", "icon": "🪘", "color": "#fb8c00"},
    {"id": "tambourine", "name": "Tambourine", "category": "percussion", "icon": "🪇", "color": "#f57c00"},
    {"id": "marimba", "name": "Marimba", "category": "percussion", "icon": "🪵", "color": "#ef6c00"},
    {"id": "glockenspiel", "name": "Glockenspiel", "category": "percussion", "icon": "🔔", "color": "#e65100"},
    {"id": "bells", "name": "Bells", "category": "percussion", "icon": "🔔", "color": "#ffd600"},
    {"id": "timpani", "name": "Timpani", "category": "percussion", "icon": "🥁", "color": "#ffab00"},
    {"id": "triangle", "name": "Triangle", "category": "percussion", "icon": "📐", "color": "#ffc400"},
    {"id": "wind-chimes", "name": "Wind Chimes", "category": "percussion", "icon": "🎐", "color": "#ffe57f"},
]

MEGA_CATALOG_DICT = {item["id"]: item for item in MEGA_53_CATALOG}

# Aliases to map common or legacy names to available 53-stem checkpoint IDs
STEM_ALIASES = {
    "vocals": "lead-vocal",
    "voice": "lead-vocal",
    "other": "strings",
    "keys": "piano",
    "keyboard": "piano",
}


def get_available_mega_models() -> List[str]:
    """Return list of stem IDs that have corresponding .ckpt and .yaml files in v1/."""
    if not MEGA_MODELS_DIR.is_dir():
        return []
    available = []
    for item in MEGA_53_CATALOG:
        stem_id = item["id"]
        ckpt = MEGA_MODELS_DIR / f"bs_mega_53stem_{stem_id}_mvsep.ckpt"
        yaml_path = MEGA_MODELS_DIR / f"bs_mega_53stem_{stem_id}_mvsep_config.yaml"
        if ckpt.is_file() and yaml_path.is_file():
            available.append(stem_id)
    return available


def _infer_chunks(
    model: torch.nn.Module,
    audio: torch.Tensor,
    chunk_size: int,
    overlap: int,
    device: str,
    stft_hop_len: int = 512,
    use_fp16: bool = False,
    progress_fn: Optional[Callable[[int, int], None]] = None,
) -> torch.Tensor:
    """Run overlap-add chunk inference with reflection padding and exact STFT-hop alignment.

    Eliminates edge boundary distortion, avoids irregular tail-step amplitude modulation,
    and aligns all chunk steps with the underlying STFT 512-sample analysis hop grid.
    """
    audio_len = audio.shape[-1]

    # Calculate exact STFT-aligned step so all chunk boundaries align on the STFT hop grid
    step = max(stft_hop_len, (chunk_size // overlap // stft_hop_len) * stft_hop_len)

    # Symmetrical reflection padding: ensures sample 0 sits in the high-confidence center of chunk 0
    # and all samples in the original audio receive identical, perfectly uniform overlap coverage
    pad_left = (chunk_size // 2 // stft_hop_len) * stft_hop_len
    total_steps = int(np.ceil((audio_len + pad_left) / step))
    total_padded_len = total_steps * step + chunk_size
    pad_right = total_padded_len - (pad_left + audio_len)

    if audio_len > max(pad_left, pad_right):
        padded_audio = torch.nn.functional.pad(audio, (pad_left, pad_right), mode="reflect")
    elif audio_len > 1:
        padded_audio = torch.nn.functional.pad(audio, (pad_left, pad_right), mode="replicate")
    else:
        padded_audio = torch.nn.functional.pad(audio, (pad_left, pad_right), mode="constant", value=0.0)

    # Schedule regular, identical chunk offsets with strictly uniform hop size
    chunk_starts = [i * step for i in range(total_steps + 1)]
    num_chunks = len(chunk_starts)
    autocast_device = "cuda" if "cuda" in device else "cpu"

    window = torch.hann_window(chunk_size, device=device)
    result = torch.zeros_like(padded_audio, device=device)
    counter = torch.zeros_like(padded_audio, device=device)

    with torch.no_grad():
        for ch_idx, start_idx in enumerate(chunk_starts):
            if progress_fn:
                progress_fn(ch_idx + 1, num_chunks)

            part = padded_audio[:, start_idx : start_idx + chunk_size]
            if part.shape[-1] < chunk_size:
                part = torch.nn.functional.pad(part, (0, chunk_size - part.shape[-1]))

            input_tensor = part.unsqueeze(0)
            if use_fp16 and "cuda" in device:
                with torch.amp.autocast(autocast_device, dtype=torch.float16):
                    out = model(input_tensor)[0]
            else:
                out = model(input_tensor)[0]

            if out.dim() == 3 and out.shape[0] == 1:
                out = out[0]
            elif out.dim() == 4:
                out = out[0, 0]

            out = out.to(dtype=torch.float32)
            result[:, start_idx : start_idx + chunk_size] += out * window
            counter[:, start_idx : start_idx + chunk_size] += window

    counter.clamp_(min=1e-8)
    result.div_(counter)

    # Slice out strictly the unpadded original audio duration with 100% uniform overlap coverage
    return result[:, pad_left : pad_left + audio_len]


PERCUSSIVE_STEMS = {
    "drums", "kick", "snare", "hh", "toms", "percussion",
    "tambourine", "congas", "timpani", "glockenspiel", "triangle",
}


def enhance_percussive_transients(audio: torch.Tensor, sr: int = 44100) -> torch.Tensor:
    """Restores transient punch and high-frequency air lost to 2048-point STFT smearing.
    
    1. Computes short-term energy envelope (3ms window) to locate fast attacks.
    2. Gently boosts high-frequency air (>7 kHz) to restore cymbal sizzle and snare snap.
    3. Restores crest factor by sharpening the transient onset envelope.
    """
    if audio.shape[-1] < sr // 10:
        return audio
        
    orig_peak = audio.abs().max()
    if orig_peak < 1e-4:
        return audio

    # 1. High-frequency air restoration (subtle high-pass boost for sizzle and stick attack)
    hf = audio - 0.65 * torch.nn.functional.pad(audio[..., :-1], (1, 0))
    
    # 2. Transient envelope detector: short-term RMS (approx 3ms = 132 samples)
    win_len = 132
    audio_sq = (audio ** 2).unsqueeze(0)
    energy_fast = torch.nn.functional.avg_pool1d(
        audio_sq, 
        kernel_size=win_len, 
        stride=1, 
        padding=win_len // 2
    ).squeeze(0)[..., :audio.shape[-1]]
    
    # Local running baseline (approx 100ms) for adaptive dynamic range
    win_slow = min(audio.shape[-1], 4410)
    energy_slow = torch.nn.functional.avg_pool1d(
        audio_sq,
        kernel_size=win_slow,
        stride=1,
        padding=win_slow // 2
    ).squeeze(0)[..., :audio.shape[-1]]

    # Gradient of energy indicates onset attack intensity
    delta_energy = energy_fast - torch.nn.functional.pad(energy_fast[..., :-1], (1, 0))
    attack_mask = torch.clamp(delta_energy / (energy_slow + 1e-5), 0.0, 2.5)
    
    # 3. Blend: base audio + subtle high-frequency air (8%) + attack punch on fast transients (10%)
    enhanced = audio + 0.08 * hf + 0.10 * (audio * attack_mask)
    
    # Normalize peak so we never clip or alter broad gain
    new_peak = enhanced.abs().max()
    if new_peak > 0:
        enhanced = enhanced * (orig_peak / max(new_peak, orig_peak))
        
    return enhanced


def separate_mega_stem(
    stem_id: str,
    wav_tensor: torch.Tensor,
    sr: int,
    device: str,
    quality: str = "high_quality",
    progress_cb: Optional[Callable[[Dict], None]] = None,
    current_index: int = 1,
    total_stems: int = 1,
) -> torch.Tensor:
    """Isolate a single instrument using its specific BS-RoFormer checkpoint."""
    ckpt_path = MEGA_MODELS_DIR / f"bs_mega_53stem_{stem_id}_mvsep.ckpt"
    config_path = MEGA_MODELS_DIR / f"bs_mega_53stem_{stem_id}_mvsep_config.yaml"

    if not ckpt_path.is_file() or not config_path.is_file():
        raise FileNotFoundError(f"Model files for stem '{stem_id}' not found in {MEGA_MODELS_DIR}")

    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.load(f, Loader=yaml.Loader)

    model_params = config["model"]
    import inspect
    sig = inspect.signature(BSRoformer.__init__)
    filtered_params = {k: v for k, v in model_params.items() if k in sig.parameters}

    model = BSRoformer(**filtered_params)

    # Properly construct mask_estimators using mlp_expansion_factor from YAML (Mega 53 uses factor=2)
    mlp_expansion_factor = model_params.get("mlp_expansion_factor", 4)
    if mlp_expansion_factor != 4:
        freqs_per_bands = model_params.get("freqs_per_bands")
        audio_channels = 2 if model_params.get("stereo", True) else 1
        freqs_per_bands_with_complex = tuple(2 * f * audio_channels for f in freqs_per_bands)
        model.mask_estimators = nn.ModuleList([
            MaskEstimator(
                dim=model_params.get("dim", 256),
                dim_inputs=freqs_per_bands_with_complex,
                depth=model_params.get("mask_estimator_depth", 2),
                mlp_expansion_factor=mlp_expansion_factor,
            )
            for _ in range(model_params.get("num_stems", 1))
        ])

    model = model.to(device)
    ckpt = torch.load(ckpt_path, map_location=device)
    if isinstance(ckpt, dict):
        if "state_dict" in ckpt:
            ckpt = ckpt["state_dict"]
        elif "model" in ckpt:
            ckpt = ckpt["model"]
        ckpt = {k.replace("module.", ""): v for k, v in ckpt.items()}

    model.load_state_dict(ckpt, strict=True)
    model.eval()

    dim_t = config.get("inference", {}).get("dim_t", 1101)
    stft_hop_len = model_params.get("stft_hop_length", 512)
    chunk_size = int(stft_hop_len) * (int(dim_t) - 1)

    is_cuda = "cuda" in device and torch.cuda.is_available()
    use_fp16 = (quality == "fast") and is_cuda
    
    is_percussive = stem_id in PERCUSSIVE_STEMS

    # Overlap configuration based on RoFormer paper (arXiv:2104.09864) rotary decay principles:
    # At chunk boundaries, tokens lack full bilateral self-attention context.
    # Hann window overlap-add with overlap >= 4 downweights boundary frames to near zero,
    # ensuring the central frames with deep bidirectional RoPE attention dominate reconstruction.
    if quality == "fast":
        overlap = 2  # 50% Hann overlap-add, FP16 autocast
    elif quality == "high_quality":
        overlap = 4  # 75% Hann overlap-add (COLA compliant, 4x coverage, FP32 neural precision)
    elif quality == "studio_master":
        overlap = 8  # 87.5% Hann overlap-add (8x dense coverage, MVSep benchmark grade, FP32)
    else:
        overlap = 4

    # Test-time augmentation (TTA) with hop-aligned phase synchronization
    shifts = 2 if (quality == "studio_master" and not is_percussive) else 1

    stem_info = MEGA_CATALOG_DICT.get(stem_id, {"name": stem_id.capitalize()})
    display_name = stem_info.get("name", stem_id)

    def make_progress(pass_idx: int, total_passes: int):
        def cb(ch_curr: int, ch_total: int):
            if not progress_cb:
                return
            pass_fraction = (pass_idx - 1 + (ch_curr / ch_total)) / total_passes
            overall_pct = (current_index - 1 + pass_fraction) / total_stems
            pass_str = f" [Pass {pass_idx}/{total_passes}]" if total_passes > 1 else ""
            quality_str = "FP16 Fast" if quality == "fast" else ("Studio Master 8x" if quality == "studio_master" else "High Quality 4x")
            progress_cb({
                "stage": "separating",
                "model": "bs_roformer_mega_53stem",
                "quality": quality,
                "stem": stem_id,
                "stem_name": display_name,
                "stem_index": current_index,
                "total_stems": total_stems,
                "chunk": ch_curr,
                "total_chunks": ch_total,
                "progress": min(0.98, max(0.02, overall_pct)),
                "message": f"Isolating {display_name} ({current_index}/{total_stems}){pass_str}: chunk {ch_curr}/{ch_total} ({int(overall_pct * 100)}% {quality_str})...",
            })
        return cb

    # Pass 1: Standard inference with reflection padding & STFT-hop alignment
    res_pass1 = _infer_chunks(
        model=model,
        audio=wav_tensor,
        chunk_size=chunk_size,
        overlap=overlap,
        device=device,
        stft_hop_len=stft_hop_len,
        use_fp16=use_fp16,
        progress_fn=make_progress(1, shifts),
    )

    if shifts > 1:
        # Hop-aligned time shift (exact multiple of stft_hop_len) ensures STFT analysis frames
        # remain in identical phase alignment between passes, avoiding phase cancellation
        shift_samples = int((sr // 2 // stft_hop_len) * stft_hop_len)
        shifted_audio = torch.nn.functional.pad(wav_tensor, (shift_samples, 0))
        res_shifted = _infer_chunks(
            model=model,
            audio=shifted_audio,
            chunk_size=chunk_size,
            overlap=overlap,
            device=device,
            stft_hop_len=stft_hop_len,
            use_fp16=use_fp16,
            progress_fn=make_progress(2, shifts),
        )
        # De-shift by removing the leading shift_samples
        res_pass2 = res_shifted[:, shift_samples : shift_samples + wav_tensor.shape[-1]]
        if res_pass2.shape[-1] < wav_tensor.shape[-1]:
            res_pass2 = torch.nn.functional.pad(res_pass2, (0, wav_tensor.shape[-1] - res_pass2.shape[-1]))
        elif res_pass2.shape[-1] > wav_tensor.shape[-1]:
            res_pass2 = res_pass2[:, :wav_tensor.shape[-1]]

        result = (res_pass1 + res_pass2) * 0.5
    else:
        result = res_pass1

    # BS-RoFormer is trained with 5-resolution multi-STFT loss (256, 512, 1024, 2048, 4096)
    # which natively captures pristine transients and dynamics without artificial DSP distortion.

    # Clean up model to preserve VRAM for subsequent stems
    del model, ckpt
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return result


def separate_mega_stems(
    audio_path: str,
    out_dir: str,
    selected_stems: Optional[List[str]] = None,
    device: Optional[str] = None,
    quality: str = "high_quality",
    progress_cb: Optional[Callable[[Dict], None]] = None,
) -> Dict[str, Dict]:
    """Execute selective multi-stem separation using BS-RoFormer Mega 53-stem models.

    Args:
        audio_path: Path to input audio WAV or MP3.
        out_dir: Target folder to save stems.
        selected_stems: List of instrument IDs (e.g. ['lead-vocal', 'saxophone', 'piano']).
        device: 'cuda', 'cpu', or 'auto'.
        quality: 'fast', 'high_quality', or 'studio_master'.
        progress_cb: Progress reporting hook.

    Returns:
        stems_meta: Dictionary of stem metadata with waveform peaks.
    """
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # Determine execution device
    if not device or device == "auto":
        dev = "cuda" if torch.cuda.is_available() else "cpu"
    else:
        dev = device

    # Filter and validate selected instruments
    available = set(get_available_mega_models())
    if not selected_stems:
        # Default popular stems if none specified
        selected_stems = ["lead-vocal", "piano", "guitar", "bass", "drums", "strings"]

    resolved_stems = []
    for s in selected_stems:
        clean_s = s.strip().lower()
        if clean_s in available:
            resolved_stems.append(clean_s)
        elif clean_s in STEM_ALIASES and STEM_ALIASES[clean_s] in available:
            resolved_stems.append(STEM_ALIASES[clean_s])

    # De-duplicate while preserving order
    seen = set()
    final_stems = []
    for s in resolved_stems:
        if s not in seen:
            seen.add(s)
            final_stems.append(s)

    if not final_stems:
        final_stems = [s for s in ["lead-vocal", "drums"] if s in available]

    if progress_cb:
        progress_cb({
            "stage": "starting_separation",
            "model": "bs_roformer_mega_53stem",
            "total_stems": len(final_stems),
            "stems": final_stems,
            "message": f"Starting BS-RoFormer Mega separation for {len(final_stems)} instrument(s)...",
        })

    # Load audio into memory
    data, sr = sf.read(str(audio_path), dtype="float32")
    if data.ndim == 1:
        wav_np = np.stack([data, data], axis=0)
    elif data.shape[1] == 2:
        wav_np = data.T
    elif data.shape[1] > 2:
        # Downmix or take first 2 channels for stereo BS-RoFormer
        wav_np = data[:, :2].T
    else:
        wav_np = np.stack([data[:, 0], data[:, 0]], axis=0)

    # Ensure 44.1kHz sample rate
    if sr != 44100:
        try:
            import torchaudio.functional as F_ta
            tensor_wav = torch.from_numpy(wav_np)
            wav_np = F_ta.resample(tensor_wav, orig_freq=sr, new_freq=44100).numpy()
            sr = 44100
        except Exception:
            try:
                import librosa
                wav_resampled = [librosa.resample(wav_np[c], orig_sr=sr, target_sr=44100) for c in range(wav_np.shape[0])]
                wav_np = np.stack(wav_resampled, axis=0)
                sr = 44100
            except Exception as resample_err:
                print(f"[MegaRoFormer] Notice: Resampling error: {resample_err}")

    wav_tensor = torch.tensor(wav_np, dtype=torch.float32, device=dev)
    audio_duration = float(wav_tensor.shape[-1]) / float(sr)

    stems_meta = {}
    saved_stem_paths = {}

    # Sequentially process each selected instrument
    total = len(final_stems)
    for idx, stem_id in enumerate(final_stems, 1):
        stem_tensor = separate_mega_stem(
            stem_id=stem_id,
            wav_tensor=wav_tensor,
            sr=sr,
            device=dev,
            quality=quality,
            progress_cb=progress_cb,
            current_index=idx,
            total_stems=total,
        )

        stem_audio_np = stem_tensor.cpu().numpy().T
        file_path = out_path / f"{stem_id}.wav"
        sf.write(str(file_path), stem_audio_np, sr, subtype="PCM_16")

        # Immediately free GPU tensor to preserve VRAM across multiple stems!
        del stem_tensor
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        peaks = compute_waveform_peaks(file_path, num_peaks=400)
        catalog_entry = MEGA_CATALOG_DICT.get(stem_id, {})
        display_name = catalog_entry.get("name", stem_id.capitalize())

        stems_meta[stem_id] = {
            "name": display_name,
            "filename": f"{stem_id}.wav",
            "path": str(file_path),
            "duration": audio_duration,
            "peaks": peaks,
            "category": catalog_entry.get("category", "other"),
            "icon": catalog_entry.get("icon", "🎵"),
            "color": catalog_entry.get("color", "#00e5ff"),
        }
        saved_stem_paths[stem_id] = file_path

        # Save intermediate stems_meta so if polled or inspected, meta has all completed stems
        try:
            with open(out_path / "stems_meta.json", "w", encoding="utf-8") as f:
                json.dump(stems_meta, f, indent=2)
        except Exception:
            pass

        if progress_cb:
            progress_cb({
                "stage": "stem_completed",
                "stem": stem_id,
                "stem_name": display_name,
                "completed_stems": idx,
                "total_stems": total,
                "stems_meta": stems_meta,
                "message": f"Completed {display_name} ({idx}/{total})...",
            })

    # Synthesize instrumental backing track on CPU if any vocal stem was isolated
    vocal_keys = [k for k in saved_stem_paths.keys() if "vocal" in k]
    non_vocal_keys = [k for k in saved_stem_paths.keys() if "vocal" not in k]

    if vocal_keys and non_vocal_keys:
        inst_audio_np = None
        for k in non_vocal_keys:
            p = saved_stem_paths[k]
            track_data, _ = sf.read(str(p), dtype="float32")
            if inst_audio_np is None:
                inst_audio_np = track_data.copy()
            else:
                inst_audio_np += track_data

        if inst_audio_np is not None:
            max_val = np.max(np.abs(inst_audio_np))
            if max_val > 1.0:
                inst_audio_np = inst_audio_np / max_val * 0.99

            inst_file = out_path / "instrumental.wav"
            sf.write(str(inst_file), inst_audio_np, sr, subtype="PCM_16")
            inst_peaks = compute_waveform_peaks(inst_file, num_peaks=400)

            stems_meta["instrumental"] = {
                "name": "Instrumental (Backing Mix)",
                "filename": "instrumental.wav",
                "path": str(inst_file),
                "duration": audio_duration,
                "peaks": inst_peaks,
                "category": "backing",
                "icon": "🎛️",
                "color": "#448aff",
            }
            try:
                with open(out_path / "stems_meta.json", "w", encoding="utf-8") as f:
                    json.dump(stems_meta, f, indent=2)
            except Exception:
                pass

    # Save stems metadata to disk
    with open(out_path / "stems_meta.json", "w", encoding="utf-8") as f:
        json.dump(stems_meta, f, indent=2)

    # Free input wave tensor
    del wav_tensor
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    if progress_cb:
        progress_cb({
            "stage": "completed",
            "progress": 1.0,
            "message": f"Successfully separated {len(stems_meta)} stems with BS-RoFormer Mega!",
        })

    return stems_meta
