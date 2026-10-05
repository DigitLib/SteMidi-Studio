"""Session management and asynchronous pipeline execution for SteMidi Studio.

Architecture:
- Separation: Exclusively BS-RoFormer Mega-53-stems (server/mega_roformer_separator.py)
- Transcription: Exclusively MuScriptor Medium Safetensors to MIDI (server/muscriptor_transcriber.py)
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
import io
import json
import os
from pathlib import Path
import shutil
import time
from typing import Any, Callable, Dict, List, Optional
import uuid

import pretty_midi
import torch

from .mega_roformer_separator import separate_mega_stems
from .muscriptor_transcriber import MuscriptorTranscriber
from .utils import compute_waveform_peaks, convert_to_wav, normalize_stem_audio

STUDIO_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = STUDIO_DIR.parent
SESSIONS_DIR = Path(
    os.environ.get(
        "STUDIO_SESSIONS_DIR",
        ROOT_DIR / "output" / "sessions"
        if (ROOT_DIR / "output").is_dir()
        else STUDIO_DIR / "output" / "sessions",
    )
)
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class Session:
    session_id: str
    created_at: float
    filename: str
    audio_path: Path
    wav_path: Path
    duration: float = 0.0
    peaks: List[float] = field(default_factory=list)
    status: str = "ready"  # ready, processing, completed, error
    progress: Dict[str, Any] = field(default_factory=dict)
    error_message: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    options: Dict[str, Any] = field(default_factory=dict)
    stems: Dict[str, Any] = field(default_factory=dict)
    stems_status: str = "none"  # none, processing, ready, error
    stems_error: Optional[str] = None


class SessionManager:
    def __init__(self):
        self.sessions: Dict[str, Session] = {}
        self.listeners: Dict[str, List[Any]] = {}
        self.executor = ThreadPoolExecutor(max_workers=2)

    def create_session(self, filename: str, audio_bytes: bytes) -> Session:
        session_id = f"sess_{uuid.uuid4().hex[:10]}"
        session_dir = SESSIONS_DIR / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        ext = Path(filename).suffix or ".wav"
        raw_audio_path = session_dir / f"original{ext}"
        with open(raw_audio_path, "wb") as f:
            f.write(audio_bytes)

        # Convert to standard WAV for web player
        wav_path = session_dir / "audio.wav"
        try:
            convert_to_wav(raw_audio_path, wav_path)
        except Exception as e:
            print(f"Direct copy fallback due to: {e}")
            shutil.copy2(raw_audio_path, wav_path)

        # Compute waveform peaks
        peaks = compute_waveform_peaks(wav_path, num_peaks=800)

        # Duration
        duration = 0.0
        try:
            import wave
            with wave.open(str(wav_path), "rb") as wf:
                duration = wf.getnframes() / float(wf.getframerate())
        except Exception as exc:
            duration = (len(peaks) / 800.0) * 80.0

        session = Session(
            session_id=session_id,
            created_at=time.time(),
            filename=filename,
            audio_path=raw_audio_path,
            wav_path=wav_path,
            duration=duration,
            peaks=peaks,
            status="ready",
        )
        self.sessions[session_id] = session

        try:
            info_payload = {
                "session_id": session_id,
                "filename": filename,
                "created_at": session.created_at,
                "duration": duration,
                "peaks": peaks,
            }
            with open(session_dir / "session_info.json", "w", encoding="utf-8") as f:
                json.dump(info_payload, f, indent=2)
            with open(session_dir / "peaks.json", "w", encoding="utf-8") as pf:
                json.dump(peaks, pf)
        except Exception:
            pass

        return session

    def get_or_load_session(self, session_id: str) -> Optional[Session]:
        """Get session from memory or restore it from session directory on disk."""
        session = self.sessions.get(session_id)
        session_dir = SESSIONS_DIR / session_id
        if session:
            if not session.stems:
                session.stems = self.get_session_stems(session_id)
            if session.status != "processing" and session_dir.is_dir():
                result_file = session_dir / "result.json"
                if result_file.is_file():
                    try:
                        rmtime = result_file.stat().st_mtime
                        if getattr(session, "_result_mtime", 0) < rmtime:
                            with open(result_file, "r", encoding="utf-8") as rf:
                                session.result = json.load(rf)
                            session._result_mtime = rmtime
                    except Exception:
                        pass
            return session

        session_dir = SESSIONS_DIR / session_id
        if not session_dir.is_dir():
            return None

        raw_path = session_dir / "original.wav"
        wav_path = session_dir / "audio.wav"
        if not raw_path.is_file():
            orig_files = list(session_dir.glob("original.*"))
            raw_path = orig_files[0] if orig_files else wav_path
        if not wav_path.is_file():
            if raw_path.is_file():
                wav_path = raw_path
            else:
                return None

        # Load metadata and cached peaks instantly from disk (prevents slow WAV recalculation)
        filename = session_id
        created_at = session_dir.stat().st_mtime
        duration = 0.0
        peaks = None

        peaks_file = session_dir / "peaks.json"
        if peaks_file.is_file():
            try:
                with open(peaks_file, "r", encoding="utf-8") as pf:
                    peaks = json.load(pf)
            except Exception:
                peaks = None

        info_file = session_dir / "session_info.json"
        if info_file.is_file():
            try:
                with open(info_file, "r", encoding="utf-8") as f:
                    info = json.load(f)
                    filename = info.get("filename", filename)
                    created_at = info.get("created_at", created_at)
                    if info.get("duration"):
                        duration = info.get("duration")
                    if not peaks and info.get("peaks"):
                        peaks = info.get("peaks")
            except Exception:
                pass

        if not duration or duration <= 0:
            try:
                import wave
                with wave.open(str(wav_path), "rb") as wf:
                    duration = wf.getnframes() / float(wf.getframerate())
            except Exception:
                pass

        if not peaks:
            peaks = compute_waveform_peaks(wav_path, num_peaks=800)
            try:
                with open(peaks_file, "w", encoding="utf-8") as pf:
                    json.dump(peaks, pf)
            except Exception:
                pass

        result_data = None
        result_file = session_dir / "result.json"
        if result_file.is_file():
            try:
                with open(result_file, "r", encoding="utf-8") as f:
                    result_data = json.load(f)
                    if not filename or filename == session_id:
                        filename = result_data.get("audio", filename)
                    if not duration or duration <= 0:
                        duration = result_data.get("duration_seconds", duration)
            except Exception:
                pass

        # Auto-recovery if result.json is missing but transcription.mid exists
        if not result_data:
            midi_p = session_dir / "transcription.mid"
            if midi_p.is_file():
                try:
                    pm = pretty_midi.PrettyMIDI(str(midi_p))
                    if not duration or duration <= 0:
                        duration = pm.get_end_time()
                    recovered_events = []
                    inst_detected = set()
                    for inst in pm.instruments:
                        iname = (inst.name or "acoustic_piano").lower().replace(" ", "_")
                        inst_detected.add(iname)
                        for note in inst.notes:
                            recovered_events.append({
                                "time": round(float(note.start), 4),
                                "values": {
                                    "pitch": int(note.pitch),
                                    "duration": round(float(note.end - note.start), 4),
                                    "instrument": iname,
                                    "velocity": int(note.velocity),
                                },
                            })
                    recovered_events.sort(key=lambda x: x["time"])
                    result_data = {
                        "target_stem": "original",
                        "model_type": "muscriptor_medium",
                        "device": "cuda" if torch.cuda.is_available() else "cpu",
                        "midi_file": "transcription.mid",
                        "midi_path": str(midi_p),
                        "instruments_detected": sorted(list(inst_detected)),
                        "duration_seconds": round(duration, 2),
                        "events_count": len(recovered_events),
                        "events": recovered_events,
                    }
                    with open(result_file, "w", encoding="utf-8") as f:
                        json.dump(result_data, f, indent=2)
                except Exception as e:
                    print(f"MIDI recovery note: {e}")

        session = Session(
            session_id=session_id,
            created_at=created_at,
            filename=filename,
            audio_path=raw_path,
            wav_path=wav_path,
            duration=duration,
            peaks=peaks,
            status="completed" if result_data else "ready",
            result=result_data,
        )
        session._result_mtime = result_file.stat().st_mtime if result_file.is_file() else 0
        self.sessions[session_id] = session

        stems = self.get_session_stems(session_id)
        session.stems = stems
        if stems:
            session.stems_status = "ready"

        return session

    def register_listener(self, session_id: str, loop: Optional[asyncio.AbstractEventLoop] = None) -> asyncio.Queue:
        queue = asyncio.Queue()
        if loop is None:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None
        if session_id not in self.listeners:
            self.listeners[session_id] = []
        if loop:
            self.listeners[session_id].append((loop, queue))
        return queue

    def unregister_listener(self, session_id: str, queue: asyncio.Queue):
        if session_id in self.listeners:
            self.listeners[session_id] = [
                (lp, q) for (lp, q) in self.listeners[session_id] if q is not queue
            ]
            if not self.listeners[session_id]:
                del self.listeners[session_id]

    def broadcast_progress(self, session_id: str, data: Dict[str, Any]):
        session = self.sessions.get(session_id)
        if session:
            session.progress = data
            if data.get("type") == "completed":
                session.status = "completed"
            elif data.get("type") == "error":
                session.status = "error"
        if session_id in self.listeners:
            for (lp, queue) in self.listeners[session_id]:
                try:
                    if lp and lp.is_running():
                        lp.call_soon_threadsafe(queue.put_nowait, data)
                except Exception:
                    pass

    def get_session_stems(self, session_id: str) -> Dict[str, Any]:
        """Retrieve existing stems metadata for a session from disk or memory."""
        session = self.sessions.get(session_id)
        session_dir = SESSIONS_DIR / session_id
        stems_dir = session_dir / "stems"

        meta = {}
        if stems_dir.is_dir():
            meta_file = stems_dir / "stems_meta.json"
            if meta_file.is_file():
                try:
                    with open(meta_file, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                except Exception:
                    pass

            needs_meta_save = False

            # Scan folder for all .wav files
            for p in sorted(list(stems_dir.glob("*.wav"))):
                name = p.stem
                if name.endswith("_norm"):
                    continue
                if name not in meta:
                    display_name = "Instrumental (Backing)" if name == "instrumental" else name.capitalize()
                    meta[name] = {
                        "name": display_name,
                        "filename": p.name,
                        "path": str(p),
                        "duration": session.duration if session else 0.0,
                        "peaks": compute_waveform_peaks(p, num_peaks=400),
                    }
                    needs_meta_save = True

            # Sync transcription flag
            for s_name, item in meta.items():
                is_trans = (
                    (session_dir / "stems_transcription" / s_name / "transcription.mid").is_file()
                    or (session_dir / f"transcription_{s_name}.mid").is_file()
                )
                item["transcribed"] = is_trans
                if not item.get("peaks"):
                    wav_path = stems_dir / item.get("filename", f"{s_name}.wav")
                    if wav_path.is_file():
                        item["peaks"] = compute_waveform_peaks(wav_path, num_peaks=400)
                        needs_meta_save = True

            if needs_meta_save and stems_dir.is_dir():
                try:
                    with open(meta_file, "w", encoding="utf-8") as fw:
                        json.dump(meta, fw, indent=2)
                except Exception:
                    pass

        if not meta and session and session.stems:
            meta = session.stems

        if session:
            session.stems = meta
            if session.stems_status != "processing":
                if meta:
                    session.stems_status = "ready"
                elif session.stems_status == "ready":
                    session.stems_status = "none"

        return meta

    def delete_session(self, session_id: str) -> bool:
        session_dir = SESSIONS_DIR / session_id
        if session_dir.is_dir():
            shutil.rmtree(session_dir, ignore_errors=True)
        if session_id in self.sessions:
            del self.sessions[session_id]
        return True

    def delete_session_stems(self, session_id: str) -> bool:
        session_dir = SESSIONS_DIR / session_id
        stems_dir = session_dir / "stems"
        if stems_dir.is_dir():
            shutil.rmtree(stems_dir, ignore_errors=True)
        stems_dir.mkdir(parents=True, exist_ok=True)
        session = self.sessions.get(session_id)
        if session:
            session.stems = {}
            session.stems_status = "none"
        self.broadcast_progress(session_id, {
            "type": "stems_status",
            "status": "none",
            "stage": "idle",
            "stems": {},
        })
        return True

    def delete_single_stem(self, session_id: str, stem_name: str) -> bool:
        session_dir = SESSIONS_DIR / session_id
        stems_dir = session_dir / "stems"
        clean_name = Path(stem_name).name.replace(".wav", "")
        wav_file = stems_dir / f"{clean_name}.wav"
        if wav_file.is_file():
            try:
                wav_file.unlink()
            except Exception:
                pass

        # Also remove any normalized stem or transcription cache
        norm_file = stems_dir / f"{clean_name}_norm.wav"
        if norm_file.is_file():
            try:
                norm_file.unlink()
            except Exception:
                pass

        stem_trans_dir = session_dir / "stems_transcription" / clean_name
        if stem_trans_dir.is_dir():
            shutil.rmtree(stem_trans_dir, ignore_errors=True)

        meta_file = stems_dir / "stems_meta.json"
        meta = {}
        if meta_file.is_file():
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                if clean_name in meta:
                    del meta[clean_name]
                with open(meta_file, "w", encoding="utf-8") as f:
                    json.dump(meta, f, indent=2)
            except Exception:
                pass

        session = self.sessions.get(session_id)
        if session:
            if clean_name in session.stems:
                del session.stems[clean_name]
            if not session.stems:
                session.stems_status = "none"
            self.broadcast_progress(session_id, {
                "type": "stems_status",
                "status": session.stems_status,
                "stems": session.stems,
            })
        return True

    def run_separation_job(
        self,
        session_id: str,
        model_name: str,
        device: Optional[str],
        loop: asyncio.AbstractEventLoop,
        selected_stems: Optional[List[str]] = None,
        quality: str = "high_quality",
    ):
        """Execute selective multi-stem separation using BS-RoFormer Mega-53-stems exclusively."""
        self.loop = loop
        session = self.sessions.get(session_id)
        if not session:
            return

        session.stems_status = "processing"
        session_dir = SESSIONS_DIR / session_id
        stems_dir = session_dir / "stems"

        def progress_callback(info):
            if isinstance(info, dict) and "stems_meta" in info:
                session.stems = info["stems_meta"]
            self.broadcast_progress(session_id, {"type": "stems_progress", "data": info})

        try:
            # Free any resident MuScriptor VRAM to provide maximum 8GB headroom for BS-RoFormer
            MuscriptorTranscriber.unload()

            self.broadcast_progress(session_id, {"type": "stems_status", "stage": "starting_separation"})
            stems_meta = separate_mega_stems(
                audio_path=str(session.wav_path),
                out_dir=str(stems_dir),
                selected_stems=selected_stems,
                device=device,
                quality=quality,
                progress_cb=progress_callback,
            )
            session.stems = stems_meta
            session.stems_status = "ready"
            with open(stems_dir / "stems_meta.json", "w", encoding="utf-8") as f:
                json.dump(stems_meta, f, indent=2)
            self.broadcast_progress(session_id, {"type": "stems_completed", "data": stems_meta})
        except Exception as exc:
            import traceback
            traceback.print_exc()
            session.stems_status = "error"
            session.stems_error = str(exc)
            self.broadcast_progress(session_id, {"type": "stems_error", "error": str(exc)})

    def run_transcription_job(
        self,
        session_id: str,
        options: Dict[str, Any],
        loop: asyncio.AbstractEventLoop,
    ):
        """Execute transcription exclusively using MuScriptor Medium to MIDI only."""
        self.loop = loop
        session = self.sessions.get(session_id)
        if not session:
            return

        session.status = "processing"
        session.options = options
        session_dir = SESSIONS_DIR / session_id

        try:
            raw_device = options.get("device")
            device = "cuda" if (not raw_device or raw_device == "auto") and torch.cuda.is_available() else (raw_device or "cpu")
            target_stem = options.get("target_stem", "original")

            audio_path_to_transcribe = str(session.audio_path)
            stem_out_dir = session_dir

            # If targeting a specific separated stem
            if target_stem and target_stem != "original":
                stem_file = session_dir / "stems" / f"{target_stem}.wav"
                if not stem_file.is_file():
                    # Auto-isolate the requested stem using Mega-53 separator
                    self.broadcast_progress(session_id, {
                        "type": "status",
                        "stage": "separating_stems",
                        "message": f"Isolating stem '{target_stem}' with BS-RoFormer Mega...",
                    })
                    stems_meta = separate_mega_stems(
                        audio_path=str(session.wav_path),
                        out_dir=str(session_dir / "stems"),
                        selected_stems=[target_stem],
                        device=device,
                    )
                    session.stems = stems_meta
                    session.stems_status = "ready"

                if stem_file.is_file():
                    # Peak normalize if stem is quiet to maximize transcription dynamic range
                    stem_norm_path = session_dir / "stems" / f"{target_stem}_norm.wav"
                    audio_path_to_transcribe = str(normalize_stem_audio(stem_file, stem_norm_path))
                    stem_out_dir = session_dir / "stems_transcription" / target_stem
                    stem_out_dir.mkdir(parents=True, exist_ok=True)

            muscriptor_instruments = options.get("muscriptor_instruments")
            if isinstance(muscriptor_instruments, str) and muscriptor_instruments.strip():
                inst_list = [i.strip() for i in muscriptor_instruments.split(",") if i.strip()]
            elif isinstance(muscriptor_instruments, (list, tuple)):
                inst_list = list(muscriptor_instruments)
            else:
                inst_list = []

            manual_tempo = options.get("manual_tempo")
            if manual_tempo is not None and manual_tempo != "":
                try:
                    manual_tempo = float(manual_tempo)
                except (ValueError, TypeError):
                    manual_tempo = None

            single_track = bool(options.get("single_track", False))

            muscriptor_model = options.get("muscriptor_model", "large")
            model_display_name = "MuScriptor Large (1.3B)" if str(muscriptor_model).lower() in ("large", "muscriptor_large", "muscriptor-large") else "MuScriptor Medium (350M)"

            self.broadcast_progress(session_id, {
                "type": "status",
                "stage": "loading_model",
                "message": f"Initializing {model_display_name} PyTorch...",
            })

            transcriber = MuscriptorTranscriber.get_instance(model_size=muscriptor_model, device=device)

            def muscriptor_prog(info):
                self.broadcast_progress(session_id, info)

            cfg_coef = float(options.get("cfg_coef", 2.0))
            beam_size = int(options.get("beam_size", 1))
            max_gen_len = int(options.get("max_gen_len", 1024))

            # If manual tempo not specified, use session's detected tempo if available
            if not manual_tempo and session.result and session.result.get("detected_bpm"):
                try:
                    manual_tempo = float(session.result.get("detected_bpm"))
                except (ValueError, TypeError):
                    pass

            result = transcriber.transcribe(
                audio_path=audio_path_to_transcribe,
                output_dir=stem_out_dir,
                instruments=inst_list if inst_list else None,
                progress_callback=muscriptor_prog,
                target_stem=target_stem,
                cfg_coef=cfg_coef,
                beam_size=beam_size,
                manual_bpm=manual_tempo,
                consolidate_single_track=single_track,
                beat_grid_audio_path=session.wav_path,
                max_gen_len=max_gen_len,
            )

            # Copy or link transcription.mid to session root for easy player access
            if target_stem and target_stem != "original":
                stem_mid = stem_out_dir / "transcription.mid"
                if stem_mid.is_file():
                    shutil.copy2(stem_mid, session_dir / f"transcription_{target_stem}.mid")
                    shutil.copy2(stem_mid, session_dir / "transcription.mid")
                if (stem_out_dir / "result.json").is_file():
                    shutil.copy2(stem_out_dir / "result.json", session_dir / f"result_{target_stem}.json")
                    shutil.copy2(stem_out_dir / "result.json", session_dir / "result.json")

                # Update in-memory stem transcribed state immediately
                if target_stem in session.stems:
                    session.stems[target_stem]["transcribed"] = True

            session.status = "completed"
            session.duration = result.get("duration_seconds", session.duration)
            session.result = result
            self.broadcast_progress(session_id, {"type": "completed", "data": result})

        except Exception as exc:
            import traceback
            traceback.print_exc()
            session.status = "error"
            session.error_message = str(exc)
            self.broadcast_progress(session_id, {"type": "error", "error": str(exc)})
        finally:
            # Auto-unload MuScriptor to keep VRAM at 0MB idle (loading safetensors takes only 0.20s if re-run)
            MuscriptorTranscriber.unload()


session_manager = SessionManager()
