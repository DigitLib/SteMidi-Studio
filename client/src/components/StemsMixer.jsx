import React, { useState, useEffect, useRef, useMemo } from "react";
import { notifications } from "@mantine/notifications";
import {
  Button,
  ActionIcon,
  Group,
  Stack,
  Card,
  Badge,
  Text,
  SegmentedControl,
  Slider,
  Checkbox,
  Select,
  NumberInput,
  Paper,
  Box,
  Modal,
  ThemeIcon,
  Tooltip,
  Radio,
} from "@mantine/core";
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconTrash,
  IconDownload,
  IconSparkles,
  IconPiano,
  IconSettings,
  IconMusic,
  IconBolt,
  IconAdjustmentsHorizontal,
  IconVolume,
  IconCheck,
  IconX,
} from "@tabler/icons-react";
import { startStemSeparation, fetchStems, getSession, deleteStems, deleteSingleStem, connectProgressWebSocket } from "../utils/api";
import { WebAudioMixer } from "../utils/webAudioMixer";
import StemWaveform from "./StemWaveform";
import MegaInstrumentSelector, { MEGA_53_CATALOG } from "./MegaInstrumentSelector";

export default function StemsMixer({
  session,
  isProcessing,
  currentTime = 0,
  onTimeUpdate = null,
  isPlaying = false,
  onPlayPause = null,
  onTranscribeStem,
  onViewStemScore,
  onTranscribeOrchestral,
  onSessionUpdate,
}) {
  const sessionId = session?.session_id;
  const [selectedModel, setSelectedModel] = useState("bs_roformer_mega_53stem");
  const [separationQuality, setSeparationQuality] = useState("high_quality"); // "fast", "high_quality", "studio_master"
  const [isSeparating, setIsSeparating] = useState(false);
  const [separationMsg, setSeparationMsg] = useState("");
  const [separationProgress, setSeparationProgress] = useState(0);
  const [stems, setStems] = useState(session?.stems || {});
  const [localCurrentTime, setLocalCurrentTime] = useState(0);
  const [stemsVersion, setStemsVersion] = useState(Date.now());

  // Multi-stem synchronized playback state
  const [isPlayingAll, setIsPlayingAll] = useState(false);

  // Web Audio Mixer instance for zero-socket, sample-accurate multitrack playback
  const mixerRef = useRef(null);
  if (!mixerRef.current) {
    mixerRef.current = new WebAudioMixer();
  }
  const [playingStemId, setPlayingStemId] = useState(null);

  // Instruments definitions for BS-RoFormer SW 6-Stem (Warm Pastel Tones)
  const AVAILABLE_INSTRUMENTS = [
    { id: "vocals", name: "Vocals", icon: "🎤", color: "#e07a5f" },
    { id: "piano", name: "Piano & Keys", icon: "🎹", color: "#76b39d" },
    { id: "guitar", name: "Guitar", icon: "🎸", color: "#e5a958" },
    { id: "bass", name: "Bass", icon: "🎸", color: "#9d8ec2" },
    { id: "drums", name: "Drums", icon: "🥁", color: "#d96b6b" },
    { id: "other", name: "Horns / Other", icon: "🎺", color: "#d9758c" },
    { id: "instrumental", name: "Instrumental", icon: "🎛️", color: "#6b8ed9" },
  ];

  const STEM_COLORS = {
    original: "#12b886",
    vocals: "#e07a5f",
    piano: "#76b39d",
    guitar: "#e5a958",
    bass: "#9d8ec2",
    drums: "#d96b6b",
    other: "#d9758c",
    instrumental: "#6b8ed9",
    transcription: "#81c784",
    vocal: "#e07a5f",
    chords: "#e5a958",
  };
  MEGA_53_CATALOG.forEach((item) => {
    if (item.color) STEM_COLORS[item.id] = item.color;
  });

  const [selectedInstruments, setSelectedInstruments] = useState([
    "vocals", "piano", "guitar", "bass", "drums", "other", "instrumental",
  ]);

  const [selectedMegaInstruments, setSelectedMegaInstruments] = useState([
    "lead-vocal", "piano", "guitar", "bass", "drums", "strings",
  ]);

  const toggleInstrument = (id) => {
    setSelectedInstruments((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev; // Keep at least one stem selected
        return prev.filter((x) => x !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const handleSelectAll = () => {
    if (selectedInstruments.length === AVAILABLE_INSTRUMENTS.length) {
      setSelectedInstruments(["vocals", "instrumental"]);
    } else {
      setSelectedInstruments(AVAILABLE_INSTRUMENTS.map((i) => i.id));
    }
  };

  // Sync stems from incoming session prop
  useEffect(() => {
    if (session?.stems && Object.keys(session.stems).length > 0) {
      setStems(session.stems);
      setStemsVersion(Date.now());
    } else if (sessionId) {
      fetchStems(sessionId)
        .then((res) => {
          if (res && res.stems) {
            setStems(res.stems);
            setStemsVersion(Date.now());
          }
        })
        .catch(() => {});
    }
  }, [sessionId, session?.stems]);

  // Preload stems into WebAudioMixer with low concurrency (2) to avoid network congestion
  useEffect(() => {
    if (sessionId && stems && Object.keys(stems).length > 0) {
      const trackList = Object.keys(stems).map((id) => {
        const stemData = stems[id] || {};
        const filename = stemData.filename || `${id}.wav`;
        return {
          id,
          url: `/api/stems/${sessionId}/${encodeURIComponent(filename)}?v=${stemsVersion}`,
        };
      });
      // Register original audio
      trackList.push({
        id: "original",
        url: `/api/audio/${sessionId}`,
      });
      mixerRef.current.preloadTracks(trackList);
    }
  }, [sessionId, stems, stemsVersion]);

  // Clean up WebAudioMixer on unmount
  useEffect(() => {
    const mixer = mixerRef.current;
    return () => {
      if (mixer) mixer.destroy();
    };
  }, []);

  // Deduplicated Master Stem Catalog combining standard stems & all 53 Mega models
  const catalogMap = useMemo(() => {
    const map = new Map();
    AVAILABLE_INSTRUMENTS.forEach((item) => {
      map.set(item.id, {
        id: item.id,
        name: item.name,
        icon: item.icon,
        color: item.color,
        desc: `${item.name} audio track`,
      });
    });
    MEGA_53_CATALOG.forEach((item) => {
      map.set(item.id, {
        id: item.id,
        name: item.name,
        icon: item.icon,
        color: item.color,
        desc: `${item.name} isolated stem (${item.category})`,
      });
    });
    return map;
  }, []);

  // Track state for AI stems (volume, mute, solo)
  const [aiTracksState, setAiTracksState] = useState({
    original: { volume: 0.8, muted: true, solo: false }, // default original to muted in stems mix so stems are heard
  });

  // Transcribe stem configuration modal state
  const [transcribeConfigStem, setTranscribeConfigStem] = useState(null);
  const [stemModelOption, setStemModelOption] = useState("large");
  const [selectedInstOption, setSelectedInstOption] = useState("soprano_and_alto_sax");
  const [stemBpmInput, setStemBpmInput] = useState("136");
  const [stemSingleTrack, setStemSingleTrack] = useState(true);

  const handleOpenTranscribeConfig = (stemDef) => {
    let defaultInst = "auto";
    const songBpm = session?.result?.detected_bpm ? String(session.result.detected_bpm) : "";
    setSelectedInstOption(defaultInst);
    setStemModelOption("large");
    setStemBpmInput(songBpm);
    setStemSingleTrack(true);
    setTranscribeConfigStem(stemDef);
  };

  const handleQuickTranscribeStem = (stemDef) => {
    if (!onTranscribeStem) return;
    const songBpm = session?.result?.detected_bpm || null;
    onTranscribeStem(stemDef.id, {
      muscriptorModel: "large",
      muscriptorInstruments: null, // Unconstrained transcription across all instruments and registers
      manualTempo: songBpm,
      singleTrack: true,
    });
  };

  const duration = session?.result?.duration_seconds || session?.duration || 1;
  const effectiveCurrentTime = currentTime !== undefined ? currentTime : localCurrentTime;

  const hasAiStems = stems && Object.keys(stems).length > 0;
  const availableAiStemsCount = hasAiStems ? Object.keys(stems).length : 0;
  const [showMegaSelector, setShowMegaSelector] = useState(!hasAiStems);

  // Active stem definitions guaranteed to have unique IDs and full metadata
  const activeStemDefs = useMemo(() => {
    if (hasAiStems) {
      const defs = [];
      const seen = new Set();
      Object.keys(stems).forEach((id) => {
        if (!seen.has(id)) {
          seen.add(id);
          const stemData = stems[id] || {};
          const cat = catalogMap.get(id);
          defs.push({
            id,
            name: stemData.name || cat?.name || (id === "instrumental" ? "Instrumental (No Vocals)" : id.charAt(0).toUpperCase() + id.slice(1)),
            icon: stemData.icon || cat?.icon || (id === "instrumental" ? "🎛️" : "🎵"),
            desc: cat?.desc || "Separated audio stem",
            color: stemData.color || cat?.color || STEM_COLORS[id] || "#00e5ff",
          });
        }
      });
      return defs;
    }

    // When nothing separated yet, preview selected stems
    if (selectedModel === "bs_roformer_mega_53stem") {
      return selectedMegaInstruments.map((id) => {
        const cat = catalogMap.get(id) || { name: id, icon: "🎵", color: "#00e5ff", desc: "Selected instrument" };
        return {
          id,
          name: cat.name,
          icon: cat.icon,
          desc: cat.desc,
          color: cat.color,
        };
      });
    }

    return selectedInstruments.map((id) => {
      const cat = catalogMap.get(id) || { name: id, icon: "🎵", color: "#00e5ff", desc: "Selected stem" };
      return {
        id,
        name: cat.name,
        icon: cat.icon,
        desc: cat.desc,
        color: cat.color,
      };
    });
  }, [hasAiStems, stems, selectedModel, selectedMegaInstruments, selectedInstruments, catalogMap]);

  // Apply volume / solo / mute calculations across all active audio tracks
  const applyAudioVolumes = (stateMap) => {
    if (mixerRef.current) {
      mixerRef.current.updateAllTracksState(stateMap);
    }
  };

  const updateAiTrack = (id, updates) => {
    setAiTracksState((prev) => {
      const current = prev[id] || { volume: 0.8, muted: false, solo: false };
      const next = { ...current, ...updates };
      const updatedMap = { ...prev, [id]: next };
      applyAudioVolumes(updatedMap);
      return updatedMap;
    });
  };

  // When master transport (bottom WaveformPlayer) starts playing, pause stems mix and solo auditions
  const prevIsPlayingRef = useRef(isPlaying);
  useEffect(() => {
    // Only pause stems when master transport transitions from paused to playing
    if (isPlaying && !prevIsPlayingRef.current) {
      if (mixerRef.current) mixerRef.current.pause();
      setPlayingStemId(null);
      setIsPlayingAll(false);
    }
    prevIsPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // TOGGLE PLAY ALL STEMS SIMULTANEOUSLY IN SYNC VIA WEBAUDIO MIXER
  const togglePlayAllStems = async () => {
    if (!mixerRef.current) return;

    if (isPlayingAll) {
      mixerRef.current.pause();
      setIsPlayingAll(false);
    } else {
      // 1. Explicitly pause bottom master transport so original audio does NOT play in background
      if (onPlayPause) onPlayPause(false);

      // 2. Pause any solo audition stem
      if (playingStemId) {
        setPlayingStemId(null);
      }

      // 3. Apply volumes with live Solo / Mute rules
      mixerRef.current.updateAllTracksState(aiTracksState);

      // 4. Start all stems in sync at current time
      const trackDur = duration;
      let startTime = effectiveCurrentTime;
      if (trackDur > 0 && startTime >= trackDur - 0.3) {
        startTime = 0;
        setLocalCurrentTime(0);
        if (onTimeUpdate) onTimeUpdate(0);
      }

      const activeIds = activeStemDefs
        .filter((d) => stems && stems[d.id])
        .map((d) => d.id);

      // If original track is unmuted in stems mix, include it
      if (!aiTracksState["original"]?.muted) {
        activeIds.push("original");
      }

      setIsPlayingAll(true);
      await mixerRef.current.play(activeIds, startTime, {
        onTimeUpdate: (t) => {
          setLocalCurrentTime(t);
          if (onTimeUpdate) onTimeUpdate(t);
        },
        onEnded: () => {
          setIsPlayingAll(false);
        },
      });
    }
  };

  // Handle single stem play/pause audition (ENSURES MASTER ORIGINAL AUDIO NEVER STARTS)
  const togglePlayStem = async (stemId) => {
    if (!mixerRef.current) return;

    if (playingStemId === stemId) {
      mixerRef.current.pause();
      setPlayingStemId(null);
    } else {
      // 1. Explicitly make sure master transport is paused
      if (onPlayPause) {
        onPlayPause(false);
      }

      // 2. If all-stems mix was playing, pause it
      if (isPlayingAll) {
        setIsPlayingAll(false);
      }

      // 3. Set this stem to solo in the WebAudioMixer
      const soloState = { ...aiTracksState };
      Object.keys(soloState).forEach((k) => {
        soloState[k] = { ...soloState[k], solo: k === stemId };
      });
      if (!soloState[stemId]) {
        soloState[stemId] = { volume: 0.8, muted: false, solo: true };
      }
      mixerRef.current.updateAllTracksState(soloState);

      const trackDur = duration;
      let startTime = effectiveCurrentTime;
      if (trackDur > 0 && startTime >= trackDur - 0.3) {
        startTime = 0;
        setLocalCurrentTime(0);
        if (onTimeUpdate) onTimeUpdate(0);
      }

      setPlayingStemId(stemId);
      await mixerRef.current.play([stemId], startTime, {
        onTimeUpdate: (t) => {
          setLocalCurrentTime(t);
          if (onTimeUpdate) onTimeUpdate(t);
        },
        onEnded: () => {
          setPlayingStemId(null);
        },
      });
    }
  };

  // Scrubbing & seeking across all stems or single stem
  const handleSeek = (newTime) => {
    setLocalCurrentTime(newTime);
    if (onTimeUpdate) {
      onTimeUpdate(newTime);
    }
    if (mixerRef.current) {
      mixerRef.current.seek(newTime);
    }
  };


  const handleClearStems = async () => {
    if (!sessionId) return;
    if (!window.confirm("Are you sure you want to delete all separated stems for this session? This will remove the audio stems from disk so you can re-separate or save disk space.")) {
      return;
    }
    try {
      await deleteStems(sessionId);
      setStems({});
      setStemsVersion(Date.now());
      if (isPlayingAll) setIsPlayingAll(false);
      if (playingStemId && playingStemId !== "original") setPlayingStemId(null);
      if (onSessionUpdate) onSessionUpdate();
      notifications.show({
        title: "Stems Cleared",
        message: "All isolated stems removed from disk.",
        color: "teal",
      });
    } catch (err) {
      notifications.show({
        title: "Delete Failed",
        message: err.message,
        color: "red",
      });
    }
  };

  const handleDeleteSingleStem = async (stemId, stemName) => {
    if (!sessionId) return;
    try {
      await deleteSingleStem(sessionId, stemId);
      setStems((prev) => {
        const next = { ...prev };
        delete next[stemId];
        return next;
      });
      setStemsVersion(Date.now());
      if (playingStemId === stemId) {
        setPlayingStemId(null);
      }
      if (onSessionUpdate) onSessionUpdate();
      notifications.show({
        title: "Stem Deleted",
        message: `Removed "${stemName}" from disk.`,
        color: "teal",
      });
    } catch (err) {
      notifications.show({
        title: "Delete Failed",
        message: err.message,
        color: "red",
      });
    }
  };

  // Run separation and immediately surface isolated stems without needing transcription
  const handleRunSeparation = async () => {
    if (!sessionId || isSeparating) return;
    try {
      setIsSeparating(true);
      setSeparationProgress(5);
      const isMega = selectedModel === "bs_roformer_mega_53stem";
      const isBs = selectedModel === "bs_roformer_sw_6stem";
      const targetInstruments = isMega
        ? selectedMegaInstruments
        : isBs
        ? selectedInstruments
        : null;
      const count = isMega ? selectedMegaInstruments.length : isBs ? selectedInstruments.length : 6;
      setSeparationMsg(
        isMega
          ? `Starting BS-RoFormer Mega separation for ${count} stem(s)...`
          : isBs
          ? `Starting BS-RoFormer AI separation for ${count} stem(s)...`
          : "Starting Demucs separation..."
      );

      // Trigger backend separation job
      await startStemSeparation(
        sessionId,
        selectedModel,
        "auto",
        targetInstruments,
        separationQuality
      );

      let isFinished = false;

      // Connect to WebSocket for real-time progress & instant completion
      try {
        connectProgressWebSocket(
          sessionId,
          (event) => {
            if (isFinished) return;
            if (event.type === "stems_progress") {
              const d = event.data;
              if (d.progress !== undefined) {
                setSeparationProgress(Math.round(d.progress * 100));
              }
              if (d.message) {
                setSeparationMsg(d.message);
              } else if (d.stage === "separating") {
                const chunkStr = d.chunk ? ` (chunk ${d.chunk}/${d.total_chunks})` : "";
                const stemStr = d.stem_name ? ` [${d.stem_name}]` : "";
                const pct = d.progress ? ` ${Math.round(d.progress * 100)}%` : "";
                setSeparationMsg(`BS-RoFormer AI: Isolating${stemStr}${chunkStr}${pct}...`);
              } else if (d.stage === "saving_stems") {
                setSeparationMsg("BS-RoFormer AI: Saving high-fidelity 44.1kHz stems...");
              } else if (d.stage === "stem_completed") {
                if (d.stems_meta) {
                  setStems(d.stems_meta);
                }
              }
            } else if (event.type === "stems_completed") {
              isFinished = true;
              const newStems = event.data || {};
              setStems(newStems);
              setStemsVersion(Date.now());
              setIsSeparating(false);
              setSeparationMsg("");
              setSeparationProgress(100);
              if (onSessionUpdate) onSessionUpdate();
            } else if (event.type === "stems_error") {
              isFinished = true;
              setIsSeparating(false);
              setSeparationMsg("");
              setSeparationProgress(0);
              notifications.show({
                title: "Separation Error",
                message: event.error,
                color: "red",
              });
            }
          },
          (err) => {
            console.warn("Stems WebSocket error", err);
          }
        );
      } catch (wsErr) {
        console.warn("Could not connect WebSocket:", wsErr);
      }

      // Robust polling fallback every 1500ms
      const checkInterval = setInterval(async () => {
        if (isFinished) {
          clearInterval(checkInterval);
          return;
        }
        try {
          const res = await fetchStems(sessionId);
          if (res.status === "processing") {
            // Live update intermediate stems if available without triggering cache-buster reload
            if (res.stems && Object.keys(res.stems).length > 0) {
              setStems(res.stems);
            }
          } else if (res.status === "ready" && res.stems && Object.keys(res.stems).length > 0) {
            isFinished = true;
            setStems(res.stems);
            setStemsVersion(Date.now());
            setIsSeparating(false);
            setSeparationMsg("");
            setSeparationProgress(100);
            clearInterval(checkInterval);
            if (onSessionUpdate) onSessionUpdate();
            notifications.show({
              title: "Separation Complete",
              message: "Isolated stems are ready in the mixer.",
              color: "teal",
            });
          } else if (res.status === "error") {
            isFinished = true;
            setIsSeparating(false);
            setSeparationMsg("");
            setSeparationProgress(0);
            clearInterval(checkInterval);
            notifications.show({
              title: "Separation Error",
              message: "Stem separation encountered an error.",
              color: "red",
            });
          }
        } catch (e) {}
      }, 1500);
    } catch (err) {
      notifications.show({
        title: "Separation Failed",
        message: err.message,
        color: "red",
      });
      setIsSeparating(false);
      setSeparationMsg("");
    }
  };

  const formatTime = (secs) => {
    if (isNaN(secs) || secs < 0) return "00:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden", background: "var(--bg-card)" }}>
      {/* Top Header Controls */}
      <Box
        px="md"
        py="xs"
        style={{
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <Group gap="xs" align="center" wrap="wrap">
          {/* PLAY ALL STEMS BUTTON */}
          {hasAiStems && (
            <Button
              size="xs"
              radius="md"
              variant={isPlayingAll ? "filled" : "light"}
              color="teal"
              leftSection={isPlayingAll ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
              onClick={togglePlayAllStems}
              title={isPlayingAll ? "Pause Stems Multi-Track Mix" : "Play all separated stems simultaneously with faders & solo/mute"}
              style={{
                boxShadow: isPlayingAll ? "0 0 12px rgba(0, 230, 118, 0.5)" : "none",
              }}
            >
              {isPlayingAll ? "Pause Stems Mix" : `Play All Stems (${availableAiStemsCount})`}
            </Button>
          )}

          {/* Download All Stems (ZIP) Button */}
          {hasAiStems && (
            <Button
              component="a"
              href={`/api/export/${sessionId}/stems_zip`}
              download={`${sessionId}_stems.zip`}
              size="xs"
              radius="md"
              variant="light"
              color="teal"
              leftSection={<IconDownload size={14} />}
              title="Download all separated 44.1kHz WAV stems in a single ZIP package"
            >
              Download Stems ZIP
            </Button>
          )}
        </Group>

        {/* Right Separation Actions */}
        <Group gap="xs" align="center" wrap="wrap">
          <Button
            size="xs"
            radius="md"
            variant={showMegaSelector ? "filled" : "light"}
            color="cyan"
            onClick={() => setShowMegaSelector((prev) => !prev)}
            title="Click to show or hide the 53-instrument extraction catalog"
          >
            🎼 BS-RoFormer Mega ({selectedMegaInstruments.length} Selected) {showMegaSelector ? "▲" : "▼"}
          </Button>

          <Select
            size="xs"
            radius="md"
            value={separationQuality}
            onChange={(val) => val && setSeparationQuality(val)}
            disabled={isSeparating}
            data={[
              { label: "💎 High Quality (FP32, 75% Overlap / 4x OLA)", value: "high_quality" },
              { label: "👑 Studio Master (FP32, 87.5% Overlap / 8x OLA + TTA)", value: "studio_master" },
              { label: "⚡ Fast (FP16, 50% Overlap)", value: "fast" },
            ]}
            style={{ width: 240 }}
          />

          {isSeparating ? (
            <Paper
              px="xs"
              py={4}
              radius="md"
              withBorder
              style={{
                background: "rgba(0, 229, 255, 0.08)",
                borderColor: "rgba(0, 229, 255, 0.35)",
                minWidth: 240,
              }}
            >
              <Group justify="space-between" mb={4}>
                <Text size="xs" fw={600} c="cyan">
                  {separationMsg || "Separating stems..."}
                </Text>
                {separationProgress > 0 && (
                  <Text size="xs" fw={700} c="teal" style={{ fontFamily: "monospace" }}>
                    {separationProgress}%
                  </Text>
                )}
              </Group>
              <div style={{ width: "100%", height: "4px", background: "rgba(255, 255, 255, 0.1)", borderRadius: "2px", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.max(4, Math.min(100, separationProgress))}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #00e5ff, #00e676)",
                    borderRadius: "2px",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </Paper>
          ) : (
            <>
              {hasAiStems && (
                <Button
                  size="xs"
                  radius="md"
                  variant="light"
                  color="grape"
                  onClick={() => onTranscribeOrchestral && onTranscribeOrchestral()}
                  disabled={isProcessing || isSeparating}
                  leftSection={<span>🎻</span>}
                  title="Transcribe all stems sequentially and compile unified multi-staff orchestral score"
                >
                  Transcribe Stems to Orchestral Score
                </Button>
              )}
              {hasAiStems && (
                <Button
                  size="xs"
                  radius="md"
                  variant="light"
                  color="red"
                  onClick={handleClearStems}
                  disabled={isProcessing || isSeparating}
                  leftSection={<IconTrash size={14} />}
                  title="Delete separated audio stems from disk"
                >
                  Clear Stems
                </Button>
              )}
              <Button
                size="xs"
                radius="md"
                variant="filled"
                color="teal"
                onClick={handleRunSeparation}
                disabled={!sessionId || isProcessing}
                leftSection={<IconBolt size={14} />}
              >
                {hasAiStems
                  ? "Re-Separate Stems"
                  : `Separate ${
                      selectedModel === "bs_roformer_mega_53stem"
                        ? `${selectedMegaInstruments.length} Stems`
                        : selectedModel === "bs_roformer_sw_6stem"
                        ? `${selectedInstruments.length} Stems`
                        : "Stems"
                    }`}
              </Button>
            </>
          )}
        </Group>
      </Box>

      {/* Main Workspace Area (Scrollable Stems DAW) */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "16px" }}>

        {/* BS-RoFormer Mega 53-Instrument Selective Filter (mounted inside scrollable view) */}
        {showMegaSelector && (
          <div style={{ marginBottom: "16px" }}>
            <MegaInstrumentSelector
              selectedInstruments={selectedMegaInstruments}
              onChange={setSelectedMegaInstruments}
              disabled={isSeparating}
              onClose={() => setShowMegaSelector(false)}
            />
          </div>
        )}

        {!hasAiStems && !isSeparating ? (
          <div
            style={{
              background: "rgba(217, 119, 54, 0.04)",
              border: "1px dashed rgba(217, 119, 54, 0.3)",
              borderRadius: "10px",
              padding: "28px",
              textAlign: "center",
              maxWidth: "640px",
              margin: "30px auto",
            }}
          >
            <div style={{ fontSize: "32px", marginBottom: "8px" }}>🎛️</div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "6px" }}>
              AI Stem Separation (BS-RoFormer Mega 53-Stems)
            </div>
            <div style={{ fontSize: "12.5px", color: "var(--text-secondary)", lineHeight: "1.6", marginBottom: "18px" }}>
              Isolate any of 53 instruments with dedicated BS-RoFormer models, Hann-window overlap-add, interactive waveforms, and direct MIDI transcription.
            </div>
            <Button
              size="md"
              radius="md"
              variant="filled"
              color="teal"
              onClick={handleRunSeparation}
              disabled={!sessionId}
              leftSection={<IconBolt size={18} />}
              style={{ fontWeight: 700 }}
            >
              ⚡ Separate {selectedMegaInstruments.length} Selected Stems Now (CUDA Accelerated)
            </Button>
          </div>
        ) : (
          /* Multi-Track DAW View: Player Controls on Top, Full-Width Waveform Below */
          <div className="multitrack-container">
            {/* 1. ORIGINAL / SOURCE AUDIO REFERENCE TRACK */}
                <div className="multitrack-row" style={{ borderLeft: "4px solid #12b886", background: "rgba(12, 22, 38, 0.85)" }}>
                  {/* Top Player Controls */}
                  <div className="multitrack-header">
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "20px" }}>🎵</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: "13.5px", color: "#ffffff", display: "flex", alignItems: "center", gap: "8px" }}>
                          <span>Original Track (Source Mix)</span>
                          <Badge
                            size="xs"
                            radius="sm"
                            variant="light"
                            color="teal"
                          >
                            Source Audio
                          </Badge>
                        </div>
                        <Text size="10.5px" c="dimmed">
                          Full unseparated reference mix — play or solo to A/B compare against isolated stems
                        </Text>
                      </div>
                    </div>

                    <Group gap="xs" align="center" wrap="wrap">
                      <Button
                        size="compact-xs"
                        radius="sm"
                        variant={playingStemId === "original" ? "filled" : "light"}
                        color={playingStemId === "original" ? "teal" : "gray"}
                        leftSection={playingStemId === "original" ? <IconPlayerPause size={12} /> : <IconPlayerPlay size={12} />}
                        onClick={() => togglePlayStem("original")}
                        title={playingStemId === "original" ? "Pause Source Audio" : "Listen to full original source mix"}
                        style={{
                          fontWeight: 700,
                          background: playingStemId === "original" ? "#12b886" : undefined,
                          color: playingStemId === "original" ? "#ffffff" : undefined,
                        }}
                      >
                        {playingStemId === "original" ? "PAUSE" : "PLAY SOURCE"}
                      </Button>

                      <ActionIcon.Group>
                        <ActionIcon
                          size="xs"
                          variant={aiTracksState["original"]?.muted ? "filled" : "subtle"}
                          color={aiTracksState["original"]?.muted ? "red" : "gray"}
                          onClick={() => updateAiTrack("original", { muted: !aiTracksState["original"]?.muted })}
                          title="Mute original source audio in mix"
                        >
                          <Text size="10px" fw={800}>M</Text>
                        </ActionIcon>
                        <ActionIcon
                          size="xs"
                          variant={aiTracksState["original"]?.solo ? "filled" : "subtle"}
                          color={aiTracksState["original"]?.solo ? "yellow" : "gray"}
                          onClick={() => updateAiTrack("original", { solo: !aiTracksState["original"]?.solo })}
                          title="Solo original source audio (A/B reference)"
                        >
                          <Text size="10px" fw={800}>S</Text>
                        </ActionIcon>
                      </ActionIcon.Group>

                      <Group gap={6} align="center" style={{ width: 110 }}>
                        <Text size="10px" c="dimmed" style={{ width: 26, textAlign: "right", fontFamily: "var(--font-mono, monospace)" }}>
                          {Math.round((aiTracksState["original"]?.volume ?? 0.8) * 100)}%
                        </Text>
                        <Slider
                          size="xs"
                          color="teal"
                          min={0}
                          max={1}
                          step={0.05}
                          value={aiTracksState["original"]?.volume ?? 0.8}
                          onChange={(val) => updateAiTrack("original", { volume: val })}
                          style={{ flex: 1 }}
                          label={null}
                        />
                      </Group>

                      <Button
                        component="a"
                        href={`/api/audio/${sessionId}`}
                        download={`${sessionId}_original.wav`}
                        size="compact-xs"
                        radius="sm"
                        variant="subtle"
                        color="gray"
                        leftSection={<IconDownload size={12} />}
                        title="Download original source WAV file"
                      >
                        WAV
                      </Button>

                      <div style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--text-secondary)", minWidth: "80px", textAlign: "right" }}>
                        {formatTime(effectiveCurrentTime)} / {formatTime(duration)}
                      </div>
                    </Group>
                  </div>

                  {/* Full-Width Waveform Below Player */}
                  <div className="multitrack-waveform-col">
                    <StemWaveform
                      peaks={session?.peaks || []}
                      currentTime={effectiveCurrentTime}
                      duration={duration}
                      accentColor="#12b886"
                      isMuted={aiTracksState["original"]?.muted}
                      isSolo={aiTracksState["original"]?.solo}
                      height={54}
                      onSeek={(newT) => handleSeek(newT, "original")}
                    />
                  </div>
                </div>

                {/* 2. ISOLATED STEM TRACKS */}
                {activeStemDefs.map((stemDef) => {
                  const stemData = stems[stemDef.id] || {};
                  const state = aiTracksState[stemDef.id] || { volume: 0.8, muted: false, solo: false };
                  const audioFilename = stemData.filename || `${stemDef.id}.wav`;
                  const stemAudioUrl = `/api/stems/${sessionId}/${encodeURIComponent(audioFilename)}`;
                  const downloadUrl = `/api/stems/${sessionId}/${encodeURIComponent(audioFilename)}?download=true`;
                  const stemPeaks = stemData.peaks || [];
                  const stemColor = stemDef.color || STEM_COLORS[stemDef.id] || "#00e5ff";
                  const isAuditioning = playingStemId === stemDef.id;

                  return (
                    <div key={stemDef.id} className="multitrack-row">
                      {/* TOP SECTION: PLAYER CONTROLS */}
                      <div className="multitrack-header">
                        {/* Left: Track Identity & Status */}
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontSize: "20px" }}>{stemDef.icon}</span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: "13.5px", color: stemColor, display: "flex", alignItems: "center", gap: "8px" }}>
                              <span>{stemDef.name}</span>
                              <Badge
                                size="xs"
                                radius="sm"
                                variant={stemData.transcribed ? "light" : "outline"}
                                color={stemData.transcribed ? "teal" : "gray"}
                              >
                                {stemData.transcribed ? "✓ Transcribed" : "Separated"}
                              </Badge>
                            </div>
                            <Text size="10.5px" c="dimmed">{stemDef.desc}</Text>
                          </div>
                        </div>

                        {/* Right: Audio Player Controls, Solo/Mute, Fader, Download, Transcribe, Time */}
                        <Group gap="xs" align="center" wrap="wrap">
                          {/* Audition Play / Pause Button */}
                          <Button
                            size="compact-xs"
                            radius="sm"
                            variant={isAuditioning ? "filled" : "light"}
                            color={isAuditioning ? "teal" : "gray"}
                            leftSection={isAuditioning ? <IconPlayerPause size={12} /> : <IconPlayerPlay size={12} />}
                            onClick={() => togglePlayStem(stemDef.id)}
                            title={isAuditioning ? "Pause Stem Audition" : `Listen to isolated ${stemDef.name} (no original audio bleed)`}
                            style={{
                              fontWeight: 700,
                              background: isAuditioning ? stemColor : undefined,
                              color: isAuditioning ? "#000" : undefined,
                              boxShadow: isAuditioning ? `0 0 10px ${stemColor}66` : "none",
                            }}
                          >
                            {isAuditioning ? "PAUSE" : "PLAY"}
                          </Button>

                          {/* Mute & Solo */}
                          <ActionIcon.Group>
                            <ActionIcon
                              size="xs"
                              variant={state.muted ? "filled" : "subtle"}
                              color={state.muted ? "red" : "gray"}
                              onClick={() => updateAiTrack(stemDef.id, { muted: !state.muted })}
                              title="Mute stem in mix"
                            >
                              <Text size="10px" fw={800}>M</Text>
                            </ActionIcon>
                            <ActionIcon
                              size="xs"
                              variant={state.solo ? "filled" : "subtle"}
                              color={state.solo ? "yellow" : "gray"}
                              onClick={() => updateAiTrack(stemDef.id, { solo: !state.solo })}
                              title="Solo stem in mix"
                            >
                              <Text size="10px" fw={800}>S</Text>
                            </ActionIcon>
                          </ActionIcon.Group>

                          {/* Volume Slider */}
                          <Group gap={6} align="center" style={{ width: 110 }}>
                            <Text size="10px" c="dimmed" style={{ width: 26, textAlign: "right", fontFamily: "var(--font-mono, monospace)" }}>
                              {Math.round(state.volume * 100)}%
                            </Text>
                            <Slider
                              size="xs"
                              color="blue"
                              min={0}
                              max={1}
                              step={0.05}
                              value={state.volume}
                              onChange={(val) => updateAiTrack(stemDef.id, { volume: val })}
                              style={{ flex: 1 }}
                              label={null}
                            />
                          </Group>

                          {/* Download WAV */}
                          <Button
                            component="a"
                            href={downloadUrl}
                            download={`${sessionId}_${stemDef.id}.wav`}
                            size="compact-xs"
                            radius="sm"
                            variant="subtle"
                            color="gray"
                            leftSection={<IconDownload size={12} />}
                            title={`Download isolated ${stemDef.name} 44.1kHz WAV`}
                          >
                            WAV
                          </Button>

                          {/* Transcribe Trigger & Options */}
                          <Button.Group>
                            <Button
                              size="compact-xs"
                              radius="sm"
                              variant="light"
                              color="teal"
                              disabled={isProcessing || isSeparating}
                              onClick={() => handleQuickTranscribeStem(stemDef)}
                              leftSection={<IconBolt size={12} />}
                              title={`Transcribe ${stemDef.name} to 1 clean track at song tempo`}
                            >
                              {stemData.transcribed ? "Re-Transcribe" : "Transcribe"}
                            </Button>
                            <ActionIcon
                              size="xs"
                              radius="sm"
                              variant="subtle"
                              color="gray"
                              disabled={isProcessing || isSeparating}
                              onClick={() => handleOpenTranscribeConfig(stemDef)}
                              title={`Configure instrument & tempo for ${stemDef.name}`}
                            >
                              <IconSettings size={13} />
                            </ActionIcon>
                          </Button.Group>

                          {stemData.transcribed && (
                            <>
                              <Button
                                size="compact-xs"
                                radius="sm"
                                variant="light"
                                color="indigo"
                                leftSection={<IconPiano size={12} />}
                                onClick={() => onViewStemScore && onViewStemScore(stemDef.id)}
                                title={`View transcribed MIDI notes in Piano Roll for ${stemDef.name}`}
                              >
                                Piano Roll
                              </Button>
                              <Button
                                component="a"
                                href={`/api/audio/${sessionId}/transcription_${stemDef.id}.mid`}
                                download={`${sessionId}_${stemDef.id}.mid`}
                                size="compact-xs"
                                radius="sm"
                                variant="light"
                                color="teal"
                                leftSection={<IconDownload size={12} />}
                                title="Download stem MIDI"
                              >
                                MIDI
                              </Button>
                            </>
                          )}

                          {/* Time readout */}
                          <Text size="11px" c="dimmed" style={{ fontFamily: "var(--font-mono, monospace)", minWidth: 75, textAlign: "right" }}>
                            {formatTime(effectiveCurrentTime)} / {formatTime(duration)}
                          </Text>

                          {/* Delete single stem */}
                          <ActionIcon
                            size="sm"
                            radius="sm"
                            variant="subtle"
                            color="red"
                            onClick={() => handleDeleteSingleStem(stemDef.id, stemDef.name)}
                            title={`Delete isolated ${stemDef.name} stem from disk`}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Group>
                      </div>

                      {/* BOTTOM SECTION: FULL-WIDTH WAVEFORM BELOW PLAYER */}
                      <div className="multitrack-waveform-col">
                        <StemWaveform
                          peaks={stemPeaks}
                          currentTime={effectiveCurrentTime}
                          duration={duration}
                          accentColor={stemColor}
                          isMuted={state.muted}
                          isSolo={state.solo}
                          height={54}
                          onSeek={(newT) => handleSeek(newT, stemDef.id)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
        )}
      </div>

      {/* Stem-Specific Transcription Options Modal */}
      {transcribeConfigStem && (
        <Modal
          opened={Boolean(transcribeConfigStem)}
          onClose={() => setTranscribeConfigStem(null)}
          title={
            <Group gap="xs" align="center">
              <span style={{ fontSize: "18px" }}>🎷</span>
              <Text fw={700} size="md">
                Transcribe: {transcribeConfigStem.name}
              </Text>
            </Group>
          }
          size="lg"
          radius="md"
          centered
        >
          <Stack gap="md" py="xs">
            {/* Model Variant Selection */}
            <Card p="md" radius="md" withBorder style={{ background: "var(--bg-surface)" }}>
              <Group justify="space-between" mb="xs">
                <Text size="xs" fw={700}>
                  🧠 Transcription Model:
                </Text>
                <Badge size="xs" color={stemModelOption === "large" ? "teal" : "cyan"} variant="light">
                  {stemModelOption === "large" ? "1.3B Parameters (~3.1 GB VRAM)" : "350M Parameters (~1.2 GB VRAM)"}
                </Badge>
              </Group>
              <SegmentedControl
                value={stemModelOption}
                onChange={setStemModelOption}
                data={[
                  { label: "🔥 MuScriptor Large (1.3B — Best Polyphony)", value: "large" },
                  { label: "⚡ MuScriptor Medium (350M — Fast)", value: "medium" },
                ]}
                fullWidth
                size="xs"
                radius="md"
              />
            </Card>

            {/* Instrument Selection */}
            <Card p="md" radius="md" withBorder style={{ background: "var(--bg-surface)" }}>
              <Text size="xs" fw={700} mb="xs">
                🎯 Select Instrument for MuScriptor:
              </Text>

              {transcribeConfigStem.id.includes("sax") ? (
                <Radio.Group
                  value={selectedInstOption}
                  onChange={(val) => setSelectedInstOption(val)}
                >
                  <Stack gap="xs">
                    {[
                      { val: "auto", label: "🌐 Automatic / Unconstrained (Recommended — Transcribes all registers & sax types)" },
                      { val: "soprano_and_alto_sax", label: "🎷 Alto / Soprano Saxophone (Specific)" },
                      { val: "tenor_sax", label: "🎷 Tenor Saxophone (Specific)" },
                      { val: "baritone_sax", label: "🎷 Baritone Saxophone (Specific)" },
                      { val: "all_sax", label: "🎷 All 3 Saxophones (Multi-Track: Alto + Tenor + Baritone)" },
                    ].map((opt) => (
                      <Radio
                        key={opt.val}
                        value={opt.val}
                        label={opt.label}
                        color="teal"
                        size="xs"
                        styles={{ label: { cursor: "pointer", fontSize: "12.5px" } }}
                      />
                    ))}
                  </Stack>
                </Radio.Group>
              ) : (
                <Select
                  size="sm"
                  radius="md"
                  value={selectedInstOption}
                  onChange={(val) => val && setSelectedInstOption(val)}
                  data={[
                    { value: "auto", label: "🌐 Automatic / Unconstrained (Recommended — All Instruments)" },
                    { value: "acoustic_piano", label: "🎹 Acoustic Piano" },
                    { value: "electric_piano", label: "🎹 Electric Piano" },
                    { value: "organ", label: "🎹 Organ" },
                    { value: "acoustic_guitar", label: "🎸 Acoustic Guitar" },
                    { value: "clean_electric_guitar", label: "🎸 Clean Electric Guitar" },
                    { value: "distorted_electric_guitar", label: "🎸 Distorted Electric Guitar" },
                    { value: "acoustic_bass", label: "🎸 Acoustic Bass" },
                    { value: "electric_bass", label: "🎸 Electric Bass" },
                    { value: "voice", label: "🎤 Voice / Vocals" },
                    { value: "violin", label: "🎻 Violin" },
                    { value: "cello", label: "🎻 Cello" },
                    { value: "trumpet", label: "🎺 Trumpet" },
                    { value: "trombone", label: "🎺 Trombone" },
                    { value: "flutes", label: "🎷 Flutes" },
                    { value: "clarinet", label: "🎷 Clarinet" },
                    { value: "soprano_and_alto_sax", label: "🎷 Alto / Soprano Sax" },
                    { value: "tenor_sax", label: "🎷 Tenor Sax" },
                    { value: "baritone_sax", label: "🎷 Baritone Sax" },
                    { value: "drums", label: "🥁 Drum Kit" },
                  ]}
                />
              )}
            </Card>

            {/* Tempo / BPM Input */}
            <Card p="md" radius="md" withBorder style={{ background: "var(--bg-surface)" }}>
              <Text size="xs" fw={700} mb="xs">
                ⏱️ Target Tempo / BPM:
              </Text>
              <Group gap="xs" align="center">
                <NumberInput
                  size="sm"
                  radius="md"
                  min={30}
                  max={300}
                  placeholder="Auto"
                  value={stemBpmInput === "" ? "" : Number(stemBpmInput)}
                  onChange={(val) => setStemBpmInput(val === "" ? "" : String(val))}
                  style={{ width: 130 }}
                  styles={{
                    input: {
                      fontFamily: "var(--font-mono, monospace)",
                      fontWeight: 700,
                      color: "var(--mantine-color-cyan-4)",
                    },
                  }}
                />
                <Button size="xs" radius="md" variant="subtle" color="gray" onClick={() => setStemBpmInput("")}>
                  Auto-Detect
                </Button>
                <Button size="xs" radius="md" variant="subtle" color="gray" onClick={() => setStemBpmInput("120")}>
                  120 BPM
                </Button>
                <Button size="xs" radius="md" variant="subtle" color="gray" onClick={() => setStemBpmInput("136")}>
                  136 BPM
                </Button>
              </Group>
              <Text size="xs" c="dimmed" mt={6}>
                Aligns the MIDI grid to your song's exact tempo to prevent quintuplet/septuplet tuplets and 64th rests.
              </Text>
            </Card>

            {/* Single Track Mode */}
            <Card p="md" radius="md" withBorder style={{ background: "var(--bg-surface)" }}>
              <Checkbox
                size="sm"
                color="teal"
                label="Consolidate into 1 Single Track (Prevents empty/split staves in MuseScore)"
                checked={stemSingleTrack}
                onChange={(e) => setStemSingleTrack(e.currentTarget.checked)}
                styles={{ label: { cursor: "pointer", fontSize: "12.5px" } }}
              />
            </Card>

            <Group justify="flex-end" gap="sm" mt="xs">
              <Button variant="subtle" color="gray" onClick={() => setTranscribeConfigStem(null)}>
                Cancel
              </Button>
              <Button
                variant="filled"
                color="teal"
                leftSection={<IconBolt size={15} />}
                onClick={() => {
                  let insts = null;
                  if (selectedInstOption === "all_sax") {
                    insts = ["soprano_and_alto_sax", "tenor_sax", "baritone_sax"];
                  } else if (selectedInstOption && selectedInstOption !== "auto") {
                    insts = [selectedInstOption];
                  }
                  if (onTranscribeStem) {
                    onTranscribeStem(transcribeConfigStem.id, {
                      muscriptorModel: stemModelOption,
                      muscriptorInstruments: insts,
                      manualTempo: stemBpmInput ? parseFloat(stemBpmInput) : null,
                      singleTrack: stemSingleTrack,
                    });
                  }
                  setTranscribeConfigStem(null);
                }}
              >
                Start Transcription
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </div>
  );
}
