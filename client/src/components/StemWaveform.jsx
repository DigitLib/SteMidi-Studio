import React, { useEffect, useRef, useState, useCallback } from "react";

function getRgbaColor(color, alpha = 1) {
  if (!color) return `rgba(0, 229, 255, ${alpha})`;
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16) || 0;
      const g = parseInt(hex.slice(2, 4), 16) || 0;
      const b = parseInt(hex.slice(4, 6), 16) || 0;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  if (color.startsWith("rgb")) {
    return color.replace(/rgba?\(([^)]+)\)/, (m, vals) => {
      const parts = vals.split(",").map((s) => s.trim());
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
    });
  }
  return color;
}

export default function StemWaveform({
  peaks = [],
  currentTime = 0,
  duration = 1,
  accentColor = "#12b886",
  isMuted = false,
  height = 48,
  onSeek = null,
}) {
  const bgCanvasRef = useRef(null);
  const fgCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const [hoverX, setHoverX] = useState(null);
  const [hoverTime, setHoverTime] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const effectiveDuration = duration > 0 ? duration : 1;

  const formatTime = (secs) => {
    if (isNaN(secs) || secs < 0) return "00:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const cs = Math.floor((secs % 1) * 10);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs}`;
  };

  const playedColor = getRgbaColor(accentColor, 1.0);
  const unplayedColor = getRgbaColor(accentColor, 0.28);
  const mutedPlayedColor = "rgba(160, 175, 195, 0.4)";
  const mutedUnplayedColor = "rgba(80, 95, 120, 0.2)";

  // Draw static waveform bars once onto both background (unplayed) and foreground (played) canvases
  const drawStaticWaveforms = useCallback(() => {
    const bgCanvas = bgCanvasRef.current;
    const fgCanvas = fgCanvasRef.current;
    const container = containerRef.current;
    if (!bgCanvas || !fgCanvas || !container) return;

    const bgCtx = bgCanvas.getContext("2d");
    const fgCtx = fgCanvas.getContext("2d");
    if (!bgCtx || !fgCtx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const width = Math.floor(rect.width || container.clientWidth || bgCanvas.clientWidth || 800);
    const h = height;

    if (width <= 0) return;

    const targetW = Math.round(width * dpr);
    const targetH = Math.round(h * dpr);

    if (bgCanvas.width !== targetW || bgCanvas.height !== targetH) {
      bgCanvas.width = targetW;
      bgCanvas.height = targetH;
    }
    if (fgCanvas.width !== targetW || fgCanvas.height !== targetH) {
      fgCanvas.width = targetW;
      fgCanvas.height = targetH;
    }

    bgCtx.save();
    fgCtx.save();
    bgCtx.scale(dpr, dpr);
    fgCtx.scale(dpr, dpr);
    bgCtx.clearRect(0, 0, width, h);
    fgCtx.clearRect(0, 0, width, h);

    if (!peaks || peaks.length === 0) {
      // Idle baseline
      const strokeCol = isMuted ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.15)";
      bgCtx.strokeStyle = strokeCol;
      bgCtx.lineWidth = 1.5;
      bgCtx.beginPath();
      bgCtx.moveTo(0, h / 2);
      bgCtx.lineTo(width, h / 2);
      bgCtx.stroke();

      fgCtx.strokeStyle = isMuted ? mutedPlayedColor : playedColor;
      fgCtx.lineWidth = 1.5;
      fgCtx.beginPath();
      fgCtx.moveTo(0, h / 2);
      fgCtx.lineTo(width, h / 2);
      fgCtx.stroke();

      bgCtx.restore();
      fgCtx.restore();
      return;
    }

    // Discretize waveform into crisp, evenly-spaced bars (1 bar every 3.2px)
    const barSpacing = 3.2;
    const numBars = Math.min(peaks.length, Math.max(30, Math.floor(width / barSpacing)));
    const barWidth = Math.max(1.8, (width / numBars) - 1.2);
    const bucketSize = peaks.length / numBars;
    const midY = h / 2;

    const currentUnplayedFill = isMuted ? mutedUnplayedColor : unplayedColor;
    const currentPlayedFill = isMuted ? mutedPlayedColor : playedColor;

    bgCtx.fillStyle = currentUnplayedFill;
    fgCtx.fillStyle = currentPlayedFill;

    for (let i = 0; i < numBars; i++) {
      const x = i * (width / numBars);

      // Aggregate peak amplitude within this bucket
      const startIdx = Math.floor(i * bucketSize);
      const endIdx = Math.min(peaks.length, Math.floor((i + 1) * bucketSize));
      let peak = 0;
      for (let j = startIdx; j < endIdx; j++) {
        if (peaks[j] > peak) peak = peaks[j];
      }
      if (peak === 0 && startIdx < peaks.length) peak = peaks[startIdx] || 0.05;

      const barHeight = Math.max(2.5, peak * (h * 0.88));
      const topY = midY - barHeight / 2;
      const rx = Math.round(x);
      const ry = Math.round(topY);
      const rw = Math.max(1, Math.round(barWidth));
      const rh = Math.round(barHeight);

      bgCtx.fillRect(rx, ry, rw, rh);
      fgCtx.fillRect(rx, ry, rw, rh);
    }

    bgCtx.restore();
    fgCtx.restore();
  }, [peaks, accentColor, isMuted, height, playedColor, unplayedColor, mutedPlayedColor, mutedUnplayedColor]);

  // Redraw static canvases only when container resizes or waveform data changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let animId;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          animId = requestAnimationFrame(() => drawStaticWaveforms());
        }
      }
    });

    ro.observe(el);
    animId = requestAnimationFrame(() => drawStaticWaveforms());

    return () => {
      ro.disconnect();
      if (animId) cancelAnimationFrame(animId);
    };
  }, [drawStaticWaveforms]);

  const handlePointerDown = (e) => {
    if (!onSeek) return;
    setIsDragging(true);
    seekFromEvent(e);
  };

  const handlePointerMove = (e) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = x / rect.width;
    setHoverX(x);
    setHoverTime(ratio * effectiveDuration);

    if (isDragging && onSeek) {
      onSeek(ratio * effectiveDuration);
    }
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  const handlePointerLeave = () => {
    setHoverX(null);
    setHoverTime(null);
    setIsDragging(false);
  };

  const seekFromEvent = (e) => {
    const container = containerRef.current;
    if (!container || !onSeek) return;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = x / rect.width;
    onSeek(ratio * effectiveDuration);
  };

  const progressRatio = Math.min(1, Math.max(0, currentTime / effectiveDuration));
  const progressPercent = progressRatio * 100;
  const clipInsetRight = Math.max(0, Math.min(100, 100 - progressPercent));

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: `${height}px`,
        cursor: onSeek ? "pointer" : "default",
        userSelect: "none",
        background: "rgba(10, 16, 26, 0.65)",
        borderRadius: "6px",
        overflow: "hidden",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        transition: "border-color 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (e.currentTarget) e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.25)";
      }}
      onMouseLeave={(e) => {
        if (e.currentTarget) e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.06)";
        handlePointerLeave();
      }}
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
    >
      {/* Layer 1: Static background canvas (unplayed waveform bars) */}
      <canvas
        ref={bgCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
        }}
      />

      {/* Layer 2: Static foreground canvas (played waveform bars), clipped by CSS - 0 GPU canvas redraws! */}
      <canvas
        ref={fgCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
          clipPath: `inset(0 ${clipInsetRight}% 0 0)`,
        }}
      />

      {/* Layer 3: Playhead Needle Line (CSS compositor layer) */}
      {progressPercent > 0 && progressPercent < 100 && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${progressPercent}%`,
            width: "1.5px",
            background: "#ffffff",
            pointerEvents: "none",
            zIndex: 5,
            transform: "translateX(-50%)",
          }}
        >
          {/* Top indicator dot */}
          <div
            style={{
              position: "absolute",
              top: "1px",
              left: "-2px",
              width: "5px",
              height: "5px",
              borderRadius: "50%",
              background: isMuted ? mutedPlayedColor : playedColor,
            }}
          />
        </div>
      )}

      {/* Layer 4: Hover guide line */}
      {hoverX !== null && hoverX >= 0 && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${hoverX}px`,
            width: "1px",
            borderLeft: "1px dashed rgba(255, 255, 255, 0.4)",
            pointerEvents: "none",
            zIndex: 6,
          }}
        />
      )}

      {/* Hover timestamp tooltip */}
      {hoverX !== null && hoverTime !== null && (
        <div
          style={{
            position: "absolute",
            top: "2px",
            left: `${Math.min(hoverX + 6, (containerRef.current?.clientWidth || 300) - 52)}px`,
            background: "rgba(13, 21, 37, 0.92)",
            color: "#ffffff",
            padding: "2px 5px",
            borderRadius: "4px",
            fontSize: "10px",
            fontFamily: "monospace",
            fontWeight: 600,
            border: `1px solid ${getRgbaColor(accentColor, 0.5)}`,
            pointerEvents: "none",
            zIndex: 10,
            boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
          }}
        >
          {formatTime(hoverTime)}
        </div>
      )}
    </div>
  );
}
