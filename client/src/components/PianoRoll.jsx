import React, { useMemo, useState, useRef, useEffect, useCallback } from "react";
import {
  Button,
  ActionIcon,
  Group,
  Badge,
  Text,
  SegmentedControl,
  Slider,
  Checkbox,
  Select,
  Paper,
  Box,
  Tooltip,
  Divider,
  Kbd,
} from "@mantine/core";
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconBolt,
  IconDownload,
  IconVolume,
  IconVolumeOff,
  IconPlus,
  IconMinus,
  IconPiano,
  IconHeadphones,
  IconPointer,
  IconPencil,
  IconEraser,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconDeviceFloppy,
  IconTrash,
  IconCheck,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { downloadTightenedMidi } from "../utils/midiExport";
import { MEGA_53_CATALOG } from "./MegaInstrumentSelector";
import { updateSessionMidi } from "../utils/api";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiToNoteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

function midiToFreq(midi) {
  return (440 * Math.pow(2, (midi - 69) / 12)).toFixed(1);
}

function isBlackKey(midi) {
  const note = midi % 12;
  return [1, 3, 6, 8, 10].includes(note);
}

// Studio Timing & Quantization Enhancement Engine
function applyTimingEnhancements(rawNotes, {
  grid = "off",
  strength = 0.75,
  snapChords = true,
  filterGlitches = true,
  bpm = 120,
}) {
  if (!rawNotes || rawNotes.length === 0) return [];

  // 1. Filter spurious micro-glitches (phantom notes < 35ms)
  let list = filterGlitches ? rawNotes.filter((n) => n.duration >= 0.035) : [...rawNotes];

  // 2. Chord attack alignment (group notes starting within 32ms and align them to the earliest onset)
  if (snapChords && list.length > 1) {
    const chordThreshold = 0.032;
    const grouped = [];
    let i = 0;
    while (i < list.length) {
      let j = i + 1;
      while (j < list.length && (list[j].start - list[i].start) <= chordThreshold) {
        j++;
      }
      if (j > i + 1) {
        const chordStart = list[i].start;
        for (let k = i; k < j; k++) {
          const shift = chordStart - list[k].start;
          grouped.push({
            ...list[k],
            start: chordStart,
            end: Number((list[k].end + shift).toFixed(4)),
          });
        }
      } else {
        grouped.push(list[i]);
      }
      i = j;
    }
    list = grouped;
  }

  // 3. Grid Quantization (1/32, 1/16, 1/8, 1/4, 1/16T, 1/8T)
  if (grid !== "off" && bpm > 20 && bpm < 320) {
    const beatSec = 60 / bpm;
    let stepSec = beatSec / 4; // default 1/16
    if (grid === "1/32") stepSec = beatSec / 8;
    else if (grid === "1/16") stepSec = beatSec / 4;
    else if (grid === "1/8") stepSec = beatSec / 2;
    else if (grid === "1/4") stepSec = beatSec;
    else if (grid === "1/16T") stepSec = beatSec / 6;
    else if (grid === "1/8T") stepSec = beatSec / 3;

    list = list.map((n) => {
      const nearestGrid = Math.round(n.start / stepSec) * stepSec;
      const newStart = Math.max(0, n.start + (nearestGrid - n.start) * strength);
      const nearestDur = Math.max(stepSec * 0.75, Math.round(n.duration / stepSec) * stepSec);
      const newDur = Math.max(0.05, n.duration + (nearestDur - n.duration) * strength);
      return {
        ...n,
        start: Number(newStart.toFixed(4)),
        end: Number((newStart + newDur).toFixed(4)),
        duration: Number(newDur.toFixed(4)),
      };
    });

    list.sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length - 1; i++) {
      const curr = list[i];
      const next = list[i + 1];
      const gap = next.start - curr.end;
      if (gap < 0 && Math.abs(gap) < stepSec * 0.75) {
        curr.end = next.start;
        curr.duration = Number(Math.max(0.05, curr.end - curr.start).toFixed(4));
      } else if (gap > 0 && gap <= stepSec * 0.35) {
        curr.end = next.start;
        curr.duration = Number(Math.max(0.05, curr.end - curr.start).toFixed(4));
      }
    }
  }

  return list;
}

// 35 MuScriptor Instruments + Curated Studio Palette
const INSTRUMENT_CATALOG = {
  // Keyboards
  acoustic_piano: { name: "Acoustic Piano", icon: "🎹", color: "#00e676", category: "Keyboards" },
  electric_piano: { name: "Electric Piano", icon: "🎹", color: "#69f0ae", category: "Keyboards" },
  piano: { name: "Piano & Keys", icon: "🎹", color: "#00e676", category: "Keyboards" },
  organ: { name: "Organ", icon: "⛪", color: "#1de9b6", category: "Keyboards" },

  // Guitars
  acoustic_guitar: { name: "Acoustic Guitar", icon: "🎸", color: "#ffab00", category: "Guitars" },
  clean_electric_guitar: { name: "Clean Guitar", icon: "🎸", color: "#ffd740", category: "Guitars" },
  distorted_electric_guitar: { name: "Distorted Guitar", icon: "🎸", color: "#ff9100", category: "Guitars" },
  guitar: { name: "Guitar", icon: "🎸", color: "#ffab00", category: "Guitars" },

  // Bass
  acoustic_bass: { name: "Acoustic Bass", icon: "🎸", color: "#b388ff", category: "Bass" },
  electric_bass: { name: "Electric Bass", icon: "🎸", color: "#7c4dff", category: "Bass" },
  bass: { name: "Bass", icon: "🎸", color: "#b388ff", category: "Bass" },

  // Vocals
  voice: { name: "Vocal Melody", icon: "🎤", color: "#00e5ff", category: "Vocals" },
  vocals: { name: "Lead Vocals", icon: "🎤", color: "#00e5ff", category: "Vocals" },
  vocal: { name: "Vocal Melody", icon: "🎤", color: "#00e5ff", category: "Vocals" },

  // Strings
  violin: { name: "Violin", icon: "🎻", color: "#e040fb", category: "Strings" },
  viola: { name: "Viola", icon: "🎻", color: "#d500f9", category: "Strings" },
  cello: { name: "Cello", icon: "🎻", color: "#aa00ff", category: "Strings" },
  contrabass: { name: "Contrabass", icon: "🎻", color: "#651fff", category: "Strings" },
  orchestral_harp: { name: "Orchestral Harp", icon: "🪗", color: "#ea80fc", category: "Strings" },
  string_ensemble: { name: "String Ensemble", icon: "🎻", color: "#e040fb", category: "Strings" },
  synth_strings: { name: "Synth Strings", icon: "🎻", color: "#d500f9", category: "Strings" },
  strings: { name: "Strings", icon: "🎻", color: "#e040fb", category: "Strings" },

  // Brass
  trumpet: { name: "Trumpet", icon: "🎺", color: "#ff6e40", category: "Brass" },
  trombone: { name: "Trombone", icon: "🎺", color: "#ff3d00", category: "Brass" },
  tuba: { name: "Tuba", icon: "📯", color: "#dd2c00", category: "Brass" },
  french_horn: { name: "French Horn", icon: "📯", color: "#ff9e80", category: "Brass" },
  brass_section: { name: "Brass Section", icon: "🎺", color: "#ff6e40", category: "Brass" },
  horns: { name: "Horns", icon: "📯", color: "#ff6e40", category: "Brass" },
  other: { name: "Brass & Other", icon: "🎺", color: "#ff4081", category: "Brass" },

  // Woodwinds
  soprano_and_alto_sax: { name: "Alto / Soprano Sax", icon: "🎷", color: "#ff4081", category: "Woodwinds" },
  tenor_sax: { name: "Tenor Sax", icon: "🎷", color: "#f50057", category: "Woodwinds" },
  baritone_sax: { name: "Baritone Sax", icon: "🎷", color: "#c51162", category: "Woodwinds" },
  oboe: { name: "Oboe", icon: "🪵", color: "#f06292", category: "Woodwinds" },
  english_horn: { name: "English Horn", icon: "🪵", color: "#ec407a", category: "Woodwinds" },
  bassoon: { name: "Bassoon", icon: "🪵", color: "#ad1457", category: "Woodwinds" },
  clarinet: { name: "Clarinet", icon: "🪵", color: "#ff80ab", category: "Woodwinds" },
  flutes: { name: "Flute", icon: "🪈", color: "#ff4081", category: "Woodwinds" },

  // Synths
  synth_lead: { name: "Synth Lead", icon: "🎛️", color: "#00bfa5", category: "Synths" },
  synth_pad: { name: "Synth Pad", icon: "🎛️", color: "#26a69a", category: "Synths" },
  synth: { name: "Synthesizer", icon: "🎛️", color: "#00bfa5", category: "Synths" },

  // Drums & Percussion
  drums: { name: "Drums & Percussion", icon: "🥁", color: "#ff5252", category: "Drums" },
  chromatic_percussion: { name: "Chromatic Percussion", icon: "🔔", color: "#ff7043", category: "Drums" },
  timpani: { name: "Timpani", icon: "🥁", color: "#ff5252", category: "Drums" },
  orchestra_hit: { name: "Orchestra Hit", icon: "💥", color: "#ff1744", category: "Drums" },
};

function getInstrumentInfo(id) {
  const cleanId = String(id || "acoustic_piano").toLowerCase().replace(/[\s-]/g, "_");
  if (INSTRUMENT_CATALOG[cleanId]) {
    return { id: cleanId, ...INSTRUMENT_CATALOG[cleanId] };
  }
  let hash = 0;
  for (let i = 0; i < cleanId.length; i++) hash = cleanId.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash % 360);
  return {
    id: cleanId,
    name: cleanId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: "🎵",
    color: `hsl(${hue}, 80%, 60%)`,
    category: "Other",
  };
}

// Studio Web Audio Synthesizer Engine (Sample-Accurate Lookahead & Clean Node Lifecycle)
class StudioSynth {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.compressor = null;
    this.volume = 0.85;
    this.activeVoices = new Set();
    this.MAX_POLYPHONY = 48;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx({ latencyHint: "interactive" });

        // Dynamics compressor to prevent distortion and clipping on dense polyphony
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
        this.compressor.knee.setValueAtTime(10, this.ctx.currentTime);
        this.compressor.ratio.setValueAtTime(6, this.ctx.currentTime);
        this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
        this.compressor.release.setValueAtTime(0.12, this.ctx.currentTime);

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);

        this.masterGain.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  stopAll() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Immediately stop and disconnect all active or scheduled voices
    for (const voice of this.activeVoices) {
      try {
        if (voice.osc1) {
          voice.osc1.onended = null;
          voice.osc1.stop(now);
          voice.osc1.disconnect();
        }
        if (voice.osc2) {
          voice.osc2.stop(now);
          voice.osc2.disconnect();
        }
        if (voice.gain) {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(0, now);
          voice.gain.disconnect();
        }
        if (voice.filter) {
          voice.filter.disconnect();
        }
      } catch (_) {}
    }
    this.activeVoices.clear();

    if (this.masterGain) {
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.volume, now);
    }
  }

  // Schedule a note with sample-accurate hardware AudioContext timestamp
  scheduleNote(pitch, when, duration = 0.45, velocity = 90, instrument = "acoustic_piano") {
    try {
      this.init();
      if (!this.ctx || !this.masterGain) return;

      const now = this.ctx.currentTime;
      const startTime = Math.max(now, when);
      const freq = 440 * Math.pow(2, (pitch - 69) / 12);
      const cleanInst = String(instrument || "").toLowerCase();

      // Voice stealing if maximum polyphony exceeded
      if (this.activeVoices.size >= this.MAX_POLYPHONY) {
        const oldest = this.activeVoices.values().next().value;
        if (oldest) {
          try {
            oldest.gain.gain.cancelScheduledValues(now);
            oldest.gain.gain.setValueAtTime(0, now);
            oldest.osc1.stop(now);
            oldest.osc2.stop(now);
            oldest.osc1.disconnect();
            oldest.osc2.disconnect();
            oldest.filter.disconnect();
            oldest.gain.disconnect();
          } catch (_) {}
          this.activeVoices.delete(oldest);
        }
      }

      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const noteGain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      const isBass = cleanInst.includes("bass");
      const isSax = cleanInst.includes("sax") || cleanInst.includes("brass") || cleanInst.includes("horn");
      const isDrums = cleanInst.includes("drum") || cleanInst.includes("percussion");

      if (isBass) {
        osc1.type = "sawtooth";
        osc2.type = "triangle";
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(700, startTime);
      } else if (isSax) {
        osc1.type = "sawtooth";
        osc2.type = "sine";
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(2400, startTime);
      } else if (isDrums) {
        osc1.type = "triangle";
        osc2.type = "square";
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(pitch < 45 ? 120 : 1800, startTime);
      } else {
        // Natural Studio Piano: Triangle fundamental with sine overtone
        osc1.type = "triangle";
        osc2.type = "sine";
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(3400, startTime);
      }

      osc1.frequency.setValueAtTime(freq, startTime);
      osc2.frequency.setValueAtTime(freq * 2, startTime); // 2nd harmonic

      // Natural ADSR envelope with velocity scaling & fast transient attack
      const baseAmp = Math.min(0.45, Math.max(0.06, (velocity / 127) * 0.32));
      const attack = 0.004;
      const decay = 0.06;
      const releaseTime = Math.max(0.12, Math.min(2.0, duration));
      const stopTime = startTime + releaseTime;

      noteGain.gain.setValueAtTime(0.0001, startTime);
      noteGain.gain.linearRampToValueAtTime(baseAmp, startTime + attack);
      noteGain.gain.exponentialRampToValueAtTime(baseAmp * 0.65, startTime + attack + decay);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(noteGain);
      noteGain.connect(this.masterGain);

      const voice = { osc1, osc2, gain: noteGain, filter, stopTime };
      this.activeVoices.add(voice);

      // Complete cleanup on ended to prevent audio graph node accumulation
      osc1.onended = () => {
        try {
          osc1.disconnect();
          osc2.disconnect();
          filter.disconnect();
          noteGain.disconnect();
          this.activeVoices.delete(voice);
        } catch (_) {}
      };

      osc1.start(startTime);
      osc2.start(startTime);
      osc1.stop(stopTime + 0.02);
      osc2.stop(stopTime + 0.02);
    } catch (e) {
      console.warn("StudioSynth scheduleNote notice:", e);
    }
  }

  // Audition a single note immediately (keyboard click, pencil tool, drag)
  playNote(pitch, duration = 0.45, velocity = 90, instrument = "acoustic_piano") {
    this.scheduleNote(pitch, this.ctx ? this.ctx.currentTime : 0, duration, velocity, instrument);
  }
}

const synthEngine = new StudioSynth();

// Memoized high-performance note block for large scores (1,400+ notes).
// Memoized high-performance note block for large scores (1,400+ notes).
// Statically rendered on GPU layer; decoupled from frame-by-frame currentTime re-renders.
const NoteBlock = React.memo(
  function NoteBlock({
    id,
    pitch,
    start,
    end,
    track,
    color,
    name,
    pitchOffset,
    pitchCount,
    rowHeight,
    duration,
    isSelected,
    toolMode,
    onMouseDown,
    onMouseEnter,
    onMouseLeave,
    onResizeMouseDown,
  }) {
    if (pitchOffset < 0 || pitchOffset >= pitchCount) return null;

    const top = pitchOffset * rowHeight;
    const leftPct = (start / duration) * 100;
    const widthPct = Math.max(0.25, ((end - start) / duration) * 100);

    return (
      <div
        onMouseDown={onMouseDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        style={{
          position: "absolute",
          top: `${top + 1}px`,
          left: `${leftPct}%`,
          width: `${widthPct}%`,
          height: `${rowHeight - 2}px`,
          background: color,
          borderRadius: "3px",
          boxShadow: isSelected ? "0 0 0 2px #fff" : "none",
          border: isSelected ? "1.5px solid #ffffff" : "1px solid rgba(0, 0, 0, 0.35)",
          opacity: isSelected ? 1 : 0.9,
          cursor: toolMode === "eraser" ? "crosshair" : "grab",
          zIndex: isSelected ? 15 : 2,
          overflow: "hidden",
          userSelect: "none",
          contain: "layout style paint",
          contentVisibility: "auto",
        }}
        title={`${midiToNoteName(pitch)} (${name}) - Drag to move/transpose, drag right edge to resize`}
      >
        {rowHeight >= 16 && (
          <span
            style={{
              fontSize: "8.5px",
              fontWeight: 700,
              color: "#000",
              paddingLeft: "3px",
              lineHeight: `${rowHeight - 2}px`,
              display: "block",
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {midiToNoteName(pitch)}
          </span>
        )}

        {/* Resize Handle on Right Edge */}
        <div
          onMouseDown={onResizeMouseDown}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "6px",
            height: "100%",
            cursor: "ew-resize",
            background: isSelected ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.25)",
            borderLeft: "1px solid rgba(0, 0, 0, 0.2)",
            zIndex: 4,
          }}
          title="Drag right edge to change duration"
        />
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.id === next.id &&
      prev.pitch === next.pitch &&
      prev.start === next.start &&
      prev.end === next.end &&
      prev.color === next.color &&
      prev.pitchOffset === next.pitchOffset &&
      prev.rowHeight === next.rowHeight &&
      prev.duration === next.duration &&
      prev.isSelected === next.isSelected &&
      prev.toolMode === next.toolMode
    );
  }
);

export default function PianoRoll({
  session,
  isActive = true,
  availableStemId = null,
  audioSourceMode = "stem",
  onToggleAudioSource = null,
  currentTime = 0,
  onTimeUpdate = null,
  isPlaying = false,
  onPlayPause = null,
  audioVolume = 0.85,
  onVolumeChange = null,
  isAudioMuted = false,
  onMuteChange = null,
  onSessionUpdate = null,
  onSelectStemScore = null,
}) {
  const result = session?.result;
  const duration = Math.max(1, result?.duration_seconds || session?.duration || 1);
  const events = result?.events || [];

  // Active stem information
  const stemTargetId =
    availableStemId ||
    (session?.result?.target_stem && session.result.target_stem !== "original"
      ? session.result.target_stem
      : null);
  const isStemActive = audioSourceMode === "stem" && Boolean(stemTargetId && stemTargetId !== "original");
  const stemCatalogInfo = useMemo(() => {
    return stemTargetId ? MEGA_53_CATALOG.find((m) => m.id === stemTargetId) : null;
  }, [stemTargetId]);
  const stemObj = useMemo(() => {
    return stemTargetId ? session?.stems?.[stemTargetId] : null;
  }, [stemTargetId, session?.stems]);
  const stemDisplayName = stemObj?.name || stemCatalogInfo?.name || (stemTargetId ? stemTargetId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "");
  const stemColor = stemObj?.color || stemCatalogInfo?.color || "#f50057";
  const stemIcon = stemObj?.icon || stemCatalogInfo?.icon || "🎷";

  const transcribedStemsList = useMemo(() => {
    if (!session?.stems) return [];
    return Object.entries(session.stems)
      .filter(([id, data]) => Boolean(data?.transcribed) || id === stemTargetId)
      .map(([id, data]) => ({
        value: id,
        label: `${data?.icon || "🎵"} ${data?.name || id}`,
      }));
  }, [session?.stems, stemTargetId]);

  const [zoomX, setZoomX] = useState(1);
  const [rowHeight, setRowHeight] = useState(16);
  const [hoveredNote, setHoveredNote] = useState(null);
  const [soloTrack, setSoloTrack] = useState(null);
  const [visibleTracks, setVisibleTracks] = useState({});
  const [clickedPitch, setClickedPitch] = useState(null);

  // Sound Options: "both" (Mix: Synth + Audio), "synth" (MIDI Synth only), "audio" (Reference Audio only), "mute"
  const [soundMode, setSoundMode] = useState("both");
  const [midiVolume, setMidiVolume] = useState(0.85);
  const [isMidiMuted, setIsMidiMuted] = useState(false);
  const [stemVolume, setStemVolume] = useState(audioVolume ?? 0.85);

  // Timing & Quantization Settings
  const [quantizeGrid, setQuantizeGrid] = useState("off"); // "off", "1/32", "1/16", "1/8", "1/4", "1/16T", "1/8T"
  const [quantizeStrength, setQuantizeStrength] = useState(0.75); // 0.1 to 1.0 (75% default when active)
  const [snapChords, setSnapChords] = useState(true); // Snap near-simultaneous notes (< 32ms) into clean block chords
  const [filterGlitches, setFilterGlitches] = useState(true); // Filter < 35ms phantom transient blips
  const [showTimingPanel, setShowTimingPanel] = useState(false);
  const [customBpm, setCustomBpm] = useState(null);

  // Interactive MIDI Editing State
  const [editedNotes, setEditedNotes] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState(new Set());
  const [toolMode, setToolMode] = useState("select"); // "select" | "pencil" | "eraser"
  const currentScoreKey = `${session?.session_id || ""}:${stemTargetId || "original"}:${result?.midi_file || ""}:${events?.length || 0}:${result?.transcription_time_seconds || 0}`;
  const prevScoreKeyRef = useRef(null);

  const keysContainerRef = useRef(null);
  const gridContainerRef = useRef(null);
  const playheadRef = useRef(null);
  const scheduledNoteIdsRef = useRef(new Set());
  const lastScheduledPosRef = useRef(0);
  const lastKnownTimeRef = useRef(currentTime);
  const lastSyncAudioTimeRef = useRef(currentTime);
  const lastSyncPerfTimeRef = useRef(performance.now());
  const [midiOffsetMs, setMidiOffsetMs] = useState(-60); // Default -60ms for sample-accurate audio sync

  // Synchronize MIDI volume with synth engine
  useEffect(() => {
    synthEngine.setVolume(isMidiMuted ? 0 : midiVolume);
  }, [midiVolume, isMidiMuted]);

  // Synchronize incoming audioVolume prop with stem volume
  useEffect(() => {
    if (audioVolume !== undefined && audioVolume !== stemVolume) {
      setStemVolume(audioVolume);
    }
  }, [audioVolume, stemVolume]);

  const handleSoundModeChange = (mode) => {
    setSoundMode(mode);
    if (mode === "synth") {
      onMuteChange?.(true);
      setIsMidiMuted(false);
    } else if (mode === "audio") {
      onMuteChange?.(false);
      setIsMidiMuted(true);
    } else if (mode === "both") {
      onMuteChange?.(false);
      setIsMidiMuted(false);
    } else if (mode === "mute") {
      onMuteChange?.(true);
      setIsMidiMuted(true);
    }
  };

  const handleMidiVolumeChange = (vol) => {
    setMidiVolume(vol);
    synthEngine.setVolume(vol);
    if (vol > 0 && isMidiMuted) {
      setIsMidiMuted(false);
    }
  };

  const handleStemVolumeChange = (vol) => {
    setStemVolume(vol);
    onVolumeChange?.(vol);
    if (vol > 0 && isAudioMuted) {
      onMuteChange?.(false);
    }
  };

  const handleToggleMidiMute = () => {
    setIsMidiMuted((prev) => !prev);
  };

  const handleToggleStemMute = () => {
    onMuteChange?.(!isAudioMuted);
  };

  // Synchronize vertical scroll between keyboard column and note grid
  const handleGridScroll = (e) => {
    if (keysContainerRef.current) {
      keysContainerRef.current.scrollTop = e.target.scrollTop;
    }
  };

  // Raw note extraction from session events
  const rawNotes = useMemo(() => {
    const list = [];
    if (!events || events.length === 0) return list;

    let noteIdCounter = 0;

    events.forEach((e) => {
      const startTime = typeof e.time === "number" ? e.time : 0;
      const values = e.values || {};

      if (values.pitch !== undefined && values.pitch !== null) {
        const p = Number(values.pitch);
        const dur = Number(values.duration) || 0.35;
        const inst = values.instrument || "acoustic_piano";
        const vel = Number(values.velocity) || 90;
        list.push({
          id: `note_${noteIdCounter++}`,
          start: startTime,
          end: startTime + dur,
          duration: dur,
          pitch: p,
          velocity: vel,
          track: inst,
          info: getInstrumentInfo(inst),
        });
      }
    });

    list.sort((a, b) => a.start - b.start);
    return list;
  }, [events]);

  // Estimate BPM using multi-subdivision histogram score to detect true musical pulse
  const detectedBpm = useMemo(() => {
    if (result?.detected_bpm && result.detected_bpm > 30) {
      return Math.round(result.detected_bpm);
    }
    if (!rawNotes || rawNotes.length < 6) return 120;
    const starts = rawNotes.map((n) => n.start).sort((a, b) => a - b);
    const diffs = [];
    for (let i = 0; i < starts.length - 1; i++) {
      const d = starts[i + 1] - starts[i];
      if (d >= 0.08 && d <= 1.6) diffs.push(d);
    }
    if (diffs.length === 0) return 120;

    const candidateScores = {};
    for (let targetBpm = 60; targetBpm <= 180; targetBpm += 1) {
      const quarter = 60.0 / targetBpm;
      const eighth = quarter / 2.0;
      const sixteenth = quarter / 4.0;
      const triplet = quarter / 3.0;

      let score = 0;
      for (const d of diffs) {
        const err16 = Math.abs(d - sixteenth) / sixteenth;
        const err8 = Math.abs(d - eighth) / eighth;
        const err4 = Math.abs(d - quarter) / quarter;
        const errTri = Math.abs(d - triplet) / triplet;
        const minErr = Math.min(err16, err8, err4, errTri);
        if (minErr < 0.12) {
          score += (1.0 - minErr);
        }
      }
      candidateScores[targetBpm] = score;
    }

    let bestBpm = 120;
    let maxScore = -1;
    for (const [bpmStr, sc] of Object.entries(candidateScores)) {
      if (sc > maxScore) {
        maxScore = sc;
        bestBpm = Number(bpmStr);
      }
    }
    return bestBpm;
  }, [result?.detected_bpm, rawNotes]);

  const activeBpm = customBpm || detectedBpm;

  // Synchronize edited notes with rawNotes on session load, stem switch, or re-transcription
  useEffect(() => {
    const isNewScore = prevScoreKeyRef.current !== currentScoreKey;
    if (isNewScore || editedNotes === null) {
      prevScoreKeyRef.current = currentScoreKey;
      setEditedNotes(rawNotes);
      setHistory([rawNotes]);
      setHistoryIndex(0);
      setIsDirty(false);
      setSelectedNoteIds(new Set());
      setVisibleTracks({});
      setSoloTrack(null);
    } else if (!isDirty && rawNotes !== editedNotes && rawNotes.length > 0) {
      setEditedNotes(rawNotes);
      setHistory([rawNotes]);
      setHistoryIndex(0);
    }
  }, [currentScoreKey, rawNotes, isDirty, editedNotes]);

  const currentNotes = editedNotes !== null ? editedNotes : rawNotes;
  const notes = currentNotes;

  // Extract all unique tracks and per-track note counts
  const trackStats = useMemo(() => {
    const counts = {};
    notes.forEach((n) => {
      counts[n.track] = (counts[n.track] || 0) + 1;
    });

    const list = Object.keys(counts).map((trackId) => ({
      id: trackId,
      count: counts[trackId],
      info: getInstrumentInfo(trackId),
    }));

    list.sort((a, b) => b.count - a.count);
    return list;
  }, [notes]);

  // Initialize track visibility
  useEffect(() => {
    if (trackStats.length > 0) {
      setVisibleTracks((prev) => {
        const next = { ...prev };
        trackStats.forEach((t) => {
          if (next[t.id] === undefined) {
            next[t.id] = true;
          }
        });
        return next;
      });
    }
  }, [trackStats]);

  // Determine pitch bounds (A0..C8)
  const { minPitch, maxPitch } = useMemo(() => {
    if (notes.length === 0) return { minPitch: 48, maxPitch: 84 };
    let min = 127;
    let max = 0;
    notes.forEach((n) => {
      if (n.pitch < min) min = n.pitch;
      if (n.pitch > max) max = n.pitch;
    });
    return {
      minPitch: Math.max(21, min - 2),
      maxPitch: Math.min(108, max + 2),
    };
  }, [notes]);

  const pitchCount = Math.max(12, maxPitch - minPitch + 1);
  const totalHeight = pitchCount * rowHeight;

  // Filter notes by active track and sort by start time for O(log N) scheduling & search
  const activeNotes = useMemo(() => {
    let list;
    if (soloTrack) {
      list = notes.filter((n) => n.track === soloTrack);
    } else {
      list = notes.filter((n) => visibleTracks[n.track] !== false);
    }
    return [...list].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  }, [notes, visibleTracks, soloTrack]);

  // Fast bounded search for active pitches lighting up on piano keys
  const activePitches = useMemo(() => {
    const set = new Set();
    const activeColorMap = new Map();
    const minStart = Math.max(0, currentTime - 5.0);

    for (let i = 0; i < activeNotes.length; i++) {
      const n = activeNotes[i];
      if (n.start > currentTime) break; // Sorted: no more notes can start before or at currentTime
      if (n.start >= minStart && currentTime <= n.end) {
        set.add(n.pitch);
        activeColorMap.set(n.pitch, n.info.color);
      }
    }

    if (clickedPitch !== null) {
      set.add(clickedPitch);
      activeColorMap.set(clickedPitch, "#00e5ff");
    }
    return { set, activeColorMap };
  }, [activeNotes, currentTime, clickedPitch]);

  // Snapping step in seconds based on quantizeGrid setting
  const getSnapStep = useCallback(() => {
    if (quantizeGrid === "off") return 0.02;
    const beatSec = 60 / (activeBpm || 120);
    switch (quantizeGrid) {
      case "1/32": return beatSec / 8;
      case "1/16": return beatSec / 4;
      case "1/8": return beatSec / 2;
      case "1/4": return beatSec;
      case "1/16T": return beatSec / 6;
      case "1/8T": return beatSec / 3;
      default: return beatSec / 4;
    }
  }, [quantizeGrid, activeBpm]);

  // History & Mutation Commit Engine
  const commitNotes = useCallback((newNotes) => {
    setHistory((prevHistory) => {
      const trimmed = prevHistory.slice(0, historyIndex + 1);
      const next = [...trimmed, newNotes];
      if (next.length > 50) next.shift();
      return next;
    });
    setHistoryIndex((prevIdx) => Math.min(49, prevIdx + 1));
    setEditedNotes(newNotes);
    setIsDirty(true);
  }, [historyIndex]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1;
      setHistoryIndex(nextIdx);
      setEditedNotes(history[nextIdx]);
      setSelectedNoteIds(new Set());
      setIsDirty(true);
    }
  }, [historyIndex, history]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      setHistoryIndex(nextIdx);
      setEditedNotes(history[nextIdx]);
      setSelectedNoteIds(new Set());
      setIsDirty(true);
    }
  }, [historyIndex, history]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedNoteIds.size === 0) return;
    const nextNotes = currentNotes.filter((n) => !selectedNoteIds.has(n.id));
    commitNotes(nextNotes);
    setSelectedNoteIds(new Set());
  }, [currentNotes, selectedNoteIds, commitNotes]);

  const transposeSelected = useCallback((semitones) => {
    if (selectedNoteIds.size === 0) return;
    let canTranspose = true;
    currentNotes.forEach((n) => {
      if (selectedNoteIds.has(n.id)) {
        const newP = n.pitch + semitones;
        if (newP < 21 || newP > 108) canTranspose = false;
      }
    });
    if (!canTranspose) return;

    const nextNotes = currentNotes.map((n) => {
      if (selectedNoteIds.has(n.id)) {
        return { ...n, pitch: n.pitch + semitones };
      }
      return n;
    });

    const firstSelected = nextNotes.find((n) => selectedNoteIds.has(n.id));
    if (firstSelected) {
      synthEngine.playNote(firstSelected.pitch, 0.3, firstSelected.velocity, firstSelected.track);
    }

    commitNotes(nextNotes);
  }, [selectedNoteIds, currentNotes, commitNotes]);

  const handleApplyQuantize = useCallback(() => {
    const quantized = applyTimingEnhancements(currentNotes, {
      grid: quantizeGrid !== "off" ? quantizeGrid : "1/16",
      strength: quantizeStrength,
      snapChords,
      filterGlitches,
      bpm: activeBpm,
    });
    commitNotes(quantized);
    notifications.show({
      title: "Timing Quantized",
      message: `Aligned ${quantized.length} notes to ${quantizeGrid !== "off" ? quantizeGrid : "1/16"} grid (${Math.round(quantizeStrength * 100)}% strength).`,
      color: "cyan",
    });
  }, [currentNotes, quantizeGrid, quantizeStrength, snapChords, filterGlitches, activeBpm, commitNotes]);

  const handleSaveMidi = async () => {
    if (!session?.session_id || isSaving) return;
    try {
      setIsSaving(true);
      const notesToSave = currentNotes;
      const payloadEvents = notesToSave.map((n) => ({
        time: Number(n.start.toFixed(4)),
        values: {
          pitch: Math.round(n.pitch),
          duration: Number(n.duration.toFixed(4)),
          velocity: Math.round(n.velocity || 90),
          instrument: n.track || "acoustic_piano",
        },
      }));

      const res = await updateSessionMidi(session.session_id, {
        events: payloadEvents,
        stem: stemTargetId,
      });

      setIsDirty(false);
      notifications.show({
        title: "MIDI Saved Successfully",
        message: `Saved ${res.events_count} notes and regenerated ${res.midi_file || "transcription.mid"}.`,
        color: "teal",
        icon: <IconCheck size={16} />,
      });

      if (onSessionUpdate) {
        await onSessionUpdate();
      }
    } catch (err) {
      console.error("Save MIDI failed:", err);
      notifications.show({
        title: "Save Failed",
        message: err.message || "Failed to update MIDI file on server.",
        color: "red",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Export tightened MIDI directly to user's computer
  const handleExportTightenedMidi = () => {
    const baseName = (session?.filename || "transcription").replace(/\.[^/.]+$/, "");
    downloadTightenedMidi(notes, {
      bpm: activeBpm,
      filename: `${baseName}_edited_${quantizeGrid !== "off" ? quantizeGrid.replace("/", "_") : "custom"}.mid`,
    });
  };

  // Note creation at canvas coordinates
  const createNoteAtCoords = useCallback((clientX, clientY) => {
    const rect = gridContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = clientX - rect.left + gridContainerRef.current.scrollLeft;
    const clickY = clientY - rect.top + gridContainerRef.current.scrollTop;
    const totalWidth = rect.width * zoomX;

    const rawTime = (clickX / totalWidth) * duration;
    const snapStep = getSnapStep();
    const startTime = quantizeGrid !== "off"
      ? Math.max(0, Math.floor(rawTime / snapStep) * snapStep)
      : Math.max(0, rawTime);

    const noteDuration = quantizeGrid !== "off" ? Math.max(0.1, snapStep) : 0.25;

    const pitchIndex = Math.floor(clickY / rowHeight);
    const calculatedPitch = Math.max(minPitch, Math.min(maxPitch, maxPitch - pitchIndex));

    const targetTrack =
      soloTrack ||
      Object.keys(visibleTracks).find((t) => visibleTracks[t] !== false) ||
      (stemTargetId && stemTargetId !== "original" ? stemTargetId : "acoustic_piano");

    const newNote = {
      id: `note_edit_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      start: Number(startTime.toFixed(4)),
      end: Number((startTime + noteDuration).toFixed(4)),
      duration: Number(noteDuration.toFixed(4)),
      pitch: calculatedPitch,
      velocity: 95,
      track: targetTrack,
      info: getInstrumentInfo(targetTrack),
    };

    synthEngine.playNote(calculatedPitch, noteDuration, 95, targetTrack);

    const nextNotes = [...currentNotes, newNote].sort((a, b) => a.start - b.start);
    commitNotes(nextNotes);
    setSelectedNoteIds(new Set([newNote.id]));
  }, [zoomX, duration, getSnapStep, quantizeGrid, rowHeight, minPitch, maxPitch, soloTrack, visibleTracks, stemTargetId, currentNotes, commitNotes]);

  // Note mouse drag (Move in time & Transpose pitch)
  const handleNoteMouseDown = (e, note) => {
    if (toolMode === "eraser") {
      e.stopPropagation();
      const nextNotes = currentNotes.filter((n) => n.id !== note.id);
      commitNotes(nextNotes);
      setSelectedNoteIds((prev) => {
        const next = new Set(prev);
        next.delete(note.id);
        return next;
      });
      return;
    }

    if (e.button !== 0) return;
    e.stopPropagation();

    let newSelection = new Set(selectedNoteIds);
    if (e.shiftKey) {
      if (newSelection.has(note.id)) {
        newSelection.delete(note.id);
      } else {
        newSelection.add(note.id);
      }
      setSelectedNoteIds(newSelection);
      return;
    } else if (!selectedNoteIds.has(note.id)) {
      newSelection = new Set([note.id]);
      setSelectedNoteIds(newSelection);
    }

    synthEngine.playNote(note.pitch, Math.min(0.35, note.duration), note.velocity, note.track);

    const startX = e.clientX;
    const startY = e.clientY;
    const notesSnapshot = currentNotes.map((n) => ({ ...n }));
    const draggedNotesInitial = notesSnapshot.filter((n) => newSelection.has(n.id));

    let hasMoved = false;
    let lastAuditionedPitch = note.pitch;

    const onMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      if (!hasMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        hasMoved = true;
      }
      if (!hasMoved) return;

      const rect = gridContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const totalWidth = rect.width * zoomX;

      const deltaTimeRaw = (dx / totalWidth) * duration;
      const snapStep = getSnapStep();
      const snappedDeltaTime = quantizeGrid !== "off"
        ? Math.round(deltaTimeRaw / snapStep) * snapStep
        : deltaTimeRaw;

      const deltaSemitones = -Math.round(dy / rowHeight);

      let minP = 127, maxP = 0, minStart = Infinity;
      draggedNotesInitial.forEach((n) => {
        minP = Math.min(minP, n.pitch + deltaSemitones);
        maxP = Math.max(maxP, n.pitch + deltaSemitones);
        minStart = Math.min(minStart, n.start + snappedDeltaTime);
      });

      let clampedDeltaPitch = deltaSemitones;
      if (minP < 21) clampedDeltaPitch += (21 - minP);
      if (maxP > 108) clampedDeltaPitch -= (maxP - 108);

      let clampedDeltaTime = snappedDeltaTime;
      if (minStart < 0) clampedDeltaTime -= minStart;

      const currentAuditionPitch = note.pitch + clampedDeltaPitch;
      if (currentAuditionPitch !== lastAuditionedPitch) {
        synthEngine.playNote(currentAuditionPitch, 0.2, note.velocity, note.track);
        lastAuditionedPitch = currentAuditionPitch;
      }

      setEditedNotes(
        notesSnapshot.map((n) => {
          if (newSelection.has(n.id)) {
            const initNote = draggedNotesInitial.find((init) => init.id === n.id);
            if (!initNote) return n;
            const newStart = Math.max(0, Number((initNote.start + clampedDeltaTime).toFixed(4)));
            const newEnd = Number((newStart + initNote.duration).toFixed(4));
            const newPitch = Math.max(21, Math.min(108, initNote.pitch + clampedDeltaPitch));
            return {
              ...n,
              start: newStart,
              end: newEnd,
              pitch: newPitch,
            };
          }
          return n;
        })
      );
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);

      if (hasMoved) {
        setEditedNotes((latest) => {
          commitNotes(latest);
          return latest;
        });
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Note right edge duration resize handle
  const handleResizeMouseDown = (e, note) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    setSelectedNoteIds(new Set([note.id]));
    const startX = e.clientX;
    const initialDuration = note.duration;
    const initialStart = note.start;
    const notesSnapshot = currentNotes.map((n) => ({ ...n }));
    let hasResized = false;

    const onMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      if (!hasResized && Math.abs(dx) > 2) hasResized = true;
      if (!hasResized) return;

      const rect = gridContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const totalWidth = rect.width * zoomX;

      const deltaSec = (dx / totalWidth) * duration;
      const snapStep = getSnapStep();
      const targetDuration = initialDuration + deltaSec;
      const minDur = Math.max(0.04, quantizeGrid !== "off" ? snapStep : 0.05);
      const snappedDuration = quantizeGrid !== "off"
        ? Math.max(minDur, Math.round(targetDuration / snapStep) * snapStep)
        : Math.max(minDur, targetDuration);

      setEditedNotes(
        notesSnapshot.map((n) => {
          if (n.id === note.id) {
            const newDur = Number(snappedDuration.toFixed(4));
            return {
              ...n,
              duration: newDur,
              end: Number((initialStart + newDur).toFixed(4)),
            };
          }
          return n;
        })
      );
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (hasResized) {
        setEditedNotes((latest) => {
          commitNotes(latest);
          return latest;
        });
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Immediately silence any sounding notes when tab switches away or playback stops
  useEffect(() => {
    if (!isActive || !isPlaying) {
      synthEngine.stopAll();
      scheduledNoteIdsRef.current.clear();
      lastScheduledPosRef.current = currentTime;
      lastKnownTimeRef.current = currentTime;
    }
  }, [isActive, isPlaying]);

  // Keep sync references updated when parent currentTime prop updates
  useEffect(() => {
    lastSyncAudioTimeRef.current = currentTime;
    lastSyncPerfTimeRef.current = performance.now();
    if (!isPlaying && playheadRef.current && duration > 0) {
      const pct = Math.min(100, Math.max(0, (currentTime / duration) * 100));
      playheadRef.current.style.left = `${pct}%`;
    }
  }, [currentTime, isPlaying, duration]);

  // Butter-smooth 60/120/144 FPS playhead animation loop without React re-rendering
  useEffect(() => {
    let animId = null;

    const animatePlayhead = () => {
      if (isPlaying && playheadRef.current && duration > 0) {
        const elapsed = (performance.now() - lastSyncPerfTimeRef.current) / 1000;
        const smoothTime = Math.min(duration, Math.max(0, lastSyncAudioTimeRef.current + elapsed));
        const pct = Math.min(100, Math.max(0, (smoothTime / duration) * 100));
        playheadRef.current.style.left = `${pct}%`;
        animId = requestAnimationFrame(animatePlayhead);
      }
    };

    if (isPlaying) {
      lastSyncPerfTimeRef.current = performance.now();
      animId = requestAnimationFrame(animatePlayhead);
    } else if (playheadRef.current && duration > 0) {
      const pct = Math.min(100, Math.max(0, (currentTime / duration) * 100));
      playheadRef.current.style.left = `${pct}%`;
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, duration]);

  // High-Precision Sample-Accurate Web Audio Lookahead Scheduler with Latency Compensation
  useEffect(() => {
    if (!isPlaying || !isActive || isMidiMuted || midiVolume <= 0 || (soundMode !== "synth" && soundMode !== "both")) {
      synthEngine.stopAll();
      scheduledNoteIdsRef.current.clear();
      lastScheduledPosRef.current = currentTime;
      lastKnownTimeRef.current = currentTime;
      return;
    }

    synthEngine.init();
    const ctx = synthEngine.ctx;
    if (!ctx) return;

    const currT = currentTime;
    const prevT = lastKnownTimeRef.current;

    // Detect seeking (user jumped backwards or forwards)
    if (Math.abs(currT - prevT) > 0.25) {
      synthEngine.stopAll();
      scheduledNoteIdsRef.current.clear();
      lastScheduledPosRef.current = currT;
    }
    lastKnownTimeRef.current = currT;

    // Lookahead window: schedule notes up to 200ms ahead directly on hardware AudioContext clock
    const LOOKAHEAD_SEC = 0.20;
    const offsetSec = (midiOffsetMs || 0) / 1000;
    const windowStart = Math.max(0, lastScheduledPosRef.current);
    const windowEnd = currT + LOOKAHEAD_SEC;

    if (windowEnd > windowStart) {
      for (let i = 0; i < activeNotes.length; i++) {
        const n = activeNotes[i];
        if (n.start > windowEnd) break; // Sorted: no more notes in lookahead window
        if (n.start >= windowStart) {
          if (!scheduledNoteIdsRef.current.has(n.id)) {
            scheduledNoteIdsRef.current.add(n.id);
            // Apply latency compensation offset so MIDI audio hits in perfect unison with media output
            const deltaSec = (n.start - currT) + offsetSec;
            const targetAudioTime = ctx.currentTime + Math.max(0, deltaSec);
            synthEngine.scheduleNote(n.pitch, targetAudioTime, n.duration, n.velocity, n.track);
          }
        }
      }
      lastScheduledPosRef.current = windowEnd;
    }

    // Keep memory bounded
    if (scheduledNoteIdsRef.current.size > 2000) {
      scheduledNoteIdsRef.current.clear();
      for (let i = 0; i < activeNotes.length; i++) {
        const n = activeNotes[i];
        if (n.start > windowEnd) break;
        if (n.start >= currT) {
          scheduledNoteIdsRef.current.add(n.id);
        }
      }
    }
  }, [currentTime, isPlaying, isActive, soundMode, activeNotes, isMidiMuted, midiVolume, midiOffsetMs]);

  // Handle clicking on piano key to audition note sound
  const handleKeyClick = (pitch) => {
    synthEngine.playNote(pitch, 0.45, 100, "acoustic_piano");
    setClickedPitch(pitch);
    setTimeout(() => setClickedPitch(null), 300);
  };

  const toggleTrack = (trackId) => {
    setVisibleTracks((prev) => ({
      ...prev,
      [trackId]: prev[trackId] === false,
    }));
  };

  const handleSolo = (trackId) => {
    setSoloTrack((prev) => (prev === trackId ? null : trackId));
  };

  const handleSelectAll = (val) => {
    setSoloTrack(null);
    const updated = {};
    trackStats.forEach((t) => {
      updated[t.id] = val;
    });
    setVisibleTracks(updated);
  };

  const handleGridClick = (e) => {
    if (toolMode === "pencil") {
      createNoteAtCoords(e.clientX, e.clientY);
      return;
    }

    if (selectedNoteIds.size > 0) {
      setSelectedNoteIds(new Set());
    }

    if (!onTimeUpdate) return;
    const rect = gridContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = e.clientX - rect.left + gridContainerRef.current.scrollLeft;
    const totalWidth = rect.width * zoomX;
    const ratio = Math.max(0, Math.min(1, clickX / totalWidth));
    const targetTime = ratio * duration;
    onTimeUpdate(targetTime);

    // Audition any note at clicked position
    const clickedNotes = activeNotes.filter((n) => targetTime >= n.start && targetTime <= n.end);
    if (clickedNotes.length > 0) {
      clickedNotes.slice(0, 3).forEach((n) => {
        synthEngine.playNote(n.pitch, 0.35, n.velocity, n.track);
      });
    }
  };

  const handleGridDoubleClick = (e) => {
    if (toolMode === "select") {
      createNoteAtCoords(e.clientX, e.clientY);
    }
  };

  // Global Keyboard Shortcuts (Undo, Redo, Delete, Tools, Transpose)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;

      // Undo: Ctrl+Z or Cmd+Z
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Redo: Ctrl+Y, Cmd+Y, or Ctrl+Shift+Z, Cmd+Shift+Z
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Tool shortcuts: V = Select, B = Pencil, E = Eraser
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key.toLowerCase() === "v") {
          setToolMode("select");
          return;
        }
        if (e.key.toLowerCase() === "b") {
          setToolMode("pencil");
          return;
        }
        if (e.key.toLowerCase() === "e") {
          setToolMode("eraser");
          return;
        }
      }

      // Delete: Delete or Backspace
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNoteIds.size > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
        return;
      }

      // Transpose: ArrowUp / ArrowDown
      if (e.key === "ArrowUp") {
        if (selectedNoteIds.size > 0) {
          e.preventDefault();
          transposeSelected(e.shiftKey ? 12 : 1);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        if (selectedNoteIds.size > 0) {
          e.preventDefault();
          transposeSelected(e.shiftKey ? -12 : -1);
        }
        return;
      }

      // Select All: Ctrl+A
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedNoteIds(new Set(activeNotes.map((n) => n.id)));
        return;
      }

      // Escape: Deselect
      if (e.key === "Escape") {
        setSelectedNoteIds(new Set());
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo, handleDeleteSelected, transposeSelected, selectedNoteIds, activeNotes]);

  const formatSec = (secs) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", background: "#0b0e15" }}>
      {/* DAW Toolbar: Track Selectors, Solo, Sound Modes, Volume & Zoom */}
      <Box
        px="md"
        py="xs"
        style={{
          background: "var(--bg-card)",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        {/* Track Filters / Badges */}
        <Group gap="xs" align="center" wrap="wrap">
          {transcribedStemsList.length > 0 && onSelectStemScore && (
            <Group gap={6} align="center" mr={4}>
              <Text size="xs" fw={700} c="teal.4">
                Score Stem:
              </Text>
              <Select
                size="xs"
                radius="sm"
                value={stemTargetId || "original"}
                onChange={(val) => {
                  if (val && val !== stemTargetId) {
                    onSelectStemScore(val);
                  }
                }}
                data={[
                  { value: "original", label: "🎵 Full Mix" },
                  ...transcribedStemsList.filter((s) => s.value !== "original"),
                ]}
                styles={{
                  input: {
                    fontWeight: 700,
                    width: 145,
                    fontSize: "12px",
                    background: "rgba(18, 184, 134, 0.08)",
                    borderColor: "rgba(18, 184, 134, 0.3)",
                    color: "var(--mantine-color-teal-3)",
                  },
                }}
                title="Switch between transcribed stem scores"
              />
              <Divider orientation="vertical" />
            </Group>
          )}

          <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.5px" }}>
            Tracks ({activeNotes.length}/{notes.length} Notes):
          </Text>

          {trackStats.map((track) => {
            const isVisible = visibleTracks[track.id] !== false;
            const isSolo = soloTrack === track.id;
            const isEffectiveActive = isSolo || (!soloTrack && isVisible);

            return (
              <Paper
                key={track.id}
                px={8}
                py={3}
                radius="sm"
                withBorder
                onClick={() => !soloTrack && toggleTrack(track.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  background: isEffectiveActive ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.02)",
                  borderColor: isSolo ? track.info.color : isEffectiveActive ? "rgba(255, 255, 255, 0.15)" : "rgba(255, 255, 255, 0.05)",
                  gap: "6px",
                  fontSize: "11px",
                  opacity: isEffectiveActive ? 1 : 0.45,
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <Checkbox
                  size="xs"
                  checked={isVisible && !soloTrack}
                  disabled={Boolean(soloTrack)}
                  onChange={() => toggleTrack(track.id)}
                  onClick={(e) => e.stopPropagation()}
                  color={track.info.color}
                  styles={{ input: { cursor: "pointer" } }}
                />
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: track.info.color,
                    boxShadow: isEffectiveActive ? `0 0 6px ${track.info.color}` : "none",
                  }}
                />
                <Text size="xs" fw={600} c={isEffectiveActive ? "white" : "dimmed"}>
                  {track.info.icon} {track.info.name}
                </Text>
                <Text size="xs" c="dimmed" style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  ({track.count})
                </Text>
                <ActionIcon
                  size={18}
                  radius="xs"
                  variant={isSolo ? "filled" : "subtle"}
                  color={isSolo ? "yellow" : "gray"}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSolo(track.id);
                  }}
                  title={isSolo ? "Unsolo track" : "Solo this track"}
                  style={{
                    marginLeft: 2,
                    fontSize: "9px",
                    fontWeight: 700,
                  }}
                >
                  S
                </ActionIcon>
              </Paper>
            );
          })}

          {trackStats.length > 1 && (
            <Group gap={4}>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() => handleSelectAll(true)}
              >
                All
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() => handleSelectAll(false)}
              >
                None
              </Button>
            </Group>
          )}
        </Group>

        {/* View Controls: Sound Mode, Volume, Zoom & Transport */}
        <Group gap="xs" align="center" wrap="wrap">
          {/* Audio Source Switcher (Stem vs Full Mix) */}
          {stemTargetId && stemTargetId !== "original" && (
            <SegmentedControl
              size="xs"
              radius="md"
              value={isStemActive ? "stem" : "mix"}
              onChange={(val) => onToggleAudioSource?.(val)}
              data={[
                { label: `${stemIcon} ${stemDisplayName} (Stem)`, value: "stem" },
                { label: "🎵 Full Mix", value: "mix" },
              ]}
            />
          )}

          {/* Sound Mode Toggle */}
          <SegmentedControl
            size="xs"
            radius="md"
            value={soundMode}
            onChange={handleSoundModeChange}
            data={[
              { label: "🎶 Mix", value: "both" },
              { label: "🎹 Synth", value: "synth" },
              { label: "🎧 Audio", value: "audio" },
              { label: "🔇 Mute", value: "mute" },
            ]}
          />

          {/* Separated Volume Controls: MIDI Synth vs Stem Audio */}
          <Group
            gap="xs"
            align="center"
            style={{
              background: "rgba(255, 255, 255, 0.04)",
              padding: "3px 8px",
              borderRadius: "8px",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {/* MIDI Synth Volume */}
            <Tooltip label={`MIDI Synth Volume: ${Math.round((isMidiMuted ? 0 : midiVolume) * 100)}%`} withArrow>
              <Group gap={4} align="center">
                <ActionIcon
                  size="xs"
                  variant={isMidiMuted || midiVolume === 0 ? "filled" : "light"}
                  color={isMidiMuted || midiVolume === 0 ? "red" : "teal"}
                  onClick={handleToggleMidiMute}
                  title={isMidiMuted ? "Unmute MIDI Synth" : "Mute MIDI Synth"}
                >
                  <IconPiano size={12} />
                </ActionIcon>
                <Slider
                  size="xs"
                  color="teal"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMidiMuted ? 0 : midiVolume}
                  onChange={handleMidiVolumeChange}
                  style={{ width: 55 }}
                  label={(v) => `MIDI ${Math.round(v * 100)}%`}
                />
                <Text size="10px" c="teal.4" fw={700} style={{ width: 28, fontFamily: "var(--font-mono, monospace)" }}>
                  {isMidiMuted ? "0%" : `${Math.round(midiVolume * 100)}%`}
                </Text>
              </Group>
            </Tooltip>

            <Divider orientation="vertical" style={{ height: 16, alignSelf: "center" }} />

            {/* Stem Audio Volume */}
            <Tooltip label={`${isStemActive ? `${stemDisplayName} Stem` : "Audio"} Volume: ${Math.round((isAudioMuted ? 0 : stemVolume) * 100)}%`} withArrow>
              <Group gap={4} align="center">
                <ActionIcon
                  size="xs"
                  variant={isAudioMuted || stemVolume === 0 ? "filled" : "light"}
                  color={isAudioMuted || stemVolume === 0 ? "red" : "teal"}
                  onClick={handleToggleStemMute}
                  title={isAudioMuted ? "Unmute Stem Audio" : "Mute Stem Audio"}
                >
                  <IconHeadphones size={12} />
                </ActionIcon>
                <Slider
                  size="xs"
                  color="teal"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isAudioMuted ? 0 : stemVolume}
                  onChange={handleStemVolumeChange}
                  style={{ width: 55 }}
                  label={(v) => `Stem ${Math.round(v * 100)}%`}
                />
                <Text size="10px" c="teal.4" fw={700} style={{ width: 28, fontFamily: "var(--font-mono, monospace)" }}>
                  {isAudioMuted ? "0%" : `${Math.round(stemVolume * 100)}%`}
                </Text>
              </Group>
            </Tooltip>
          </Group>

          {/* Audio/MIDI Latency Sync Offset Compensation */}
          <Tooltip
            label="MIDI Latency Compensation: fine-tune audio-to-MIDI alignment in milliseconds"
            withArrow
          >
            <Group
              gap={3}
              align="center"
              style={{
                background: "rgba(255, 255, 255, 0.04)",
                padding: "3px 8px",
                borderRadius: "8px",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <Text size="10px" c="dimmed" fw={600}>
                Sync:
              </Text>
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => setMidiOffsetMs((o) => Math.max(-200, o - 10))}
                title="Shift MIDI earlier (-10ms)"
              >
                <IconMinus size={11} />
              </ActionIcon>
              <Text
                size="10px"
                fw={700}
                c={midiOffsetMs === 0 ? "dimmed" : "teal.4"}
                style={{
                  minWidth: 44,
                  textAlign: "center",
                  fontFamily: "var(--font-mono, monospace)",
                  cursor: "pointer",
                }}
                onClick={() => setMidiOffsetMs(0)}
                title="Click to reset to 0ms"
              >
                {midiOffsetMs > 0 ? `+${midiOffsetMs}ms` : `${midiOffsetMs}ms`}
              </Text>
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => setMidiOffsetMs((o) => Math.min(100, o + 10))}
                title="Shift MIDI later (+10ms)"
              >
                <IconPlus size={11} />
              </ActionIcon>
            </Group>
          </Tooltip>

          {onPlayPause && (
            <Button
              size="xs"
              radius="md"
              variant="filled"
              color="teal"
              leftSection={isPlaying ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
              onClick={() => onPlayPause(!isPlaying)}
            >
              {isPlaying ? "Pause" : "Play"}
            </Button>
          )}

          {/* Horizontal Time Zoom */}
          <SegmentedControl
            size="xs"
            radius="md"
            value={String(zoomX)}
            onChange={(val) => setZoomX(parseFloat(val))}
            data={[
              { label: "1x", value: "1" },
              { label: "1.5x", value: "1.5" },
              { label: "2x", value: "2" },
              { label: "3x", value: "3" },
            ]}
          />

          {/* Row Height */}
          <SegmentedControl
            size="xs"
            radius="md"
            value={String(rowHeight)}
            onChange={(val) => setRowHeight(parseInt(val, 10))}
            data={[
              { label: "Compact", value: "13" },
              { label: "Standard", value: "16" },
              { label: "Large", value: "20" },
            ]}
          />
        </Group>
      </Box>

      {/* MIDI Studio Editor Toolbar Strip */}
      <Box
        px="md"
        py={6}
        style={{
          background: "rgba(13, 17, 26, 0.95)",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        {/* Left: Tools, History & Selection Actions */}
        <Group gap="xs" align="center" wrap="wrap">
          {/* Tool Mode Selector */}
          <SegmentedControl
            size="xs"
            radius="md"
            value={toolMode}
            onChange={setToolMode}
            data={[
              {
                label: (
                  <Group gap={4} wrap="nowrap">
                    <IconPointer size={13} />
                    <span>Select</span>
                    <Kbd size="xs" style={{ fontSize: "9px", padding: "1px 3px" }}>V</Kbd>
                  </Group>
                ),
                value: "select",
              },
              {
                label: (
                  <Group gap={4} wrap="nowrap">
                    <IconPencil size={13} />
                    <span>Draw</span>
                    <Kbd size="xs" style={{ fontSize: "9px", padding: "1px 3px" }}>B</Kbd>
                  </Group>
                ),
                value: "pencil",
              },
              {
                label: (
                  <Group gap={4} wrap="nowrap">
                    <IconEraser size={13} />
                    <span>Erase</span>
                    <Kbd size="xs" style={{ fontSize: "9px", padding: "1px 3px" }}>E</Kbd>
                  </Group>
                ),
                value: "eraser",
              },
            ]}
          />

          <Divider orientation="vertical" style={{ height: 18 }} />

          {/* Undo / Redo */}
          <Tooltip label="Undo (Ctrl+Z)" withArrow>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              disabled={historyIndex <= 0}
              onClick={handleUndo}
            >
              <IconArrowBackUp size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Redo (Ctrl+Y)" withArrow>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              disabled={historyIndex >= history.length - 1}
              onClick={handleRedo}
            >
              <IconArrowForwardUp size={16} />
            </ActionIcon>
          </Tooltip>

          <Divider orientation="vertical" style={{ height: 18 }} />

          {/* Pitch Nudge & Delete for Selected Notes */}
          <Group gap={4} align="center">
            <Tooltip label="Transpose -1 Semitone (Down Arrow)" withArrow>
              <Button
                size="compact-xs"
                variant="light"
                color="gray"
                disabled={selectedNoteIds.size === 0}
                onClick={() => transposeSelected(-1)}
              >
                -1st
              </Button>
            </Tooltip>
            <Tooltip label="Transpose +1 Semitone (Up Arrow)" withArrow>
              <Button
                size="compact-xs"
                variant="light"
                color="gray"
                disabled={selectedNoteIds.size === 0}
                onClick={() => transposeSelected(1)}
              >
                +1st
              </Button>
            </Tooltip>
            <Tooltip label="Transpose -1 Octave (Shift+Down Arrow)" withArrow>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                disabled={selectedNoteIds.size === 0}
                onClick={() => transposeSelected(-12)}
              >
                -12st
              </Button>
            </Tooltip>
            <Tooltip label="Transpose +1 Octave (Shift+Up Arrow)" withArrow>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                disabled={selectedNoteIds.size === 0}
                onClick={() => transposeSelected(12)}
              >
                +12st
              </Button>
            </Tooltip>

            <Tooltip label="Delete Selected (Del / Backspace)" withArrow>
              <ActionIcon
                size="sm"
                variant="light"
                color="red"
                disabled={selectedNoteIds.size === 0}
                onClick={handleDeleteSelected}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>

            {selectedNoteIds.size > 0 && (
              <Badge size="xs" variant="light" color="teal">
                {selectedNoteIds.size} note{selectedNoteIds.size > 1 ? "s" : ""} selected
              </Badge>
            )}
          </Group>
        </Group>

        {/* Right: Quantize / Tighten Toggle, Dirty status, Save MIDI & Export */}
        <Group gap="xs" align="center">
          {/* Tighten Timing strip toggle */}
          <Button
            size="xs"
            radius="md"
            variant={quantizeGrid !== "off" || showTimingPanel ? "filled" : "light"}
            color={quantizeGrid !== "off" || showTimingPanel ? "teal" : "gray"}
            leftSection={<IconBolt size={14} />}
            onClick={() => setShowTimingPanel(!showTimingPanel)}
            title="Adjust timing quantization, snap chords, and tighten rhythm"
          >
            Quantize Grid: {quantizeGrid === "off" ? "Off" : quantizeGrid}
          </Button>

          {/* Dirty Indicator */}
          {isDirty && (
            <Badge size="xs" color="teal" variant="dot">
              Unsaved Edits
            </Badge>
          )}

          {/* Save MIDI Button */}
          <Tooltip label="Save note edits to session and re-serialize MIDI file" withArrow>
            <Button
              size="xs"
              radius="md"
              variant={isDirty ? "filled" : "light"}
              color="teal"
              loading={isSaving}
              leftSection={<IconDeviceFloppy size={14} />}
              onClick={handleSaveMidi}
            >
              Save MIDI{isDirty ? " *" : ""}
            </Button>
          </Tooltip>

          {/* Direct Download Tightened MIDI */}
          <Tooltip label="Download current note layout as standard .mid file to your computer" withArrow>
            <ActionIcon
              size="md"
              radius="md"
              variant="subtle"
              color="teal"
              onClick={handleExportTightenedMidi}
            >
              <IconDownload size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>

      {/* Timing & Quantization Studio Control Strip */}
      {showTimingPanel && (
        <Box
          px="md"
          py="xs"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            background: "linear-gradient(90deg, rgba(17, 24, 39, 0.95), rgba(15, 23, 42, 0.95))",
            borderBottom: "1px solid rgba(18, 184, 134, 0.25)",
            boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
          }}
        >
          {/* Grid Selection */}
          <Group gap="xs" align="center" wrap="wrap">
            <Text size="xs" fw={700} c="teal.4" tt="uppercase" style={{ letterSpacing: "0.5px" }}>
              Quantize Grid:
            </Text>
            <SegmentedControl
              size="xs"
              radius="md"
              value={quantizeGrid}
              onChange={setQuantizeGrid}
              data={[
                { label: "Raw Timing", value: "off" },
                { label: "1/32", value: "1/32" },
                { label: "1/16 (Std)", value: "1/16" },
                { label: "1/8", value: "1/8" },
                { label: "1/4", value: "1/4" },
                { label: "1/16T", value: "1/16T" },
                { label: "1/8T", value: "1/8T" },
              ]}
            />
          </Group>

          {/* Quantize Strength Slider */}
          {quantizeGrid !== "off" && (
            <Group gap="xs" align="center">
              <Text size="xs" fw={600} c="dimmed">Strength:</Text>
              <Slider
                size="xs"
                color="teal"
                min={0.1}
                max={1}
                step={0.05}
                value={quantizeStrength}
                onChange={setQuantizeStrength}
                style={{ width: 85 }}
                label={(v) => `${Math.round(v * 100)}%`}
              />
              <Text size="xs" fw={700} c="teal.4" style={{ fontFamily: "var(--font-mono)", minWidth: 40 }}>
                {Math.round(quantizeStrength * 100)}%
              </Text>
            </Group>
          )}

          {/* Audio De-Jitter Checkboxes */}
          <Group gap="md" align="center" wrap="wrap">
            <Checkbox
              size="xs"
              color="teal"
              label="Snap Chords (32ms)"
              checked={snapChords}
              onChange={(e) => setSnapChords(e.currentTarget.checked)}
              styles={{ label: { cursor: "pointer" } }}
            />
            <Checkbox
              size="xs"
              color="teal"
              label="Filter Ghost Blips"
              checked={filterGlitches}
              onChange={(e) => setFilterGlitches(e.currentTarget.checked)}
              styles={{ label: { cursor: "pointer" } }}
            />
          </Group>

          {/* Tempo Display, Nudge, and Half/Double-Time */}
          <Paper
            px={8}
            py={2}
            radius="md"
            withBorder
            style={{ background: "rgba(0, 0, 0, 0.3)", borderColor: "rgba(255, 255, 255, 0.1)" }}
          >
            <Group gap={4} align="center">
              <Text size="xs" c="dimmed">Tempo:</Text>
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => setCustomBpm(Math.max(40, activeBpm - 1))}
                title="Decrease BPM by 1"
              >
                <IconMinus size={12} />
              </ActionIcon>
              <Paper px={6} py={1} radius="xs" withBorder style={{ background: "rgba(255, 255, 255, 0.06)" }}>
                <Text size="xs" fw={700} style={{ fontFamily: "var(--font-mono)" }}>
                  {activeBpm}
                </Text>
              </Paper>
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => setCustomBpm(Math.min(280, activeBpm + 1))}
                title="Increase BPM by 1"
              >
                <IconPlus size={12} />
              </ActionIcon>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() => setCustomBpm(Math.round(activeBpm / 2))}
                title="Half-time (÷ 2)"
              >
                ÷2
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={() => setCustomBpm(Math.round(activeBpm * 2))}
                title="Double-time (× 2)"
              >
                ×2
              </Button>
            </Group>
          </Paper>

          {/* Quantize Notes Now Button */}
          <Button
            size="xs"
            radius="md"
            variant="light"
            color="teal"
            leftSection={<IconBolt size={14} />}
            onClick={handleApplyQuantize}
            title="Apply current quantization settings to all notes and commit to history"
          >
            ⚡ Quantize Notes Now
          </Button>

          {/* Export Tightened MIDI Button */}
          <Button
            size="xs"
            radius="md"
            variant="light"
            color="teal"
            leftSection={<IconDownload size={14} />}
            onClick={handleExportTightenedMidi}
            title="Download tightened and quantized MIDI file for your DAW"
          >
            Export Tightened MIDI
          </Button>
        </Box>
      )}

      {/* Main Piano Roll Container */}
      {notes.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", color: "var(--text-muted)" }}>
          <span style={{ fontSize: "36px" }}>🎹</span>
          <span style={{ fontSize: "14px", fontWeight: 600 }}>No transcribed note events yet.</span>
          <span style={{ fontSize: "12px" }}>Click "⚡ Transcribe to MIDI" above to transcribe audio into multi-instrument notes, or start drawing notes.</span>
          <Button
            size="xs"
            variant="light"
            color="teal"
            leftSection={<IconPencil size={14} />}
            onClick={() => {
              setEditedNotes([]);
              setHistory([[]]);
              setHistoryIndex(0);
              setToolMode("pencil");
            }}
          >
            ✏️ Draw Blank MIDI Notes
          </Button>
        </div>
      ) : (
        <div className="pianoroll-container" style={{ position: "relative", flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Piano Keys Column (Interactive: Click to Audition Key Sound) */}
          <div
            ref={keysContainerRef}
            className="pianoroll-keys"
            style={{
              width: "64px",
              background: "#0e121a",
              borderRight: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              overflowY: "hidden",
              userSelect: "none",
              zIndex: 10,
            }}
          >
            {Array.from({ length: pitchCount }).map((_, i) => {
              const pitch = maxPitch - i;
              const black = isBlackKey(pitch);
              const isActive = activePitches.set.has(pitch);
              const activeColor = activePitches.activeColorMap.get(pitch) || "#00e5ff";
              const isC = pitch % 12 === 0;

              return (
                <div
                  key={pitch}
                  onClick={() => handleKeyClick(pitch)}
                  className={`pianoroll-key ${black ? "black" : "white"}`}
                  style={{
                    height: `${rowHeight}px`,
                    minHeight: `${rowHeight}px`,
                    background: isActive
                      ? activeColor
                      : black
                      ? "#151a24"
                      : "#242a38",
                    color: isActive ? "#000" : isC ? "#fff" : "var(--text-muted)",
                    fontWeight: isC || isActive ? 700 : 400,
                    fontSize: "9px",
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: "6px",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
                    boxShadow: isActive ? "inset 0 0 4px rgba(0, 0, 0, 0.4)" : "none",
                    cursor: "pointer",
                    transition: "background 0.08s ease",
                  }}
                  title={`Click to play ${midiToNoteName(pitch)} (${midiToFreq(pitch)} Hz)`}
                >
                  {isC || rowHeight >= 18 ? midiToNoteName(pitch) : ""}
                </div>
              );
            })}
          </div>

          {/* Interactive Multi-Track Note Canvas Grid */}
          <div
            ref={gridContainerRef}
            className="pianoroll-grid"
            onScroll={handleGridScroll}
            onClick={handleGridClick}
            onDoubleClick={handleGridDoubleClick}
            style={{
              flex: 1,
              position: "relative",
              overflow: "auto",
              backgroundSize: `${40 * zoomX}px ${rowHeight}px`,
              cursor: toolMode === "pencil" ? "cell" : toolMode === "eraser" ? "crosshair" : "default",
            }}
          >
            {/* Inner scaled canvas wrapper */}
            <div
              style={{
                position: "relative",
                width: `${100 * zoomX}%`,
                height: `${totalHeight}px`,
                minWidth: "100%",
              }}
            >
              {/* Octave horizontal division bands */}
              {Array.from({ length: pitchCount }).map((_, i) => {
                const pitch = maxPitch - i;
                const isC = pitch % 12 === 0;
                const black = isBlackKey(pitch);
                return (
                  <div
                    key={`line_${pitch}`}
                    style={{
                      position: "absolute",
                      top: `${i * rowHeight}px`,
                      left: 0,
                      right: 0,
                      height: `${rowHeight}px`,
                      background: black ? "rgba(0, 0, 0, 0.18)" : "transparent",
                      borderBottom: isC ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(255, 255, 255, 0.02)",
                      pointerEvents: "none",
                    }}
                  />
                );
              })}

              {/* Note blocks (Memoized with zero Gaussian blur for extreme rendering performance) */}
              {activeNotes.map((n) => {
                const pitchOffset = maxPitch - n.pitch;
                const isSelected = selectedNoteIds.has(n.id);

                return (
                  <NoteBlock
                    key={n.id}
                    id={n.id}
                    pitch={n.pitch}
                    start={n.start}
                    end={n.end}
                    track={n.track}
                    color={n.info.color}
                    name={n.info.name}
                    pitchOffset={pitchOffset}
                    pitchCount={pitchCount}
                    rowHeight={rowHeight}
                    duration={duration}
                    isSelected={isSelected}
                    toolMode={toolMode}
                    onMouseDown={(e) => handleNoteMouseDown(e, n)}
                    onMouseEnter={() => setHoveredNote(n)}
                    onMouseLeave={() => setHoveredNote(null)}
                    onResizeMouseDown={(e) => handleResizeMouseDown(e, n)}
                  />
                );
              })}

              {/* Synchronized Playhead Line (Hardware accelerated 60/144 FPS compositor layer) */}
              <div
                ref={playheadRef}
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${Math.min(100, Math.max(0, (currentTime / duration) * 100))}%`,
                  width: "2px",
                  background: "#00e5ff",
                  boxShadow: "0 0 6px #00e5ff",
                  zIndex: 20,
                  pointerEvents: "none",
                  willChange: "left",
                  contain: "layout style paint",
                }}
              >
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    transform: "translateX(-50%)",
                    width: "10px",
                    height: "10px",
                    background: "#00e5ff",
                    clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Floating Note Hover Tooltip */}
          {hoveredNote && (
            <div
              style={{
                position: "absolute",
                bottom: "16px",
                right: "20px",
                background: "rgba(17, 21, 31, 0.95)",
                border: `1px solid ${hoveredNote.info.color}`,
                boxShadow: `0 4px 16px rgba(0,0,0,0.6), 0 0 8px ${hoveredNote.info.color}40`,
                borderRadius: "8px",
                padding: "8px 14px",
                fontSize: "12px",
                color: "#fff",
                zIndex: 100,
                display: "flex",
                alignItems: "center",
                gap: "12px",
                pointerEvents: "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span>{hoveredNote.info.icon}</span>
                <span style={{ fontWeight: 700, color: hoveredNote.info.color }}>
                  {hoveredNote.info.name}
                </span>
              </div>
              <div style={{ width: "1px", height: "16px", background: "rgba(255, 255, 255, 0.2)" }} />
              <div>
                <span style={{ fontWeight: 700 }}>{midiToNoteName(hoveredNote.pitch)}</span>{" "}
                <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                  ({midiToFreq(hoveredNote.pitch)} Hz / MIDI {hoveredNote.pitch})
                </span>
              </div>
              <div style={{ width: "1px", height: "16px", background: "rgba(255, 255, 255, 0.2)" }} />
              <div style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                {formatSec(hoveredNote.start)} → {formatSec(hoveredNote.end)} ({hoveredNote.duration.toFixed(2)}s)
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
