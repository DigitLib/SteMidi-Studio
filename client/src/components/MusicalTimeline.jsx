import React, { useMemo } from "react";

const INSTRUMENT_COLORS = {
  piano: "#00e676",
  acoustic_piano: "#00e676",
  electric_piano: "#69f0ae",
  bass: "#b388ff",
  acoustic_bass: "#b388ff",
  electric_bass: "#7c4dff",
  drums: "#ff5252",
  percussion: "#ff5252",
  guitar: "#ffab00",
  acoustic_guitar: "#ffab00",
  clean_electric_guitar: "#ffd740",
  distorted_electric_guitar: "#ff9100",
  vocals: "#00e5ff",
  vocal: "#00e5ff",
  voice: "#00e5ff",
  strings: "#e040fb",
  violin: "#e040fb",
  cello: "#aa00ff",
  synth: "#00b0ff",
  lead: "#00e5ff",
  horns: "#ff6e40",
  brass: "#ff6e40",
};

const INSTRUMENT_ICONS = {
  piano: "🎹",
  acoustic_piano: "🎹",
  electric_piano: "🎹",
  bass: "🎸",
  acoustic_bass: "🎸",
  electric_bass: "🎸",
  drums: "🥁",
  percussion: "🥁",
  guitar: "🎸",
  acoustic_guitar: "🎸",
  clean_electric_guitar: "🎸",
  distorted_electric_guitar: "🎸",
  vocals: "🎤",
  vocal: "🎤",
  voice: "🎤",
  strings: "🎻",
  violin: "🎻",
  cello: "🎻",
  synth: "🎛️",
  lead: "⚡",
  horns: "🎺",
  brass: "🎺",
};

function getInstStyle(trackId) {
  const clean = (trackId || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  return {
    color: INSTRUMENT_COLORS[clean] || "#00e5ff",
    icon: INSTRUMENT_ICONS[clean] || "🎵",
    label: clean.replace(/_/g, " ").toUpperCase() || "TRACK",
  };
}

export default function MusicalTimeline({ session, currentTime = 0, onSeek }) {
  const result = session?.result;
  const duration = result?.duration_seconds || session?.duration || 0;
  const events = result?.events || [];
  const bpm = result?.detected_bpm && result.detected_bpm > 20 ? result.detected_bpm : 120;
  const beatsPerBar = result?.beats_per_bar || 4;

  // Don't render if there's no session or audio loaded
  if (!duration || duration <= 0) {
    return null;
  }

  // 1. Calculate Measures & Grid
  const secondsPerBeat = 60 / bpm;
  const secondsPerBar = secondsPerBeat * beatsPerBar;
  const totalBars = Math.max(1, Math.ceil(duration / secondsPerBar));

  // Determine measure labeling step based on total bars
  let barStep = 1;
  if (totalBars > 64) barStep = 8;
  else if (totalBars > 32) barStep = 4;
  else if (totalBars > 16) barStep = 2;

  const barMarkers = [];
  for (let b = 1; b <= totalBars; b += barStep) {
    const time = (b - 1) * secondsPerBar;
    if (time <= duration) {
      barMarkers.push({
        barNum: b,
        time,
        pct: (time / duration) * 100,
      });
    }
  }

  // 2. Compute Instrument Activity Lanes from Note Events
  const instrumentLanes = useMemo(() => {
    if (!events || events.length === 0) return [];

    const tracks = {};
    events.forEach((ev) => {
      if (ev.type !== "note") return;
      const t = ev.track || "all";
      if (!tracks[t]) tracks[t] = [];
      tracks[t].push({
        start: ev.time,
        end: ev.time + (ev.values?.duration || 0.2),
      });
    });

    const lanes = [];
    Object.keys(tracks).forEach((trackId) => {
      const noteList = tracks[trackId].sort((a, b) => a.start - b.start);
      // Merge overlapping or closely adjacent notes (within 1.2s) into continuous activity blocks
      const merged = [];
      let current = null;

      noteList.forEach((n) => {
        if (!current) {
          current = { start: n.start, end: n.end, count: 1 };
        } else if (n.start <= current.end + 1.2) {
          current.end = Math.max(current.end, n.end);
          current.count++;
        } else {
          merged.push(current);
          current = { start: n.start, end: n.end, count: 1 };
        }
      });
      if (current) merged.push(current);

      lanes.push({
        id: trackId,
        info: getInstStyle(trackId),
        blocks: merged,
        totalNotes: noteList.length,
      });
    });

    // Sort lanes: drums/bass first, then keys/guitars, then vocals/leads
    return lanes.sort((a, b) => b.totalNotes - a.totalNotes);
  }, [events]);

  const handleTimelineClick = (e) => {
    if (!onSeek || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    onSeek(ratio * duration);
  };

  const playheadPct = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  return (
    <div
      className="timeline-tracks"
      style={{
        userSelect: "none",
        position: "relative",
        background: "rgba(10, 14, 22, 0.95)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "8px",
        padding: "8px 12px",
        marginTop: "8px",
      }}
    >
      {/* Synchronized Playhead Line */}
      <div
        style={{
          position: "absolute",
          top: "8px",
          bottom: "8px",
          left: `calc(75px + (100% - 87px) * ${playheadPct / 100})`,
          width: "2px",
          background: "#00e5ff",
          boxShadow: "0 0 8px #00e5ff",
          pointerEvents: "none",
          zIndex: 10,
        }}
      />

      {/* 1. Musical Measure Ruler */}
      <div
        className="timeline-row"
        style={{
          height: "22px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          marginBottom: "4px",
          cursor: onSeek ? "pointer" : "default",
        }}
        onClick={handleTimelineClick}
        title="Click to seek transport"
      >
        <div className="timeline-label" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span>⏱️</span>
          <span style={{ color: "var(--accent-cyan)", fontSize: "9.5px" }}>{bpm} BPM</span>
        </div>

        <div className="timeline-items" style={{ position: "relative" }}>
          {barMarkers.map((b) => (
            <div
              key={b.barNum}
              style={{
                position: "absolute",
                left: `${b.pct}%`,
                top: 0,
                bottom: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                pointerEvents: "none",
              }}
            >
              <div style={{ height: "6px", width: "1px", background: "rgba(255, 255, 255, 0.3)" }} />
              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 700,
                  fontFamily: "monospace",
                  color: "var(--text-muted)",
                  transform: "translateX(-2px)",
                  marginTop: "1px",
                }}
              >
                m.{b.barNum}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Multi-Track Instrument Activity Lanes */}
      {instrumentLanes.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          {instrumentLanes.map((lane) => (
            <div
              key={lane.id}
              className="timeline-row"
              style={{ height: "16px", cursor: onSeek ? "pointer" : "default" }}
              onClick={handleTimelineClick}
            >
              <div
                className="timeline-label"
                style={{
                  fontSize: "9px",
                  color: lane.info.color,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
                title={`${lane.totalNotes} notes transcribed for ${lane.info.label}`}
              >
                <span>{lane.info.icon}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {lane.info.label}
                </span>
              </div>

              <div className="timeline-items" style={{ background: "rgba(255, 255, 255, 0.02)", borderRadius: "3px" }}>
                {lane.blocks.map((block, idx) => {
                  const left = (block.start / duration) * 100;
                  const width = Math.max(0.6, ((block.end - block.start) / duration) * 100);

                  return (
                    <div
                      key={idx}
                      className="timeline-block"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: lane.info.color,
                        opacity: 0.85,
                        borderRadius: "2px",
                      }}
                      title={`${lane.info.label}: ${block.count} notes (${block.start.toFixed(1)}s - ${block.end.toFixed(1)}s)`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            height: "18px",
            display: "flex",
            alignItems: "center",
            paddingLeft: "75px",
            fontSize: "10px",
            color: "var(--text-muted)",
          }}
        >
          No instrument note lanes yet. Transcribe audio to visualize arrangement.
        </div>
      )}
    </div>
  );
}
