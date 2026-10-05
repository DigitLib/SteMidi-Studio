import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { ActionIcon, Group, Badge, Text, SegmentedControl, Paper, Box, Slider, Tooltip } from "@mantine/core";
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerStop,
  IconRepeat,
  IconMusic,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset,
  IconX,
} from "@tabler/icons-react";
import WaveSurfer from "wavesurfer.js";
import HoverPlugin from "wavesurfer.js/dist/plugins/hover.esm.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import ZoomPlugin from "wavesurfer.js/dist/plugins/zoom.esm.js";
import { MEGA_53_CATALOG } from "./MegaInstrumentSelector";

export default function WaveformPlayer({
  session,
  activeStemId = null,
  availableStemId = null,
  audioSourceMode = "mix",
  onSelectAudioSource = null,
  onSelectStem = null,
  activeTab = "pianoroll",
  currentTime = 0,
  onTimeUpdate,
  isPlaying,
  onPlayPause,
  volume = 1,
  muted = false,
}) {
  const audioRef = useRef(null);
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const [speed, setSpeed] = useState(1);
  const [isLooping, setIsLooping] = useState(false);
  const [detectedDuration, setDetectedDuration] = useState(0);
  const [clientPeaks, setClientPeaks] = useState([]);
  const [isExtractingPeaks, setIsExtractingPeaks] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [loopRegion, setLoopRegion] = useState(null); // { id, start, end }
  const regionsPluginRef = useRef(null);
  const isLoopingRef = useRef(isLooping);
  isLoopingRef.current = isLooping;
  const loopRegionRef = useRef(loopRegion);
  loopRegionRef.current = loopRegion;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Reset loop region and zoom on new session/file
  const lastSessionIdRef = useRef(session?.session_id);
  useEffect(() => {
    if (session?.session_id && session.session_id !== lastSessionIdRef.current) {
      lastSessionIdRef.current = session.session_id;
      setLoopRegion(null);
      setZoom(0);
    }
  }, [session?.session_id]);

  const handleClearLoopRegion = useCallback(() => {
    if (regionsPluginRef.current) {
      try {
        regionsPluginRef.current.clearRegions();
      } catch (_) {}
    }
    setLoopRegion(null);
  }, []);

  const handleZoomChange = useCallback((newZoom) => {
    const clamped = Math.max(0, Math.min(300, Math.round(Number(newZoom) || 0)));
    setZoom(clamped);
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.zoom(clamped);
      } catch (e) {
        console.warn("WaveSurfer zoom notice:", e);
      }
    }
  }, []);

  const handleZoomStep = useCallback((delta) => {
    const cur = zoomRef.current || 0;
    const next = cur === 0 && delta > 0 ? 30 : Math.max(0, Math.min(300, cur + delta));
    handleZoomChange(next);
  }, [handleZoomChange]);

  // Active stem detection & derived properties
  const targetStem = availableStemId || (activeStemId && activeStemId !== "original" ? activeStemId : null);
  const isStemAudio = Boolean(activeStemId && activeStemId !== "original");
  const stemCatalogInfo = useMemo(() => {
    const sid = activeStemId || targetStem;
    return sid ? MEGA_53_CATALOG.find((m) => m.id === sid) : null;
  }, [activeStemId, targetStem]);

  const stemObj = useMemo(() => {
    const sid = activeStemId || targetStem;
    if (!sid) return null;
    return session?.stems?.[sid] || null;
  }, [activeStemId, targetStem, session?.stems]);

  const stemDisplayName = stemObj?.name || stemCatalogInfo?.name || (targetStem ? targetStem.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "");
  const stemColor = stemObj?.color || stemCatalogInfo?.color || "#f50057";
  const stemIcon = stemObj?.icon || stemCatalogInfo?.icon || "🎷";

  const audioUrl = isStemAudio && session?.session_id
    ? `/api/stems/${session.session_id}/${activeStemId}.wav`
    : (session?.session_id ? `/api/audio/${session.session_id}` : "");

  const backendPeaks = useMemo(() => {
    if (isStemAudio && stemObj?.peaks && stemObj.peaks.length > 0) {
      return stemObj.peaks;
    }
    if (!isStemAudio && session?.peaks && session.peaks.length > 0) {
      return session.peaks;
    }
    return [];
  }, [isStemAudio, stemObj, session?.peaks]);

  const duration = detectedDuration || (isStemAudio ? stemObj?.duration : null) || session?.result?.duration_seconds || session?.duration || 1;

  // Programmatic loop range setter (used by drag, In/Out buttons, Shift+Click)
  const setLoopBounds = useCallback((startSec, endSec) => {
    const dur = duration || (wavesurferRef.current ? wavesurferRef.current.getDuration() : 0) || 1;
    const s = Math.max(0, Math.min(dur, Math.round(Math.min(startSec, endSec) * 100) / 100));
    const e = Math.max(0, Math.min(dur, Math.round(Math.max(startSec, endSec) * 100) / 100));
    if (e - s < 0.1) return;

    const regionColor = isStemAudio ? "rgba(245, 0, 87, 0.28)" : "rgba(18, 184, 134, 0.28)";

    if (regionsPluginRef.current) {
      try {
        const existing = regionsPluginRef.current.getRegions();
        if (existing && existing.length > 0) {
          existing[0].setOptions({ start: s, end: e, color: regionColor });
          for (let i = 1; i < existing.length; i++) {
            try { existing[i].remove(); } catch (_) {}
          }
          setLoopRegion({ id: existing[0].id, start: s, end: e });
        } else {
          const r = regionsPluginRef.current.addRegion({
            id: `loop-region-${Date.now()}`,
            start: s,
            end: e,
            color: regionColor,
            drag: true,
            resize: true,
          });
          setLoopRegion({ id: r.id, start: s, end: e });
        }
      } catch (err) {
        console.warn("setLoopBounds notice:", err);
      }
    } else {
      setLoopRegion({ id: "loop-region", start: s, end: e });
    }
    setIsLooping(true);
  }, [duration, isStemAudio]);

  // Set Loop In at current playhead position
  const handleSetLoopIn = useCallback(() => {
    const cur = currentTimeRef.current || 0;
    const dur = duration || (wavesurferRef.current?.getDuration()) || 1;
    const existingEnd = loopRegionRef.current?.end;
    const newEnd = existingEnd !== undefined && existingEnd > cur + 0.3
      ? existingEnd
      : Math.min(dur, cur + 4);
    setLoopBounds(cur, newEnd);
  }, [duration, setLoopBounds]);

  // Set Loop Out at current playhead position
  const handleSetLoopOut = useCallback(() => {
    const cur = currentTimeRef.current || 0;
    const existingStart = loopRegionRef.current?.start;
    const newStart = existingStart !== undefined && existingStart < cur - 0.3
      ? existingStart
      : Math.max(0, cur - 4);
    setLoopBounds(newStart, cur);
  }, [setLoopBounds]);

  // Keyboard shortcuts: [ for Loop In, ] for Loop Out
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target?.isContentEditable
      ) {
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        handleSetLoopIn();
      } else if (e.key === "]") {
        e.preventDefault();
        handleSetLoopOut();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleSetLoopIn, handleSetLoopOut]);

  // Shift + Click on waveform to set loop range from playhead to clicked spot
  const handleContainerClick = useCallback((e) => {
    if (e.shiftKey && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const frac = Math.max(0, Math.min(1, clickX / rect.width));
      const dur = duration || (wavesurferRef.current?.getDuration()) || 1;
      const clickedTime = Math.round(frac * dur * 100) / 100;
      const cur = Math.round((currentTimeRef.current || 0) * 100) / 100;
      const s = Math.min(cur, clickedTime);
      const end = Math.max(cur, clickedTime);
      setLoopBounds(s, end);
    }
  }, [duration, setLoopBounds]);

  // Seamless audio track switching
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const pendingSeekRef = useRef(null);

  const lastAudioUrlRef = useRef(audioUrl);
  useEffect(() => {
    if (audioRef.current && audioUrl && audioUrl !== lastAudioUrlRef.current) {
      lastAudioUrlRef.current = audioUrl;
      const currentPos = currentTimeRef.current || 0;
      pendingSeekRef.current = currentPos;
      setDetectedDuration(0);
      audioRef.current.src = audioUrl;
      audioRef.current.load();
      try {
        audioRef.current.currentTime = currentPos;
      } catch (e) {}
      if (isPlayingRef.current) {
        audioRef.current.play().catch((e) => console.warn("Audio track switch notice:", e));
      }
    }
  }, [audioUrl]);

  // If backend peaks are missing or empty, extract peaks on client via Web Audio API fallback
  useEffect(() => {
    if ((!backendPeaks || backendPeaks.length === 0) && session?.session_id && audioUrl) {
      let isMounted = true;
      setIsExtractingPeaks(true);

      fetch(audioUrl)
        .then((res) => {
          if (!res.ok) throw new Error("Audio fetch failed");
          return res.arrayBuffer();
        })
        .then((arrayBuffer) => {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) return null;
          const audioCtx = new AudioContextClass();
          return audioCtx.decodeAudioData(arrayBuffer);
        })
        .then((audioBuffer) => {
          if (!isMounted || !audioBuffer) return;
          const rawData = audioBuffer.getChannelData(0);
          const totalSamples = 800;
          const blockSize = Math.max(1, Math.floor(rawData.length / totalSamples));
          const peaks = [];
          for (let i = 0; i < totalSamples; i++) {
            const start = i * blockSize;
            let max = 0;
            for (let j = 0; j < blockSize && start + j < rawData.length; j++) {
              const val = Math.abs(rawData[start + j]);
              if (val > max) max = val;
            }
            peaks.push(max);
          }
          const peakMax = Math.max(...peaks, 0.01);
          const normalized = peaks.map((p) => Math.min(1, Math.round((p / peakMax) * 1000) / 1000));
          if (isMounted) {
            setClientPeaks(normalized);
            setIsExtractingPeaks(false);
          }
        })
        .catch((err) => {
          console.warn("Client waveform extraction notice:", err);
          if (isMounted) setIsExtractingPeaks(false);
        });

      return () => {
        isMounted = false;
      };
    } else {
      setClientPeaks([]);
      setIsExtractingPeaks(false);
    }
  }, [session?.session_id, audioUrl, backendPeaks]);

  const effectivePeaks = useMemo(() => {
    if (backendPeaks && backendPeaks.length > 0) return backendPeaks;
    if (clientPeaks && clientPeaks.length > 0) return clientPeaks;
    return [];
  }, [backendPeaks, clientPeaks]);

  // WaveSurfer.js initialization with Hover, Regions, and Zoom plugins
  useEffect(() => {
    if (!containerRef.current || !session?.session_id || !audioUrl) return;

    containerRef.current.innerHTML = "";

    const wsRegions = RegionsPlugin.create();
    regionsPluginRef.current = wsRegions;

    const wsZoom = ZoomPlugin.create({
      scale: 0.5,
      maxZoom: 300,
      deltaThreshold: 5,
    });

    const hasPeaks = effectivePeaks && effectivePeaks.length > 0;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      media: audioRef.current,
      waveColor: "rgba(80, 110, 150, 0.65)",
      progressColor: isStemAudio ? stemColor : "#12b886",
      cursorColor: "#ffffff",
      cursorWidth: 2,
      height: 90,
      normalize: true,
      dragToSeek: false, // Must be false so click-drag creates loop regions instead of seeking
      autoScroll: true,
      autoCenter: true,
      minPxPerSec: zoomRef.current || 0,
      url: audioUrl,
      peaks: hasPeaks ? [effectivePeaks] : undefined,
      duration: duration > 0 ? duration : undefined,
      plugins: [
        wsRegions,
        wsZoom,
        HoverPlugin.create({
          lineColor: "rgba(255, 255, 255, 0.4)",
          lineWidth: 1,
          labelBackground: "rgba(11, 14, 21, 0.95)",
          labelColor: isStemAudio ? stemColor : "#12b886",
          labelSize: "10px",
        }),
      ],
    });

    // Enable drag selection on waveform to create loop region
    const regionColor = isStemAudio ? "rgba(245, 0, 87, 0.28)" : "rgba(18, 184, 134, 0.28)";
    try {
      wsRegions.enableDragSelection({
        color: regionColor,
        drag: true,
        resize: true,
      });
    } catch (err) {
      console.warn("enableDragSelection notice:", err);
    }

    // Listen to region events
    const handleRegionUpdate = (region) => {
      const start = Math.round(Math.min(region.start, region.end) * 100) / 100;
      const end = Math.round(Math.max(region.start, region.end) * 100) / 100;
      setLoopRegion({ id: region.id, start, end });
    };

    wsRegions.on("region-created", (region) => {
      // Retain only 1 loop region at a time
      wsRegions.getRegions().forEach((r) => {
        if (r.id !== region.id) {
          try { r.remove(); } catch (_) {}
        }
      });
      handleRegionUpdate(region);
      setIsLooping(true);
    });

    wsRegions.on("region-update", handleRegionUpdate);
    wsRegions.on("region-updated", handleRegionUpdate);

    wsRegions.on("region-double-clicked", (region) => {
      try { region.remove(); } catch (_) {}
      setLoopRegion(null);
    });

    wsRegions.on("region-removed", () => {
      if (wsRegions.getRegions().length === 0) {
        setLoopRegion(null);
      }
    });

    // Sync state if zoom is adjusted via mouse wheel or gestures
    ws.on("zoom", (newZoom) => {
      setZoom(Math.round(newZoom));
    });

    // Restore existing loop region if reinitializing (e.g., switched stems)
    ws.once("ready", () => {
      if (loopRegionRef.current) {
        try {
          wsRegions.clearRegions();
          wsRegions.addRegion({
            id: loopRegionRef.current.id,
            start: loopRegionRef.current.start,
            end: loopRegionRef.current.end,
            color: regionColor,
            drag: true,
            resize: true,
          });
        } catch (_) {}
      }
    });

    let lastEmit = 0;
    ws.on("timeupdate", (t) => {
      // Loop region playback boundary check
      if (isLoopingRef.current && loopRegionRef.current && audioRef.current) {
        const { start, end } = loopRegionRef.current;
        if (t >= end || (t < start - 0.5 && isPlayingRef.current)) {
          audioRef.current.currentTime = start;
          try { ws.setTime(start); } catch (_) {}
          onTimeUpdate?.(start);
          return;
        }
      }

      const now = performance.now();
      // Throttle React state updates to ~20 FPS (50ms) to significantly reduce iGPU compositing load
      if (now - lastEmit >= 50) {
        lastEmit = now;
        onTimeUpdate?.(t);
      }
    });

    ws.on("seeking", (t) => {
      onTimeUpdate?.(t);
    });

    ws.on("finish", () => {
      if (isLooping && audioRef.current) {
        const targetStart = loopRegionRef.current ? loopRegionRef.current.start : 0;
        audioRef.current.currentTime = targetStart;
        audioRef.current.play().catch(() => {});
      } else {
        onPlayPause?.(false);
      }
    });

    wavesurferRef.current = ws;

    return () => {
      try {
        ws.destroy();
      } catch (_) {}
      wavesurferRef.current = null;
      regionsPluginRef.current = null;
    };
  }, [audioUrl, session?.session_id]);

  // Update progressColor & region color if user switches between stem and full mix
  useEffect(() => {
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.setOptions({
          progressColor: isStemAudio ? stemColor : "#12b886",
        });
      } catch (_) {}
    }
    if (regionsPluginRef.current) {
      const col = isStemAudio ? "rgba(245, 0, 87, 0.28)" : "rgba(18, 184, 134, 0.28)";
      try {
        regionsPluginRef.current.getRegions().forEach((r) => {
          r.setOptions({ color: col });
        });
      } catch (_) {}
    }
  }, [isStemAudio, stemColor]);

  // Load precomputed peaks if they arrive or update asynchronously
  useEffect(() => {
    if (wavesurferRef.current && effectivePeaks.length > 0 && audioUrl) {
      try {
        if (!wavesurferRef.current.decodedData) {
          wavesurferRef.current.load(audioUrl, [effectivePeaks], duration);
        }
      } catch (_) {}
    }
  }, [effectivePeaks, audioUrl, duration]);

  // Sync seek position when paused or seeking from external components (PianoRoll, StemsMixer)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isPlaying && currentTime !== undefined && Math.abs(audio.currentTime - currentTime) > 0.25) {
      audio.currentTime = currentTime;
      if (wavesurferRef.current) {
        try {
          wavesurferRef.current.setTime(currentTime);
        } catch (_) {}
      }
    }
  }, [currentTime, isPlaying]);

  // Sync audio playback with state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      if (currentTime !== undefined && Math.abs(audio.currentTime - currentTime) > 0.2) {
        audio.currentTime = currentTime;
      }
      audio.play().catch((err) => {
        console.warn("Source audio playback notice:", err);
      });
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  // Sync volume and mute
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : Math.max(0, Math.min(1, volume));
    }
  }, [volume, muted]);

  // Sync playback speed
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  const formatTime = (secs) => {
    if (isNaN(secs) || secs < 0) return "00:00.00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const cs = Math.floor((secs % 1) * 100);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="transport-panel">
      {session && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          onLoadedMetadata={(e) => {
            if (e.target.duration && !isNaN(e.target.duration) && isFinite(e.target.duration)) {
              setDetectedDuration(e.target.duration);
            }
            if (pendingSeekRef.current !== null && isFinite(pendingSeekRef.current)) {
              try {
                e.target.currentTime = pendingSeekRef.current;
              } catch (err) {}
              pendingSeekRef.current = null;
            }
          }}
          onCanPlay={(e) => {
            if (pendingSeekRef.current !== null && isFinite(pendingSeekRef.current)) {
              try {
                e.target.currentTime = pendingSeekRef.current;
              } catch (err) {}
              pendingSeekRef.current = null;
            }
            if (isPlayingRef.current && e.target.paused) {
              e.target.play().catch((err) => console.warn("Audio resume notice:", err));
            }
          }}
          onTimeUpdate={(e) => {
            if (isLoopingRef.current && loopRegionRef.current) {
              const t = e.target.currentTime;
              const { start, end } = loopRegionRef.current;
              if (t >= end) {
                e.target.currentTime = start;
                try {
                  wavesurferRef.current?.setTime(start);
                } catch (_) {}
              }
            }
          }}
          onEnded={() => {
            if (isLooping && audioRef.current) {
              const targetStart = loopRegionRef.current ? loopRegionRef.current.start : 0;
              audioRef.current.currentTime = targetStart;
              audioRef.current.play().catch(() => {});
            } else if (onPlayPause) {
              onPlayPause(false);
            }
          }}
          loop={isLooping && !loopRegion}
        />
      )}

      <Box
        p="xs"
        style={{
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        {/* Playback Controls & Speed */}
        <Group gap="xs" align="center" wrap="wrap">
          <ActionIcon
            size={36}
            radius="xl"
            variant="filled"
            color="teal"
            onClick={() => onPlayPause && onPlayPause(!isPlaying)}
            disabled={!session}
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
            style={{
              boxShadow: isPlaying ? "0 0 12px rgba(18, 184, 134, 0.4)" : "none",
              transition: "transform 0.1s ease, box-shadow 0.2s ease",
            }}
          >
            {isPlaying ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} style={{ marginLeft: 2 }} />}
          </ActionIcon>

          <ActionIcon
            size={34}
            radius="md"
            variant="subtle"
            color="gray"
            onClick={() => {
              const returnPos = loopRegionRef.current ? loopRegionRef.current.start : 0;
              if (audioRef.current) {
                audioRef.current.currentTime = returnPos;
                if (onTimeUpdate) onTimeUpdate(returnPos);
              }
              if (wavesurferRef.current) {
                try {
                  wavesurferRef.current.setTime(returnPos);
                } catch (_) {}
              }
              if (onPlayPause) onPlayPause(false);
            }}
            disabled={!session}
            title={loopRegion ? "Stop & Return to Loop Start" : "Stop & Return to Start"}
          >
            <IconPlayerStop size={18} />
          </ActionIcon>

          <ActionIcon
            size={34}
            radius="md"
            variant={isLooping ? "filled" : "subtle"}
            color={isLooping ? "teal" : "gray"}
            onClick={() => setIsLooping(!isLooping)}
            title={
              isLooping
                ? loopRegion
                  ? "Looping Region Active (Click to disable)"
                  : "Full Track Loop Active (Click to disable)"
                : loopRegion
                ? "Enable Region Looping"
                : "Enable Full Track Looping"
            }
          >
            <IconRepeat size={17} />
          </ActionIcon>

          {/* Quick Loop In [ and Loop Out ] buttons */}
          <Group gap={2} align="center">
            <Tooltip label="Set Loop In at current position (Key: [)" position="top" withArrow>
              <ActionIcon
                size={28}
                radius="xs"
                variant={loopRegion ? "light" : "subtle"}
                color="teal"
                onClick={handleSetLoopIn}
                disabled={!session}
                title="Set Loop Start [In (Key: [)"
              >
                <Text size="xs" fw={700} style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  [In
                </Text>
              </ActionIcon>
            </Tooltip>

            <Tooltip label="Set Loop Out at current position (Key: ])" position="top" withArrow>
              <ActionIcon
                size={28}
                radius="xs"
                variant={loopRegion ? "light" : "subtle"}
                color="teal"
                onClick={handleSetLoopOut}
                disabled={!session}
                title="Set Loop End Out] (Key: ])"
              >
                <Text size="xs" fw={700} style={{ fontFamily: "var(--font-mono, monospace)" }}>
                  Out]
                </Text>
              </ActionIcon>
            </Tooltip>
          </Group>

          <SegmentedControl
            size="xs"
            radius="md"
            value={String(speed)}
            onChange={(val) => setSpeed(parseFloat(val))}
            data={[
              { label: "0.5x", value: "0.5" },
              { label: "0.75x", value: "0.75" },
              { label: "1x", value: "1" },
              { label: "1.25x", value: "1.25" },
            ]}
          />

          {/* Waveform Zoom Controls & Loop Region Badge */}
          <Group gap={4} align="center" style={{ marginLeft: 4 }}>
            <Tooltip label="Zoom Out (-)" position="top" withArrow>
              <ActionIcon
                size={28}
                radius="sm"
                variant="subtle"
                color="gray"
                onClick={() => handleZoomStep(-25)}
                disabled={!session || zoom === 0}
              >
                <IconZoomOut size={16} />
              </ActionIcon>
            </Tooltip>

            <Box style={{ width: 75 }}>
              <Slider
                size="xs"
                color="teal"
                min={0}
                max={300}
                step={10}
                value={zoom}
                onChange={handleZoomChange}
                disabled={!session}
                label={(val) => (val === 0 ? "Fit" : `${val}px/s`)}
              />
            </Box>

            <Tooltip label="Zoom In (+)" position="top" withArrow>
              <ActionIcon
                size={28}
                radius="sm"
                variant="subtle"
                color="gray"
                onClick={() => handleZoomStep(25)}
                disabled={!session || zoom >= 300}
              >
                <IconZoomIn size={16} />
              </ActionIcon>
            </Tooltip>

            <Tooltip label="Fit to Screen (Reset Zoom)" position="top" withArrow>
              <ActionIcon
                size={28}
                radius="sm"
                variant={zoom === 0 ? "light" : "subtle"}
                color={zoom === 0 ? "teal" : "gray"}
                onClick={() => handleZoomChange(0)}
                disabled={!session}
              >
                <IconZoomReset size={16} />
              </ActionIcon>
            </Tooltip>

            {loopRegion && (
              <Badge
                size="md"
                radius="sm"
                variant="light"
                color={isLooping ? "teal" : "gray"}
                style={{
                  cursor: "pointer",
                  userSelect: "none",
                  marginLeft: 4,
                  fontFamily: "var(--font-mono, monospace)",
                }}
                onClick={() => {
                  if (audioRef.current) {
                    audioRef.current.currentTime = loopRegion.start;
                    try {
                      wavesurferRef.current?.setTime(loopRegion.start);
                    } catch (_) {}
                    onTimeUpdate?.(loopRegion.start);
                  }
                }}
                title="Click to seek to loop start • Double-click region on waveform or click [✕] to remove"
                rightSection={
                  <ActionIcon
                    size={16}
                    variant="transparent"
                    color={isLooping ? "teal" : "gray"}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearLoopRegion();
                    }}
                    title="Clear loop region"
                  >
                    <IconX size={12} />
                  </ActionIcon>
                }
              >
                🔁 {formatTime(loopRegion.start)} – {formatTime(loopRegion.end)}
              </Badge>
            )}
          </Group>
        </Group>

        {/* Audio Context & Time Display */}
        <Group gap="sm" align="center" wrap="wrap">
          {session ? (
            <Group gap="xs" align="center" wrap="wrap">
              {isStemAudio ? (
                <Group gap={6} align="center">
                  <Badge
                    size="md"
                    radius="sm"
                    variant="light"
                    color="pink"
                    leftSection={<span style={{ fontSize: "14px" }}>{stemIcon}</span>}
                  >
                    {stemDisplayName} Stem
                  </Badge>
                  <Text size="xs" c="dimmed" style={{ maxWidth: 160 }} truncate>
                    ({session.filename})
                  </Text>
                </Group>
              ) : (
                <Group gap={6} align="center">
                  <Badge
                    size="md"
                    radius="sm"
                    variant="light"
                    color="teal"
                    leftSection={<IconMusic size={13} />}
                  >
                    Full Audio Mix
                  </Badge>
                  <Text size="xs" c="dimmed" style={{ maxWidth: 180 }} truncate>
                    {session.filename}
                  </Text>
                </Group>
              )}

              {/* Source Switcher Toggle */}
              {targetStem && activeTab === "pianoroll" && (
                <SegmentedControl
                  size="xs"
                  radius="md"
                  value={isStemAudio ? "stem" : "mix"}
                  onChange={(val) => {
                    if (val === "stem") {
                      if (onSelectAudioSource) onSelectAudioSource("stem");
                      else if (onSelectStem) onSelectStem(targetStem);
                    } else {
                      if (onSelectAudioSource) onSelectAudioSource("mix");
                      else if (onSelectStem) onSelectStem(null);
                    }
                  }}
                  data={[
                    { label: `${stemIcon} ${stemDisplayName || "Stem"}`, value: "stem" },
                    { label: "🎵 Full Mix", value: "mix" },
                  ]}
                />
              )}
            </Group>
          ) : (
            <Text size="xs" c="dimmed">
              No audio loaded
            </Text>
          )}

          <Paper
            px="sm"
            py={4}
            radius="sm"
            withBorder
            style={{
              background: "rgba(0, 0, 0, 0.4)",
              borderColor: "var(--border-subtle)",
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            <Text size="xs" fw={700} c="teal.4">
              {formatTime(currentTime)} / {formatTime(duration)}
            </Text>
          </Paper>
        </Group>
      </Box>

      {/* WaveSurfer.js Waveform Container with Hover, Regions, and Zoom Plugins */}
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        className="waveform-container"
        title="Click to seek • Drag across waveform to select loop • Hold Shift + Click to set loop range • Keys [ and ] for Loop In/Out"
        style={{
          position: "relative",
          cursor: "crosshair",
          minHeight: "90px",
          height: "90px",
          borderRadius: "6px",
          overflow: "hidden",
          background: "rgba(10, 16, 26, 0.65)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      />
    </div>
  );
}
