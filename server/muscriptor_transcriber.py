"""MuScriptor Safetensors Transcription Engine for SteMidi Studio.

Uses native PyTorch CUDA acceleration with models/muscriptor-medium/model.safetensors
to transcribe audio stems directly to standard Type 1 multi-track MIDI.
Generates interactive Piano Roll note events with zero ONNX or score-rendering overhead.
"""

from __future__ import annotations

import dataclasses
import io
import json
import math
import os
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import librosa
import numpy as np
import pretty_midi
import soundfile as sf
import torch

from muscriptor.events import NoteEndEvent, NoteStartEvent, ProgressEvent
from muscriptor.tokenizer.mt3 import MT3_FULL_PLUS_GROUP_NAMES
from muscriptor.transcription_model import TranscriptionModel
from muscriptor.utils.beats import BeatGrid

from .transcription_postprocess import (  # noqa: F401  (sanitize_* re-exported)
    TNote,
    load_analysis,
    merge_fragmented_notes,
    postprocess_notes,
    sanitize_polyphonic_clusters,
)

STUDIO_DIR = Path(__file__).resolve().parent.parent
MODELS_ROOT = Path(os.environ.get("STUDIO_MODELS_DIR", STUDIO_DIR / "models"))
MODEL_PATHS = {
    "large": MODELS_ROOT / "muscriptor-large" / "model.safetensors",
    "medium": MODELS_ROOT / "muscriptor-medium" / "model.safetensors",
}
DEFAULT_MODEL_SIZE = "large" if MODEL_PATHS["large"].is_file() else "medium"
DEFAULT_WEIGHTS_PATH = MODEL_PATHS[DEFAULT_MODEL_SIZE]

DRUM_NOTE_SECONDS = 0.06  # display/playback length for instantaneous drum hits

# Beat grids are detected on the full mix and reused for every stem of a session
# (the transcriber singleton is unloaded after each job, so cache at module level).
_BEAT_GRID_CACHE: Dict[Tuple[str, float, int], Tuple[Optional[BeatGrid], bool]] = {}


def detect_beat_grid(audio_path: Union[str, Path], device: str = "cpu") -> Tuple[Optional[BeatGrid], bool]:
    """Track beats/downbeats with beat_this and fit a grid.

    Unlike ``muscriptor.utils.beats.detect_grid`` this never discards the tracked
    beats when the tempo drifts: the fitted (average) BPM is still returned and
    the beat times stay attached, so onset-lag correction keeps working on
    live/rubato recordings. Returns ``(grid, tempo_is_steady)``.
    """
    from muscriptor.utils.beats import (
        MAX_TEMPO_RESIDUAL,
        MIN_BEATS,
        fit_tempo,
        infer_beats_per_bar,
    )

    p = Path(audio_path)
    st = p.stat()
    key = (str(p.resolve()), st.st_mtime, st.st_size)
    if key in _BEAT_GRID_CACHE:
        return _BEAT_GRID_CACHE[key]

    from beat_this.inference import Audio2Beats
    from muscriptor.utils.audio import load_audio

    sr = 16000
    signal = load_audio(p, target_sr=sr).mean(dim=0).cpu().numpy()
    result: Tuple[Optional[BeatGrid], bool] = (None, False)
    if len(signal) >= sr:
        beats, downbeats = Audio2Beats(checkpoint_path="final0", device=device, dbn=False)(signal, sr)
        beats = np.asarray(beats, dtype=float)
        downbeats = np.asarray(downbeats, dtype=float)
        if len(beats) >= MIN_BEATS:
            bpm, residual = fit_tempo(beats)
            steady = residual <= MAX_TEMPO_RESIDUAL * 60.0 / bpm
            grid = BeatGrid(
                bpm=bpm,
                beats_per_bar=infer_beats_per_bar(beats, downbeats),
                first_downbeat=float(downbeats[0]) if len(downbeats) else float(beats[0]),
                beats=beats,
            )
            print(
                f"[MuScriptor] Beat tracking: {bpm:.2f} BPM, meter={grid.beats_per_bar or '?'}, "
                f"residual {residual * 1000:.0f} ms ({'steady' if steady else 'variable tempo'})"
            )
            result = (grid, steady)
    _BEAT_GRID_CACHE[key] = result
    return result


# Clean 35-instrument catalog with UI categories and icons
MUSCRIPTOR_INSTRUMENT_CATEGORIES = [
    {
        "category": "Keyboards & Pianos",
        "icon": "🎹",
        "color": "#00e676",
        "instruments": [
            {"id": "acoustic_piano", "name": "Acoustic Piano"},
            {"id": "electric_piano", "name": "Electric Piano"},
            {"id": "organ", "name": "Organ"},
        ],
    },
    {
        "category": "Guitars",
        "icon": "🎸",
        "color": "#ffab00",
        "instruments": [
            {"id": "acoustic_guitar", "name": "Acoustic Guitar"},
            {"id": "clean_electric_guitar", "name": "Clean Electric Guitar"},
            {"id": "distorted_electric_guitar", "name": "Distorted Electric Guitar"},
        ],
    },
    {
        "category": "Bass",
        "icon": "🎸",
        "color": "#b388ff",
        "instruments": [
            {"id": "acoustic_bass", "name": "Acoustic Bass"},
            {"id": "electric_bass", "name": "Electric Bass"},
        ],
    },
    {
        "category": "Vocals",
        "icon": "🎤",
        "color": "#00e5ff",
        "instruments": [
            {"id": "voice", "name": "Voice / Vocals"},
        ],
    },
    {
        "category": "Strings & Orchestral",
        "icon": "🎻",
        "color": "#e040fb",
        "instruments": [
            {"id": "violin", "name": "Violin"},
            {"id": "viola", "name": "Viola"},
            {"id": "cello", "name": "Cello"},
            {"id": "contrabass", "name": "Contrabass"},
            {"id": "orchestral_harp", "name": "Orchestral Harp"},
            {"id": "string_ensemble", "name": "String Ensemble"},
            {"id": "synth_strings", "name": "Synth Strings"},
        ],
    },
    {
        "category": "Brass",
        "icon": "🎺",
        "color": "#ff6e40",
        "instruments": [
            {"id": "trumpet", "name": "Trumpet"},
            {"id": "trombone", "name": "Trombone"},
            {"id": "tuba", "name": "Tuba"},
            {"id": "french_horn", "name": "French Horn"},
            {"id": "brass_section", "name": "Brass Section"},
        ],
    },
    {
        "category": "Woodwinds",
        "icon": "🎷",
        "color": "#ff4081",
        "instruments": [
            {"id": "soprano_and_alto_sax", "name": "Alto / Soprano Sax"},
            {"id": "tenor_sax", "name": "Tenor Sax"},
            {"id": "baritone_sax", "name": "Baritone Sax"},
            {"id": "oboe", "name": "Oboe"},
            {"id": "english_horn", "name": "English Horn"},
            {"id": "bassoon", "name": "Bassoon"},
            {"id": "clarinet", "name": "Clarinet"},
            {"id": "flutes", "name": "Flutes"},
        ],
    },
    {
        "category": "Synths",
        "icon": "🎛️",
        "color": "#00bfa5",
        "instruments": [
            {"id": "synth_lead", "name": "Synth Lead"},
            {"id": "synth_pad", "name": "Synth Pad"},
        ],
    },
    {
        "category": "Drums & Percussion",
        "icon": "🥁",
        "color": "#ff5252",
        "instruments": [
            {"id": "drums", "name": "Drum Kit"},
            {"id": "chromatic_percussion", "name": "Chromatic Percussion"},
            {"id": "timpani", "name": "Timpani"},
            {"id": "orchestra_hit", "name": "Orchestra Hit"},
        ],
    },
]


class MuscriptorTranscriber:
    """Singleton PyTorch Safetensors transcriber for MuScriptor (Medium / Large)."""

    _instance: Optional["MuscriptorTranscriber"] = None

    def __init__(
        self,
        weights_path: Optional[Union[str, Path]] = None,
        model_size: Optional[str] = None,
        device: str = "auto",
    ):
        if weights_path:
            self.weights_path = Path(weights_path)
            self.model_size = "large" if "large" in str(self.weights_path).lower() else "medium"
        else:
            size_key = (model_size or DEFAULT_MODEL_SIZE).lower().replace("muscriptor_", "").replace("muscriptor-", "")
            if size_key not in MODEL_PATHS or not MODEL_PATHS[size_key].is_file():
                # Fallback to available model
                size_key = "large" if MODEL_PATHS["large"].is_file() else "medium"
            self.model_size = size_key
            self.weights_path = MODEL_PATHS[self.model_size]

        if not self.weights_path.is_file():
            raise FileNotFoundError(f"MuScriptor safetensors model not found at {self.weights_path}")

        if not device or device == "auto":
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device

        dtype = None
        if self.device == "cuda" and torch.cuda.is_available():
            dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16

        print(f"[MuScriptor] Loading {self.model_size.upper()} model from {self.weights_path} onto {self.device} (dtype={dtype})...")
        t0 = time.time()
        self.model = TranscriptionModel.load_model(str(self.weights_path), device=self.device, dtype=dtype)
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        print(f"[MuScriptor] Model {self.model_size.upper()} loaded in {time.time() - t0:.2f}s on {self.device}")

    @classmethod
    def get_instance(
        cls,
        weights_path: Optional[Union[str, Path]] = None,
        model_size: Optional[str] = None,
        device: str = "auto",
    ) -> "MuscriptorTranscriber":
        resolved_device = "cuda" if (not device or device == "auto") and torch.cuda.is_available() else (device or "cpu")
        norm_size = (model_size or DEFAULT_MODEL_SIZE).lower().replace("muscriptor_", "").replace("muscriptor-", "")

        # If resident instance has different device or different model size/weights, unload first
        if cls._instance is not None:
            needs_reload = False
            if cls._instance.device != resolved_device:
                needs_reload = True
            elif weights_path and Path(weights_path) != cls._instance.weights_path:
                needs_reload = True
            elif not weights_path and norm_size and norm_size != getattr(cls._instance, "model_size", None):
                needs_reload = True

            if needs_reload:
                print(f"[MuScriptor] Switching model instance from {getattr(cls._instance, 'model_size', 'unknown')} to {norm_size}")
                cls.unload()

        if cls._instance is None:
            cls._instance = cls(weights_path=weights_path, model_size=model_size, device=resolved_device)
        return cls._instance

    @classmethod
    def unload(cls) -> None:
        """Unload MuScriptor model from VRAM and free GPU cache."""
        if cls._instance is not None:
            try:
                if hasattr(cls._instance, "model") and cls._instance.model is not None:
                    del cls._instance.model
            except Exception as e:
                print(f"[MuScriptor] Notice during unload: {e}")
            cls._instance = None
            import gc
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            print("[MuScriptor] Model unloaded from VRAM.")

    @classmethod
    def is_loaded(cls) -> bool:
        """Check if model is currently resident in VRAM."""
        return cls._instance is not None and getattr(cls._instance, "model", None) is not None

    def transcribe(
        self,
        audio_path: Union[str, Path],
        output_dir: Optional[Union[str, Path]] = None,
        instruments: Optional[List[str]] = None,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
        target_stem: str = "original",
        cfg_coef: float = 2.0,
        beam_size: int = 1,
        manual_bpm: Optional[float] = None,
        consolidate_single_track: bool = False,
        beat_grid_audio_path: Optional[Union[str, Path]] = None,
        max_gen_len: int = 1024,
        refine_with_audio: bool = True,
    ) -> Dict[str, Any]:
        """Transcribe audio file directly to Type 1 MIDI and Piano Roll note events.

        Follows arXiv:2607.08168 (MuScriptor):
        - CFG strength alpha=2.0 for sharp onset precision and noise suppression.
        - Instrument conditioning prefix for segment boundary stability.
        - Beat tracking on the full mix (cached per file) for tempo/meter, and to
          remove the model's constant onset lag (up to ~25 ms) against the beats.
        - Audio-backed note cleanup (see server/transcription_postprocess.py):
          chunk-seam fragment merging, ghost-note removal, transient-cluster
          suppression, offset refinement and expressive velocities.

        All note times (MIDI file and piano-roll events) are in *audio time*, so
        the MIDI lines up with the audio/stems from t=0 in the studio and in DAWs.
        (MuScriptor's own writer delays notes to put bar 1 on the first downbeat,
        which de-synced the MIDI from the audio by up to one bar.)
        """
        import warnings

        audio_path = Path(audio_path)
        if not audio_path.is_file():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        if output_dir:
            out_dir = Path(output_dir)
            out_dir.mkdir(parents=True, exist_ok=True)
        else:
            out_dir = audio_path.parent

        # Query audio duration
        duration_seconds = 0.0
        try:
            info = sf.info(str(audio_path))
            duration_seconds = float(info.duration)
        except Exception:
            try:
                duration_seconds = float(librosa.get_duration(path=str(audio_path)))
            except Exception:
                duration_seconds = 0.0

        # Validate or auto-derive instruments constraint
        valid_instruments: Optional[List[str]] = None
        known_groups = set(MT3_FULL_PLUS_GROUP_NAMES.keys())

        if instruments:
            cleaned = []
            for inst in instruments:
                clean_name = inst.strip().lower().replace("-", "_").replace(" ", "_")
                if clean_name in known_groups and clean_name not in cleaned:
                    cleaned.append(clean_name)
            if cleaned:
                valid_instruments = cleaned

        # When valid_instruments is None, MuScriptor transcribes unconstrained across all instrument groups
        print(f"[MuScriptor] Transcribing '{target_stem}' with CFG={cfg_coef}, conditioning={valid_instruments or 'unconstrained (all instruments)'}")

        if progress_callback:
            progress_callback({
                "type": "status",
                "stage": "transcribing",
                "message": f"Transcribing with MuScriptor ({self.device.upper()}, CFG={cfg_coef}, inst={valid_instruments or 'auto'})...",
            })

        t_start = time.time()
        raw_events: List[Any] = []
        total_chunks = max(1, math.ceil(duration_seconds / 5.0)) if duration_seconds > 0 else 1

        with warnings.catch_warnings():
            # "chunk N did not emit EOS" is expected occasionally; it is logged once below.
            warnings.filterwarnings("ignore", message=r".*did not emit EOS.*", category=RuntimeWarning)
            for ev in self.model.transcribe(
                str(audio_path),
                instruments=valid_instruments,
                cfg_coef=cfg_coef,
                beam_size=beam_size,
                prelude_forcing=True,
                max_gen_len=max_gen_len,
            ):
                raw_events.append(ev)
                if isinstance(ev, ProgressEvent):
                    total_chunks = max(total_chunks, ev.total)
                    pct = ev.completed / float(max(1, total_chunks))
                    if progress_callback:
                        progress_callback({
                            "type": "progress",
                            "data": {
                                "stage": "transcribing",
                                "model": f"muscriptor_{self.model_size}",
                                "chunk": ev.completed,
                                "total_chunks": total_chunks,
                                "progress": min(0.99, max(0.01, pct)),
                                "message": f"Transcribing to MIDI ({self.model_size.upper()}): chunk {ev.completed}/{total_chunks} ({int(pct * 100)}%)...",
                            },
                        })

        notes = self._events_to_notes(raw_events)
        print(f"[MuScriptor] Decoded {len(notes)} raw notes in {time.time() - t_start:.2f}s")

        if progress_callback:
            progress_callback({
                "type": "status",
                "stage": "building_midi",
                "message": "Detecting beat grid and refining notes against the audio...",
            })

        # ---- Beat grid & tempo -------------------------------------------------
        beat_grid, tempo_steady = self._resolve_beat_grid(audio_path, beat_grid_audio_path, manual_bpm)
        detected_bpm_val = round(float(beat_grid.bpm), 1) if beat_grid else None
        detected_meter_val = (beat_grid.beats_per_bar if beat_grid else None) or 4

        # ---- Remove the model's constant onset lag against the tracked beats ----
        onset_delay = 0.0
        if beat_grid is not None and beat_grid.beats is not None and notes:
            try:
                onset_delay = float(beat_grid.with_onset_delay([n.start for n in notes]).onset_delay or 0.0)
            except Exception as od_err:
                print(f"[MuScriptor] Onset-delay estimation notice: {od_err}")
        if onset_delay:
            for n in notes:
                n.start = max(0.0, n.start - onset_delay)
                n.end = max(n.start + 0.01, n.end - onset_delay)
            print(f"[MuScriptor] Corrected model onset lag: {onset_delay * 1000:+.1f} ms")

        # ---- Audio-backed note cleanup -----------------------------------------
        analysis = None
        if refine_with_audio and notes:
            try:
                t_an = time.time()
                analysis = load_analysis(str(audio_path))
                print(f"[MuScriptor] Pitch-energy analysis ready in {time.time() - t_an:.2f}s")
            except Exception as an_err:
                print(f"[MuScriptor] Audio analysis unavailable, structural cleanup only: {an_err}")
        n_before = len(notes)
        notes, pp_stats = postprocess_notes(notes, analysis)
        print(f"[MuScriptor] Note cleanup: {n_before} -> {len(notes)} notes {pp_stats}")

        # ---- Single track consolidation if requested or if isolated bass stem ---
        is_bass_context = bool(target_stem and any(b in target_stem.lower() for b in ["bass", "contrabass"]))
        inst_names = {n.instrument for n in notes if not n.is_drum}
        if (consolidate_single_track or is_bass_context) and len(inst_names) > 1:
            counts: Dict[str, int] = {}
            for n in notes:
                if not n.is_drum:
                    counts[n.instrument] = counts.get(n.instrument, 0) + 1
            primary = max(counts, key=counts.get)
            for n in notes:
                if not n.is_drum:
                    n.instrument = primary
            # Same pitch from two former tracks may now overlap: fold them together.
            notes, _ = merge_fragmented_notes(notes, analysis=None)
            print(f"[MuScriptor] Consolidated {len(inst_names)} pitched tracks into '{primary}'")

        # ---- Serialize MIDI (audio-time aligned) --------------------------------
        midi_bytes = self._notes_to_midi_bytes(notes, bpm=detected_bpm_val or 120.0, beats_per_bar=beat_grid.beats_per_bar if beat_grid else None)
        midi_filename = "transcription.mid"
        midi_path = out_dir / midi_filename
        midi_path.write_bytes(midi_bytes)
        elapsed = time.time() - t_start
        print(f"[MuScriptor] Transcribed {duration_seconds:.1f}s audio in {elapsed:.2f}s ({len(midi_bytes)} MIDI bytes)")

        # ---- Piano Roll events straight from the cleaned notes ------------------
        events_for_piano_roll: List[Dict[str, Any]] = []
        instruments_detected: List[str] = []
        for n in notes:
            track_name = self._track_name(n.instrument)
            if track_name not in instruments_detected:
                instruments_detected.append(track_name)
            if not n.is_drum and (n.pitch < 21 or n.pitch > 108):
                continue
            dur = DRUM_NOTE_SECONDS if n.is_drum else max(0.01, n.end - n.start)
            events_for_piano_roll.append({
                "time": round(float(n.start), 4),
                "values": {
                    "pitch": int(n.pitch),
                    "duration": round(float(dur), 4),
                    "instrument": track_name,
                    "velocity": int(n.velocity),
                },
            })
        events_for_piano_roll.sort(key=lambda x: x["time"])
        if notes:
            duration_seconds = max(duration_seconds, max(n.end for n in notes))

        # Format result payload
        result = {
            "target_stem": target_stem,
            "model_type": f"muscriptor_{self.model_size}",
            "device": self.device,
            "midi_file": midi_filename,
            "midi_path": str(midi_path),
            "duration_seconds": round(duration_seconds, 2),
            "detected_bpm": detected_bpm_val,
            "beats_per_bar": detected_meter_val,
            "first_downbeat": round(float(beat_grid.first_downbeat), 4) if beat_grid else None,
            "tempo_steady": tempo_steady,
            "onset_delay_ms": round(onset_delay * 1000.0, 1),
            "postprocess": pp_stats,
            "instruments_detected": instruments_detected,
            "events_count": len(events_for_piano_roll),
            "events": events_for_piano_roll,
            "transcription_time_seconds": round(elapsed, 2),
        }

        # Write result.json
        try:
            with open(out_dir / "result.json", "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
        except Exception as json_err:
            print(f"[MuScriptor] Notice: failed writing result.json: {json_err}")

        return result

    # ------------------------------------------------------------------
    @staticmethod
    def _events_to_notes(raw_events: List[Any]) -> List[TNote]:
        """Pair NoteStart/NoteEnd events into notes in audio time."""
        open_notes: Dict[int, NoteStartEvent] = {}
        notes: List[TNote] = []
        for ev in raw_events:
            if isinstance(ev, NoteStartEvent):
                open_notes[ev.index] = ev
            elif isinstance(ev, NoteEndEvent):
                start_ev = open_notes.pop(ev.start_event_index, None)
                if start_ev is None:
                    continue
                is_drum = start_ev.instrument == "drums"
                start = float(start_ev.start_time)
                end = start + DRUM_NOTE_SECONDS if is_drum else max(float(ev.end_time), start + 0.01)
                notes.append(TNote(
                    pitch=int(start_ev.pitch),
                    start=start,
                    end=end,
                    instrument=start_ev.instrument,
                    is_drum=is_drum,
                ))
        for start_ev in open_notes.values():
            is_drum = start_ev.instrument == "drums"
            start = float(start_ev.start_time)
            end = start + DRUM_NOTE_SECONDS if is_drum else start + 0.2
            notes.append(TNote(
                pitch=int(start_ev.pitch),
                start=start,
                end=end,
                instrument=start_ev.instrument,
                is_drum=is_drum,
            ))
        notes.sort(key=lambda n: (n.start, n.pitch))
        return notes

    def _resolve_beat_grid(
        self,
        audio_path: Path,
        beat_grid_audio_path: Optional[Union[str, Path]],
        manual_bpm: Optional[float],
    ) -> Tuple[Optional[BeatGrid], bool]:
        """Beat grid from the full mix (preferred) or the stem, honouring a manual BPM.

        A manual/session BPM overrides the tempo but keeps the tracked beats and
        downbeat when they agree (within 4%), so every stem of a session still
        gets onset-lag correction and consistent bar positions.
        """
        bg_audio = (
            Path(beat_grid_audio_path)
            if beat_grid_audio_path and Path(beat_grid_audio_path).is_file()
            else audio_path
        )
        detected: Optional[BeatGrid] = None
        steady = False
        try:
            detected, steady = detect_beat_grid(bg_audio, device=self.device)
        except Exception as bt_err:
            print(f"[MuScriptor] Beat tracking notice: {bt_err}")

        if detected is None:
            # Fallback librosa tempo estimation
            try:
                y_bg, sr_bg = librosa.load(str(bg_audio), sr=22050, duration=120.0)
                tempo_res, beat_frames = librosa.beat.beat_track(y=y_bg, sr=sr_bg)
                bpm_cand = float(np.atleast_1d(tempo_res)[0])
                beat_times = librosa.frames_to_time(beat_frames, sr=sr_bg)
                if 40.0 <= bpm_cand <= 260.0:
                    detected = BeatGrid(
                        bpm=bpm_cand,
                        beats_per_bar=None,
                        first_downbeat=float(beat_times[0]) if len(beat_times) else 0.0,
                        beats=beat_times if len(beat_times) >= 8 else None,
                    )
                    print(f"[MuScriptor] Detected tempo via librosa: {bpm_cand:.1f} BPM")
            except Exception as l_err:
                print(f"[MuScriptor] Librosa tempo fallback notice: {l_err}")

        try:
            manual = float(manual_bpm) if manual_bpm else 0.0
        except (TypeError, ValueError):
            manual = 0.0
        if manual > 0:
            if detected is not None and abs(manual / detected.bpm - 1.0) <= 0.04:
                print(f"[MuScriptor] Manual tempo {manual:.1f} BPM (tracked beats kept for alignment)")
                return dataclasses.replace(detected, bpm=manual, onset_delay=None), steady
            print(f"[MuScriptor] Manual tempo override active: {manual:.1f} BPM")
            return BeatGrid(
                bpm=manual,
                beats_per_bar=(detected.beats_per_bar if detected else None) or 4,
                first_downbeat=detected.first_downbeat if detected else 0.0,
            ), True
        return detected, steady

    @staticmethod
    def _track_name(instrument: str) -> str:
        return instrument.replace("_", " ")

    def _program_for(self, instrument: str) -> int:
        try:
            return int(self.model._program_for_instrument(instrument))
        except Exception:
            return 0

    def _notes_to_midi_bytes(self, notes: List[TNote], bpm: float, beats_per_bar: Optional[int]) -> bytes:
        """Type 1 MIDI with real tempo/meter, expressive velocities, audio-time aligned."""
        pm = pretty_midi.PrettyMIDI(resolution=480, initial_tempo=float(bpm))
        if beats_per_bar:
            pm.time_signature_changes.append(pretty_midi.TimeSignature(int(beats_per_bar), 4, 0.0))

        tracks: Dict[str, pretty_midi.Instrument] = {}
        for n in sorted(notes, key=lambda x: (x.start, x.pitch)):
            inst = tracks.get(n.instrument)
            if inst is None:
                inst = pretty_midi.Instrument(
                    program=0 if n.is_drum else self._program_for(n.instrument),
                    is_drum=n.is_drum,
                    name=self._track_name(n.instrument),
                )
                tracks[n.instrument] = inst
                pm.instruments.append(inst)
            start = max(0.0, float(n.start))
            end = start + DRUM_NOTE_SECONDS if n.is_drum else max(float(n.end), start + 0.01)
            inst.notes.append(pretty_midi.Note(
                velocity=int(np.clip(n.velocity, 1, 127)),
                pitch=int(np.clip(n.pitch, 0, 127)),
                start=start,
                end=end,
            ))

        buf = io.BytesIO()
        pm.write(buf)
        return buf.getvalue()
