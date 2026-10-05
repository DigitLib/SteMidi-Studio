"""Audio-informed post-processing for MuScriptor note transcriptions.

The MuScriptor decoder yields notes with binary velocity and a handful of
recurring artifacts:

- notes fragmented at the fixed 5 s chunk seams (a sustained note that the tie
  prologue failed to carry over is closed at the seam and re-opened right after),
- very short "ghost" notes with no matching energy in the audio,
- over-long sustains (offsets that run past the point where the note has died out),
- rare dense chromatic walls during transients / cymbal crashes.

Every cleanup decision here is backed by a pitch-resolved spectrogram (VQT,
one row per MIDI pitch) of the transcribed audio, so we only alter notes when
the audio actually disagrees with the model.
"""

from __future__ import annotations

import dataclasses
from typing import Any, Dict, List, Optional, Sequence, Tuple

import librosa
import numpy as np

MIDI_LOW = 21  # A0
MIDI_HIGH = 108  # C8
N_PITCHES = MIDI_HIGH - MIDI_LOW + 1

# MuScriptor transcribes in fixed 5 s segments; seams are where fragments appear.
CHUNK_SECONDS = 5.0

# Hard cap for runaway sustains (unclosed ties from a malformed chunk).
MAX_NOTE_SECONDS = 14.0


@dataclasses.dataclass
class TNote:
    """A transcribed note in absolute audio time (seconds)."""

    pitch: int
    start: float
    end: float
    instrument: str
    is_drum: bool = False
    velocity: int = 100

    @property
    def duration(self) -> float:
        return self.end - self.start


# ---------------------------------------------------------------------------
# Audio analysis
# ---------------------------------------------------------------------------


class AudioAnalysis:
    """Pitch-resolved energy (dB per MIDI pitch per frame) plus broadband RMS.

    Uses a variable-Q transform (ERB-based gamma) at 2 bins per semitone so low
    notes keep usable time resolution, then max-pools the semitone centre with
    its quarter-tone neighbours to tolerate detuned recordings.
    Levels are relative to the 99.9th percentile of the whole file, so the
    thresholds below are independent of the stem's loudness.
    """

    sr = 22050
    hop = 256  # ~11.6 ms frames

    def __init__(self, y: np.ndarray, sr: int):
        y = np.asarray(y, dtype=np.float32)
        if y.ndim > 1:
            # Accept both soundfile [T, C] and librosa [C, T] layouts.
            y = y.mean(axis=1) if y.shape[0] > y.shape[1] else y.mean(axis=0)
        if sr != self.sr:
            y = librosa.resample(y, orig_sr=sr, target_sr=self.sr)
        peak = float(np.max(np.abs(y))) if y.size else 0.0
        if peak > 0:
            y = y / peak

        self.duration = len(y) / float(self.sr)
        self.frame_rate = self.sr / float(self.hop)

        vqt = np.abs(
            librosa.vqt(
                y,
                sr=self.sr,
                hop_length=self.hop,
                fmin=librosa.midi_to_hz(MIDI_LOW),
                n_bins=N_PITCHES * 2,
                bins_per_octave=24,
                gamma=None,
            )
        )
        padded = np.pad(vqt, ((1, 1), (0, 0)))
        semitone = np.maximum(
            np.maximum(padded[0:-2:2], padded[1:-1:2]), padded[2::2]
        )
        ref = float(np.percentile(semitone, 99.9)) if semitone.size else 1.0
        self.pitch_db = np.clip(
            librosa.amplitude_to_db(semitone, ref=max(ref, 1e-10), amin=1e-10, top_db=None),
            -100.0,
            6.0,
        ).astype(np.float32)
        self.n_frames = int(self.pitch_db.shape[1])
        self.frame_max_db = (
            self.pitch_db.max(axis=0) if self.n_frames else np.zeros(0, np.float32)
        )

        rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=self.hop)[0]
        rref = float(np.percentile(rms, 99.5)) if rms.size else 1.0
        self.rms_db = np.clip(
            librosa.amplitude_to_db(rms, ref=max(rref, 1e-10), amin=1e-10, top_db=None),
            -100.0,
            6.0,
        ).astype(np.float32)

    # -- helpers -------------------------------------------------------------
    def _span(self, t0: float, t1: float, n: int) -> Tuple[int, int]:
        f0 = int(np.floor(t0 * self.frame_rate))
        f1 = int(np.ceil(t1 * self.frame_rate))
        f0 = max(0, min(f0, n - 1))
        f1 = max(f0 + 1, min(f1, n))
        return f0, f1

    @staticmethod
    def has_pitch(pitch: int) -> bool:
        return MIDI_LOW <= pitch <= MIDI_HIGH

    def frame_time(self, frame: int) -> float:
        return frame / self.frame_rate

    def pitch_window(self, pitch: int, t0: float, t1: float) -> Optional[np.ndarray]:
        if not self.has_pitch(pitch) or self.n_frames == 0:
            return None
        f0, f1 = self._span(t0, t1, self.n_frames)
        return self.pitch_db[pitch - MIDI_LOW, f0:f1]

    def onset_peak_db(self, pitch: int, t: float) -> Optional[float]:
        """Peak energy at `pitch` around an onset (tolerates the model's ~25 ms lag)."""
        w = self.pitch_window(pitch, t - 0.03, t + 0.09)
        return float(w.max()) if w is not None and w.size else None

    def note_level_db(self, note: Any) -> Optional[float]:
        """Strongest evidence for a note: fundamental or 2nd harmonic, onset or body."""
        levels = []
        for p in (note.pitch, note.pitch + 12):
            w = self.pitch_window(p, note.start - 0.03, max(note.end, note.start + 0.12))
            if w is not None and w.size:
                levels.append(float(w.max()))
        return max(levels) if levels else None

    def frame_peak_db(self, t: float) -> float:
        if self.n_frames == 0:
            return 0.0
        f0, f1 = self._span(t - 0.03, t + 0.09, self.n_frames)
        return float(self.frame_max_db[f0:f1].max())

    def rms_peak_db(self, t: float) -> float:
        n = len(self.rms_db)
        if n == 0:
            return 0.0
        f0, f1 = self._span(t - 0.02, t + 0.06, n)
        return float(self.rms_db[f0:f1].max())

    def reattack_rise_db(self, pitch: int, t: float) -> Optional[float]:
        """Energy rise at `pitch` across time `t`: large for a genuine re-attack,
        near zero for a note that simply keeps sounding."""
        win = 0.07 if pitch >= 52 else 0.12  # low notes: longer VQT filters
        before = self.pitch_window(pitch, t - win, t + 0.01)
        after = self.pitch_window(pitch, t, t + win + 0.01)
        if before is None or after is None or not before.size or not after.size:
            return None
        return float(after.max() - before.min())


def load_analysis(audio_path: str) -> AudioAnalysis:
    y, sr = librosa.load(str(audio_path), sr=AudioAnalysis.sr, mono=True)
    return AudioAnalysis(y, sr)


# ---------------------------------------------------------------------------
# Note cleanup steps
# ---------------------------------------------------------------------------


def _group(notes: Sequence[TNote]) -> Dict[Tuple[str, int], List[TNote]]:
    groups: Dict[Tuple[str, int], List[TNote]] = {}
    for n in notes:
        groups.setdefault((n.instrument, n.pitch), []).append(n)
    for g in groups.values():
        g.sort(key=lambda x: x.start)
    return groups


def merge_fragmented_notes(
    notes: List[TNote],
    analysis: Optional[AudioAnalysis] = None,
    chunk_seconds: float = CHUNK_SECONDS,
) -> Tuple[List[TNote], int]:
    """Re-join same-pitch notes that were split without an audible re-attack.

    - Overlaps of the same (instrument, pitch) are always merged.
    - At a chunk seam (prev ends and next starts within 35 ms of a 5 s
      boundary) gaps up to 60 ms are merged unless the audio shows a clear
      re-attack (>= 4 dB rise).
    - Elsewhere only micro-gaps (<= 20 ms) are merged, and only when the audio
      shows essentially no re-attack (< 2 dB rise).
    """
    out: List[TNote] = []
    merged = 0
    for (_, pitch), group in _group(notes).items():
        if group[0].is_drum:
            out.extend(group)
            continue
        cur = group[0]
        for n in group[1:]:
            gap = n.start - cur.end
            k = round(n.start / chunk_seconds)
            seam = k * chunk_seconds
            at_seam = (
                k > 0
                and abs(n.start - seam) <= 0.035
                and abs(cur.end - seam) <= 0.035
            )
            join = False
            if gap < 0:
                join = True
            elif gap <= (0.06 if at_seam else 0.02):
                rise = analysis.reattack_rise_db(pitch, n.start) if analysis else None
                if rise is None:
                    join = at_seam
                else:
                    join = rise < (4.0 if at_seam else 2.0)
            if join:
                cur.end = max(cur.end, n.end)
                cur.velocity = max(cur.velocity, n.velocity)
                merged += 1
            else:
                out.append(cur)
                cur = n
        out.append(cur)
    out.sort(key=lambda x: (x.start, x.pitch))
    return out, merged


def remove_ghost_notes(
    notes: List[TNote],
    analysis: AudioAnalysis,
    silence_db: float = -70.0,
    short_s: float = 0.06,
    relative_db: float = 30.0,
) -> Tuple[List[TNote], int]:
    """Drop pitched notes the audio gives no evidence for.

    A note is removed when its fundamental *and* octave harmonic are
    essentially silent (< -70 dB re. the file's loudest content), or when it is
    a very short blip (< 60 ms) more than 30 dB below whatever else is sounding
    at that moment.
    """
    keep: List[TNote] = []
    removed = 0
    for n in notes:
        if n.is_drum or not analysis.has_pitch(n.pitch):
            keep.append(n)
            continue
        level = analysis.note_level_db(n)
        if level is None:
            keep.append(n)
            continue
        if level < silence_db:
            removed += 1
            continue
        if n.duration < short_s and level < analysis.frame_peak_db(n.start) - relative_db:
            removed += 1
            continue
        keep.append(n)
    return keep, removed


def sanitize_polyphonic_clusters(
    notes: List[Any],
    audio_y: Optional[np.ndarray] = None,
    audio_sr: int = 44100,
    instrument_name: str = "organ",
    program: int = 0,
    analysis: Optional[AudioAnalysis] = None,
    max_voices: int = 10,
    onset_tolerance: float = 0.04,
) -> List[Any]:
    """Suppress artificial dense chord bursts and crash/transient bleed hallucinations.

    In complex transitions or cymbal crashes, autoregressive transformers can hallucinate
    walls of simultaneous chromatic notes (minor-second clumps across 4-5 octaves).
    This filter:
    1. Identifies simultaneous onset clusters (gap <= 0.04s).
    2. Limits polyphony of runaway clusters (> max_voices simultaneous onsets).
    3. Ranks candidates by pitch-resolved VQT energy at the onset (accurate down
       to the bass register, unlike a short FFT).
    4. Suppresses adjacent chromatic semitone collisions (phantom smears) and weak
       overtone doubles (octave / 12th / two octaves above a much stronger note).

    Works with any note objects exposing .pitch/.start/.end/.velocity
    (TNote or pretty_midi.Note). Stale sustains across chord changes are handled
    by :func:`refine_offsets` instead of a blanket release rule.
    """
    if not notes or len(notes) <= max_voices:
        return notes
    if analysis is None and audio_y is not None and len(audio_y) > 0:
        analysis = AudioAnalysis(audio_y, audio_sr)

    notes_sorted = sorted(notes, key=lambda n: n.start)
    clusters: List[List[Any]] = []
    curr = [notes_sorted[0]]
    for n in notes_sorted[1:]:
        if n.start - curr[0].start <= onset_tolerance:
            curr.append(n)
        else:
            clusters.append(curr)
            curr = [n]
    clusters.append(curr)

    filtered: List[Any] = []
    for cl in clusters:
        if len(cl) <= max_voices:
            filtered.extend(cl)
            continue

        if analysis is not None:
            scored = []
            for n in cl:
                lvl = analysis.onset_peak_db(n.pitch, n.start)
                scored.append((lvl if lvl is not None else -100.0, n))
        else:
            scored = [((n.velocity / 127.0) * min(2.0, n.end - n.start), n) for n in cl]
        scored.sort(key=lambda x: x[0], reverse=True)

        chosen: List[Tuple[float, Any]] = []
        chosen_pitches = set()
        for sc, n in scored:
            if (n.pitch - 1) in chosen_pitches or (n.pitch + 1) in chosen_pitches:
                continue
            if analysis is not None and any(
                (n.pitch - cp.pitch) in (12, 19, 24) and sc < cs - 9.0 for cs, cp in chosen
            ):
                continue
            chosen.append((sc, n))
            chosen_pitches.add(n.pitch)
            if len(chosen) >= max_voices:
                break

        chosen_notes = [n for _, n in chosen]
        if len(chosen_notes) < min(len(cl), 4):
            for _, n in scored:
                if not any(n is c for c in chosen_notes):
                    chosen_notes.append(n)
                    if len(chosen_notes) >= min(len(cl), 4):
                        break
        filtered.extend(chosen_notes)

    filtered.sort(key=lambda n: n.start)
    return filtered


def refine_offsets(
    notes: List[TNote],
    analysis: AudioAnalysis,
    decay_db: float = 35.0,
    min_duration: float = 0.3,
    hold_s: float = 0.12,
) -> int:
    """Shorten sustains that outlive the sound.

    For each pitched note longer than `min_duration`, the reference level is
    the peak in its first 150 ms; if the energy at that pitch then stays more
    than `decay_db` below it for `hold_s`, the note ends there. Notes are only
    ever shortened, never extended. Returns the number of notes trimmed.
    """
    fr = analysis.frame_rate
    attack_frames = max(1, int(round(0.15 * fr)))
    search_from = max(1, int(round(0.10 * fr)))
    hold = max(2, int(round(hold_s * fr)))
    trimmed = 0
    for n in notes:
        if n.is_drum or n.duration < min_duration or not analysis.has_pitch(n.pitch):
            continue
        f0, f1 = analysis._span(n.start, n.end, analysis.n_frames)
        curve = analysis.pitch_db[n.pitch - MIDI_LOW, f0:f1]
        if curve.size < search_from + hold:
            continue
        ref = float(curve[:attack_frames].max())
        below = curve < (ref - decay_db)
        if not below[search_from:].any():
            continue
        # First index where `hold` consecutive frames are below the floor.
        run = np.convolve(below.astype(np.int32), np.ones(hold, dtype=np.int32), "valid")
        hits = np.nonzero(run[search_from:] >= hold)[0]
        if not hits.size:
            continue
        cut_frame = f0 + search_from + int(hits[0])
        new_end = analysis.frame_time(cut_frame) + 0.03
        if new_end < n.end - 0.05:
            n.end = max(n.start + 0.1, new_end)
            trimmed += 1
    return trimmed


def _normalize_levels(levels: Sequence[float], min_spread_db: float = 12.0) -> np.ndarray:
    lv = np.asarray(levels, dtype=float)
    if lv.size < 3:
        return np.full(lv.shape, 0.75)
    hi = float(np.percentile(lv, 97))
    lo = min(float(np.percentile(lv, 5)), hi - min_spread_db)
    return np.clip((lv - lo) / (hi - lo), 0.0, 1.0)


def assign_velocities(
    notes: List[TNote],
    analysis: AudioAnalysis,
    vel_min: int = 36,
    vel_max: int = 120,
) -> None:
    """Expressive velocities from the audio.

    Pitched notes blend the note's own pitch-resolved onset energy (70%, with
    the register tilt removed so bass notes aren't systematically louder) and
    the broadband RMS at the onset (30%). Drums use onset RMS, normalised per
    drum sound when there are enough hits so hi-hats aren't always quiet.
    """
    by_inst: Dict[str, List[TNote]] = {}
    for n in notes:
        by_inst.setdefault(n.instrument, []).append(n)

    def to_vel(v: np.ndarray) -> np.ndarray:
        return np.round(vel_min + (vel_max - vel_min) * np.power(v, 0.85)).astype(int)

    for inst, group in by_inst.items():
        if not group:
            continue
        if group[0].is_drum:
            by_pitch: Dict[int, List[TNote]] = {}
            for n in group:
                by_pitch.setdefault(n.pitch, []).append(n)
            global_levels = _normalize_levels([analysis.rms_peak_db(n.start) for n in group])
            global_map = {id(n): v for n, v in zip(group, global_levels)}
            for p_notes in by_pitch.values():
                if len(p_notes) >= 8:
                    local = _normalize_levels([analysis.rms_peak_db(n.start) for n in p_notes])
                    vals = 0.5 * local + 0.5 * np.array([global_map[id(n)] for n in p_notes])
                else:
                    vals = np.array([global_map[id(n)] for n in p_notes])
                for n, v in zip(p_notes, to_vel(vals)):
                    n.velocity = int(v)
            continue

        rms_levels = np.array([analysis.rms_peak_db(n.start) for n in group])
        pitch_levels = []
        for n, r in zip(group, rms_levels):
            lvl = analysis.onset_peak_db(n.pitch, n.start)
            pitch_levels.append(lvl if lvl is not None else r)
        pitch_levels = np.asarray(pitch_levels, dtype=float)

        pitches = np.array([n.pitch for n in group], dtype=float)
        if len(group) >= 20 and np.ptp(pitches) >= 12:
            slope, intercept = np.polyfit(pitches, pitch_levels, 1)
            pitch_levels = pitch_levels - (slope * pitches + intercept) + pitch_levels.mean()

        v = 0.7 * _normalize_levels(pitch_levels) + 0.3 * _normalize_levels(rms_levels)
        for n, vel in zip(group, to_vel(v)):
            n.velocity = int(vel)


def postprocess_notes(
    notes: List[TNote],
    analysis: Optional[AudioAnalysis],
) -> Tuple[List[TNote], Dict[str, int]]:
    """Run the full cleanup chain. Without audio only the structural fixes run."""
    stats = {"fragments_merged": 0, "ghosts_removed": 0, "cluster_notes_removed": 0, "offsets_trimmed": 0}

    notes, stats["fragments_merged"] = merge_fragmented_notes(notes, analysis)

    if analysis is not None:
        notes, stats["ghosts_removed"] = remove_ghost_notes(notes, analysis)

    by_inst: Dict[str, List[TNote]] = {}
    for n in notes:
        by_inst.setdefault(n.instrument, []).append(n)
    cleaned: List[TNote] = []
    for inst_notes in by_inst.values():
        if inst_notes[0].is_drum:
            cleaned.extend(inst_notes)
            continue
        before = len(inst_notes)
        inst_notes = sanitize_polyphonic_clusters(inst_notes, analysis=analysis)
        stats["cluster_notes_removed"] += before - len(inst_notes)
        cleaned.extend(inst_notes)
    notes = cleaned

    if analysis is not None:
        stats["offsets_trimmed"] = refine_offsets(notes, analysis)

    for n in notes:
        if not n.is_drum and n.duration > MAX_NOTE_SECONDS:
            n.end = n.start + MAX_NOTE_SECONDS

    if analysis is not None:
        assign_velocities(notes, analysis)

    notes.sort(key=lambda x: (x.start, x.pitch))
    return notes, stats
