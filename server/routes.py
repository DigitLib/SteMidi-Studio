"""FastAPI REST routes for SteMidi Studio.

Optimized exclusively for:
1. BS-RoFormer Mega-53-stems audio separation.
2. MuScriptor Medium PyTorch Safetensors audio-to-MIDI transcription.
"""

import asyncio
import io
import json
from pathlib import Path
import shutil
from typing import Any, Dict, List, Optional
import zipfile

import torch
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

from .mega_roformer_separator import MEGA_53_CATALOG, get_available_mega_models
from .muscriptor_transcriber import MUSCRIPTOR_INSTRUMENT_CATEGORIES
from .session_manager import SESSIONS_DIR, Session, session_manager
from .utils import get_system_status

router = APIRouter(prefix="/api")


def get_safe_session_dir(session_id: str) -> Path:
    """Validate that session_id resolves strictly inside SESSIONS_DIR."""
    clean_id = Path(session_id).name
    if not clean_id or clean_id != session_id or ".." in session_id:
        raise HTTPException(status_code=400, detail="Invalid session ID.")
    session_dir = (SESSIONS_DIR / clean_id).resolve()
    if not session_dir.is_relative_to(SESSIONS_DIR.resolve()):
        raise HTTPException(status_code=403, detail="Access denied.")
    return session_dir


def get_safe_file_path(base_dir: Path, *parts: str) -> Path:
    """Validate that the constructed file path resolves strictly inside base_dir."""
    target_path = base_dir
    for part in parts:
        clean_part = Path(part).name if ".." in part else part
        target_path = target_path / clean_part
    target_resolved = target_path.resolve()
    if not target_resolved.is_relative_to(base_dir.resolve()):
        raise HTTPException(status_code=403, detail="Access denied.")
    return target_resolved


@router.get("/status")
def status():
    """Return system capabilities, GPU, VRAM, and model status."""
    return get_system_status()


@router.post("/upload")
async def upload_audio(file: UploadFile = File(...)):
    """Upload audio file and create new session."""
    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    session = session_manager.create_session(file.filename, contents)
    return {
        "session_id": session.session_id,
        "filename": session.filename,
        "duration": session.duration,
        "peaks": session.peaks,
        "status": session.status,
    }


class UploadPathRequest(BaseModel):
    file_path: str


@router.post("/upload-path")
async def upload_audio_path(req: UploadPathRequest):
    """Import audio directly from a local filesystem path without network transfer overhead."""
    p = Path(req.file_path).resolve()
    if not p.is_file():
        raise HTTPException(status_code=400, detail=f"Audio file not found: {req.file_path}")

    contents = p.read_bytes()
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Selected audio file is empty.")

    session = session_manager.create_session(p.name, contents)
    return {
        "session_id": session.session_id,
        "filename": session.filename,
        "duration": session.duration,
        "peaks": session.peaks,
        "status": session.status,
    }


@router.post("/separate/{session_id}")
async def separate_stems(
    session_id: str,
    model_name: str = Form("bs_roformer_mega_53stem"),
    device: str = Form("auto"),
    instruments: Optional[str] = Form(None),
    quality: str = Form("high_quality"),
):
    """Trigger selective audio stem separation using BS-RoFormer Mega-53."""
    session = session_manager.sessions.get(session_id)
    if not session:
        session = session_manager.get_or_load_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session audio not found.")

    if session.stems_status == "processing":
        return {"status": "already_processing", "session_id": session_id}

    target_device = None if device == "auto" else device
    instruments_list = [s.strip() for s in instruments.split(",") if s.strip()] if instruments else None

    loop = asyncio.get_running_loop()
    session_manager.executor.submit(
        session_manager.run_separation_job,
        session_id,
        model_name,
        target_device,
        loop,
        instruments_list,
        quality,
    )
    return {
        "status": "processing",
        "session_id": session_id,
        "model_name": "bs_roformer_mega_53stem",
        "quality": quality,
        "instruments": instruments_list,
    }


@router.get("/models/mega_instruments")
def get_mega_instruments():
    """Return all 53 instruments supported by BS-RoFormer Mega model with availability flags."""
    available_set = set(get_available_mega_models())
    instruments = []
    for item in MEGA_53_CATALOG:
        entry = dict(item)
        entry["available"] = entry["id"] in available_set
        instruments.append(entry)
    return {"instruments": instruments, "total": len(instruments)}
@router.post("/models/unload")
def unload_models():
    """Explicitly unload all resident neural models from VRAM and free GPU memory."""
    from .muscriptor_transcriber import MuscriptorTranscriber
    MuscriptorTranscriber.unload()
    import gc
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return {"status": "ok", "message": "All models unloaded from VRAM", "system": get_system_status()}

@router.get("/stems/{session_id}")
def get_stems(session_id: str):
    """Retrieve available separated stems for a session."""
    stems = session_manager.get_session_stems(session_id)
    session = session_manager.sessions.get(session_id)
    status_val = session.stems_status if session else ("ready" if stems else "none")
    return {"session_id": session_id, "stems": stems, "status": status_val}


@router.api_route("/stems/{session_id}/{stem_name}", methods=["GET", "HEAD"])
def get_stem_audio(session_id: str, stem_name: str, download: bool = False):
    """Stream an isolated audio stem WAV file or download as attachment."""
    session_dir = get_safe_session_dir(session_id)
    stems_dir = session_dir / "stems"
    clean_stem = Path(stem_name).name
    clean_name = clean_stem if clean_stem.endswith(".wav") else f"{clean_stem}.wav"
    target_path = get_safe_file_path(stems_dir, clean_name)
    if not target_path.is_file():
        raise HTTPException(status_code=404, detail=f"Stem '{clean_name}' not found.")
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
    }
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{clean_name}"'
    return FileResponse(target_path, media_type="audio/wav", headers=headers)


@router.api_route("/export/{session_id}/stem/{stem_name}", methods=["GET", "HEAD"])
def export_single_stem(session_id: str, stem_name: str):
    """Download an individual stem WAV file with attachment disposition."""
    return get_stem_audio(session_id, stem_name, download=True)


@router.post("/transcribe/{session_id}")
async def start_transcription(
    session_id: str,
    device: str = Form("auto"),
    target_stem: str = Form("original"),
    muscriptor_model: Optional[str] = Form("large"),
    muscriptor_instruments: Optional[str] = Form(None),
    manual_tempo: Optional[float] = Form(None),
    single_track: Optional[bool] = Form(False),
    cfg_coef: Optional[float] = Form(2.0),
    max_gen_len: Optional[int] = Form(1024),
):
    """Start MuScriptor audio-to-MIDI transcription (Large 1.3B or Medium 350M)."""
    session = session_manager.get_or_load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    if session.status == "processing":
        return {"status": "already_processing", "session_id": session_id}

    session.status = "processing"

    target_device = device if (device and device != "auto") else ("cuda" if torch.cuda.is_available() else "cpu")
    model_key = (muscriptor_model or "large").lower().replace("muscriptor_", "").replace("muscriptor-", "")
    if model_key not in ("large", "medium"):
        model_key = "large"

    options = {
        "device": target_device,
        "target_stem": target_stem,
        "muscriptor_model": model_key,
        "muscriptor_instruments": muscriptor_instruments,
        "manual_tempo": manual_tempo,
        "single_track": single_track,
        "cfg_coef": cfg_coef if cfg_coef is not None else 1.0,
        "max_gen_len": max_gen_len if max_gen_len is not None else 1024,
        "model_type": f"muscriptor_{model_key}",
    }

    loop = asyncio.get_running_loop()
    session_manager.executor.submit(
        session_manager.run_transcription_job,
        session_id,
        options,
        loop,
    )

    return {
        "status": "processing",
        "session_id": session_id,
        "target_stem": target_stem,
        "model_type": f"muscriptor_{model_key}",
        "muscriptor_model": model_key,
    }


@router.get("/models/muscriptor_instruments")
def get_muscriptor_instruments():
    """Return supported instruments for MuScriptor Medium transcription."""
    from muscriptor.tokenizer.mt3 import MT3_FULL_PLUS_GROUP_NAMES

    return {
        "instruments": MT3_FULL_PLUS_GROUP_NAMES,
        "categories": MUSCRIPTOR_INSTRUMENT_CATEGORIES,
        "total_count": len(MT3_FULL_PLUS_GROUP_NAMES),
    }


@router.get("/session/{session_id}")
def get_session(session_id: str):
    """Get status, stems, and MIDI transcription result for a session."""
    session = session_manager.get_or_load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    session_dir = get_safe_session_dir(session_id)
    result_data = session.result
    result_file = get_safe_file_path(session_dir, "result.json")
    if result_file.is_file():
        try:
            with open(result_file, "r", encoding="utf-8") as rf:
                result_data = json.load(rf)
                session.result = result_data
        except Exception:
            pass

    effective_dur = result_data.get("duration_seconds") if result_data else session.duration
    stems = session_manager.get_session_stems(session_id)
    return {
        "session_id": session.session_id,
        "filename": session.filename,
        "duration": effective_dur,
        "peaks": session.peaks,
        "status": session.status,
        "stems": stems,
        "stems_status": session.stems_status if session.stems_status != "none" else ("ready" if stems else "none"),
        "stems_error": session.stems_error,
        "error_message": session.error_message,
        "result": result_data,
    }


@router.get("/session/{session_id}/stem_result/{stem_name}")
def get_stem_result(session_id: str, stem_name: str):
    """Retrieve the transcription result specifically for a single stem."""
    session = session_manager.get_or_load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    session_dir = get_safe_session_dir(session_id)
    clean_stem = Path(stem_name).name.replace(".wav", "")
    stem_result_file = get_safe_file_path(session_dir, "stems_transcription", clean_stem, "result.json")
    if not stem_result_file.is_file():
        stem_result_file = get_safe_file_path(session_dir, f"result_{clean_stem}.json")

    if stem_result_file.is_file():
        try:
            with open(stem_result_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read stem result: {e}")

    raise HTTPException(status_code=404, detail=f"No transcription result found for stem '{clean_stem}'.")


GM_INSTRUMENT_MAP = {
    "acoustic_piano": 0,
    "piano": 0,
    "electric_piano": 4,
    "organ": 16,
    "acoustic_guitar": 24,
    "clean_electric_guitar": 27,
    "distorted_electric_guitar": 29,
    "guitar": 24,
    "acoustic_bass": 32,
    "electric_bass": 33,
    "bass": 33,
    "voice": 54,
    "vocals": 54,
    "vocal": 54,
    "violin": 40,
    "viola": 41,
    "cello": 42,
    "contrabass": 43,
    "orchestral_harp": 46,
    "string_ensemble": 48,
    "strings": 48,
    "synth_strings": 50,
    "trumpet": 56,
    "trombone": 57,
    "tuba": 58,
    "french_horn": 60,
    "brass_section": 61,
    "soprano_and_alto_sax": 65,
    "tenor_sax": 66,
    "baritone_sax": 67,
    "oboe": 68,
    "english_horn": 69,
    "bassoon": 70,
    "clarinet": 71,
    "flutes": 73,
    "synth_lead": 80,
    "synth_pad": 88,
    "drums": 0,
}


class UpdateMidiRequest(BaseModel):
    events: List[Dict[str, Any]]
    stem_name: Optional[str] = None
    bpm: Optional[float] = None
    beats_per_bar: Optional[int] = 4


@router.post("/session/{session_id}/update_midi")
def update_session_midi(session_id: str, payload: UpdateMidiRequest):
    """Save user-edited MIDI events and re-serialize the MIDI file."""
    session = session_manager.get_or_load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    session_dir = get_safe_session_dir(session_id)
    stem_name = payload.stem_name
    events = payload.events

    # Determine target files
    if stem_name and stem_name != "original":
        clean_stem = Path(stem_name).name.replace(".wav", "")
        stem_dir = session_dir / "stems_transcription" / clean_stem
        stem_dir.mkdir(parents=True, exist_ok=True)
        res_file = stem_dir / "result.json"
        mid_file = session_dir / f"transcription_{clean_stem}.mid"
    else:
        clean_stem = None
        res_file = session_dir / "result.json"
        mid_file = session_dir / "transcription.mid"

    res_data = {}
    if res_file.is_file():
        try:
            with open(res_file, "r", encoding="utf-8") as f:
                res_data = json.load(f)
        except Exception:
            pass

    bpm = payload.bpm or res_data.get("detected_bpm") or 120.0
    beats_per_bar = payload.beats_per_bar or res_data.get("beats_per_bar") or 4

    # Re-serialize MIDI with pretty_midi
    try:
        import pretty_midi
        pm = pretty_midi.PrettyMIDI(resolution=480, initial_tempo=float(bpm))
        if beats_per_bar:
            pm.time_signature_changes.append(pretty_midi.TimeSignature(int(beats_per_bar), 4, 0.0))

        tracks_dict: Dict[str, pretty_midi.Instrument] = {}
        for ev in events:
            time_val = float(ev.get("time", 0.0))
            vals = ev.get("values", {})
            pitch = int(vals.get("pitch", 60))
            dur = max(0.01, float(vals.get("duration", 0.25)))
            inst_name = str(vals.get("instrument", "acoustic_piano")).lower().replace(" ", "_")
            vel = int(vals.get("velocity", 90))
            is_drum = "drum" in inst_name or "percussion" in inst_name

            if inst_name not in tracks_dict:
                prog = 0 if is_drum else GM_INSTRUMENT_MAP.get(inst_name, 0)
                inst = pretty_midi.Instrument(
                    program=prog,
                    is_drum=is_drum,
                    name=inst_name.replace("_", " "),
                )
                tracks_dict[inst_name] = inst
                pm.instruments.append(inst)

            tracks_dict[inst_name].notes.append(
                pretty_midi.Note(
                    velocity=max(1, min(127, vel)),
                    pitch=max(0, min(127, pitch)),
                    start=time_val,
                    end=time_val + dur,
                )
            )

        pm.write(str(mid_file))
    except Exception as mid_err:
        print(f"[UpdateMidi] Notice re-serializing MIDI: {mid_err}")

    # Update result data
    instruments_detected = list({str(ev.get("values", {}).get("instrument", "acoustic_piano")).replace("_", " ") for ev in events})
    max_end = max((float(ev.get("time", 0.0)) + float(ev.get("values", {}).get("duration", 0.25)) for ev in events), default=0.0)

    res_data.update({
        "events": events,
        "events_count": len(events),
        "instruments_detected": instruments_detected,
        "duration_seconds": max(session.duration or 0.0, max_end),
    })

    with open(res_file, "w", encoding="utf-8") as f:
        json.dump(res_data, f, indent=2)

    if not clean_stem or (session.result and session.result.get("target_stem") == clean_stem):
        session.result = res_data

    return {"status": "ok", "events_count": len(events), "midi_file": mid_file.name}


@router.get("/sessions")
def list_sessions():
    """List all available sessions on disk and in memory."""
    sessions_list = []
    if SESSIONS_DIR.is_dir():
        for s_dir in SESSIONS_DIR.iterdir():
            if not s_dir.is_dir():
                continue
            s_id = s_dir.name
            stems_dir = s_dir / "stems"
            wav_file = s_dir / "audio.wav"
            res_file = s_dir / "result.json"
            meta_file = stems_dir / "stems_meta.json"
            info_file = s_dir / "session_info.json"

            fname = s_id
            duration = 0.0
            created_at = s_dir.stat().st_mtime

            if info_file.is_file():
                try:
                    with open(info_file, "r") as f:
                        info = json.load(f)
                        fname = info.get("filename", fname)
                        duration = info.get("duration", duration)
                        created_at = info.get("created_at", created_at)
                except Exception:
                    pass

            if (not fname or fname == s_id) and res_file.is_file():
                try:
                    with open(res_file, "r") as rf:
                        rdata = json.load(rf)
                        fname = rdata.get("audio", fname)
                        duration = rdata.get("duration_seconds", 0.0)
                except Exception:
                    pass
            elif (not fname or fname == s_id) and (s_dir / "original.wav").is_file():
                fname = "original.wav"

            mem_session = session_manager.sessions.get(s_id)
            if mem_session:
                fname = mem_session.filename or fname
                duration = mem_session.duration or duration
                created_at = mem_session.created_at or created_at

            stem_names = []
            if meta_file.is_file():
                try:
                    with open(meta_file, "r") as mf:
                        stem_names = list(json.load(mf).keys())
                except Exception:
                    pass
            elif stems_dir.is_dir():
                stem_names = [p.stem for p in stems_dir.glob("*.wav") if not p.stem.endswith("_norm")]

            has_midi = (s_dir / "transcription.mid").is_file() or (s_dir / "result.json").is_file()

            sessions_list.append({
                "session_id": s_id,
                "filename": fname,
                "created_at": created_at,
                "duration": duration,
                "has_audio": wav_file.is_file(),
                "stems_count": len(stem_names),
                "stem_names": stem_names,
                "has_midi": has_midi,
            })

    sessions_list.sort(key=lambda x: x["created_at"], reverse=True)
    return {"sessions": sessions_list}


@router.delete("/session/{session_id}")
def delete_session(session_id: str):
    """Delete a session entirely from disk and memory."""
    success = session_manager.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Failed to delete session.")
    return {"status": "deleted", "session_id": session_id}


@router.delete("/stems/{session_id}")
@router.delete("/session/{session_id}/stems")
def delete_session_stems(session_id: str):
    """Delete all separated stems for a session."""
    session_manager.delete_session_stems(session_id)
    return {"status": "stems_deleted", "session_id": session_id}


@router.delete("/stems/{session_id}/{stem_name}")
def delete_single_stem(session_id: str, stem_name: str):
    """Delete an individual separated stem for a session."""
    clean_stem = Path(stem_name).name
    session_manager.delete_single_stem(session_id, clean_stem)
    return {"status": "stem_deleted", "session_id": session_id, "stem_name": clean_stem}


@router.api_route("/audio/{session_id}", methods=["GET", "HEAD"])
def get_session_main_audio(session_id: str):
    """Serve the primary imported audio file for a session."""
    session_dir = get_safe_session_dir(session_id)
    if not session_dir.is_dir():
        raise HTTPException(status_code=404, detail="Session not found.")

    target_path = session_dir / "audio.wav"
    if not target_path.is_file():
        target_path = session_dir / "original.wav"
    if not target_path.is_file():
        candidates = [p for p in session_dir.glob("original.*") if p.is_file()]
        if candidates:
            target_path = candidates[0]

    if not target_path.is_file():
        raise HTTPException(status_code=404, detail="Session audio not found.")

    media_type = "audio/wav"
    if target_path.suffix.lower() == ".mp3":
        media_type = "audio/mpeg"
    elif target_path.suffix.lower() == ".flac":
        media_type = "audio/flac"
    elif target_path.suffix.lower() == ".ogg":
        media_type = "audio/ogg"

    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
    }
    return FileResponse(target_path, media_type=media_type, headers=headers)


@router.api_route("/audio/{session_id}/{filename}", methods=["GET", "HEAD"])
def get_session_file(session_id: str, filename: str):
    """Serve any audio WAV or MIDI file associated with a session."""
    session_dir = get_safe_session_dir(session_id)
    clean_filename = Path(filename).name
    target_path = get_safe_file_path(session_dir, clean_filename)

    if not target_path.is_file():
        # Check in stems directory
        stem_path = get_safe_file_path(session_dir / "stems", clean_filename)
        if stem_path.is_file():
            target_path = stem_path
        else:
            # Check in stems_transcription
            stems_tr = session_dir / "stems_transcription"
            cand = [p for p in stems_tr.glob(f"*/{clean_filename}") if p.is_file()] if stems_tr.is_dir() else []
            if cand:
                target_path = cand[0]
            else:
                raise HTTPException(status_code=404, detail=f"File {clean_filename} not found.")

    media_type = "application/octet-stream"
    if clean_filename.endswith(".wav"):
        media_type = "audio/wav"
    elif clean_filename.endswith(".mid") or clean_filename.endswith(".midi"):
        media_type = "audio/midi"

    headers = {
        "Accept-Ranges": "bytes",
    }
    return FileResponse(target_path, media_type=media_type, headers=headers)


@router.get("/export/{session_id}/{export_type}")
def export_session_artifact(session_id: str, export_type: str):
    """Download MIDI file, stems ZIP, or complete package."""
    session_dir = get_safe_session_dir(session_id)
    if not session_dir.is_dir():
        raise HTTPException(status_code=404, detail="Session not found.")

    if export_type in ("stems_zip", "stems"):
        stems_dir = session_dir / "stems"
        if not stems_dir.is_dir():
            raise HTTPException(status_code=404, detail="No stems folder found for this session.")
        stem_files = sorted(list(stems_dir.glob("*.wav")))
        if not stem_files:
            raise HTTPException(status_code=404, detail="No isolated stem WAV files available for export.")
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_STORED) as zip_file:
            for sf in stem_files:
                zip_file.write(sf, arcname=sf.name)
        zip_buffer.seek(0)
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={session_id}_stems.zip"},
        )

    if export_type == "zip":
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_STORED) as zip_file:
            for item in session_dir.iterdir():
                if item.is_file() and not item.name.startswith("original"):
                    zip_file.write(item, arcname=item.name)
            # Include isolated stems
            stems_dir = session_dir / "stems"
            if stems_dir.is_dir():
                for sf in stems_dir.glob("*.wav"):
                    zip_file.write(sf, arcname=f"stems/{sf.name}")
        zip_buffer.seek(0)
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename=Studio_{session_id}.zip"},
        )

    file_mapping = {
        "midi": "transcription.mid",
        "muscriptor_midi": "transcription.mid",
        "events": "result.json",
    }

    filename = file_mapping.get(export_type)
    if not filename:
        raise HTTPException(status_code=404, detail=f"Export type '{export_type}' not recognized.")

    target_file = get_safe_file_path(session_dir, filename)
    if not target_file.is_file():
        stems_tr = session_dir / "stems_transcription"
        if stems_tr.is_dir():
            for stem_dir in stems_tr.iterdir():
                if stem_dir.is_dir() and (stem_dir / filename).is_file():
                    target_file = stem_dir / filename
                    break

    if not target_file.is_file():
        raise HTTPException(status_code=404, detail=f"Export item '{export_type}' ({filename}) not found in session.")

    return FileResponse(
        target_file,
        filename=filename,
        media_type="audio/midi" if filename.endswith(".mid") else "application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
