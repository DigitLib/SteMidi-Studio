/**
 * Zero-dependency Standard MIDI File (SMF Type 1) Serializer for SteMidi Studio.
 * Allows users to export tightened, quantized note events directly to standard .mid files.
 */

function writeVLQ(value) {
  let val = Math.max(0, Math.round(value));
  const bytes = [];
  bytes.push(val & 0x7f);
  val >>= 7;
  while (val > 0) {
    bytes.unshift((val & 0x7f) | 0x80);
    val >>= 7;
  }
  return bytes;
}

function writeString(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i) & 0xff);
  }
  return bytes;
}

function writeUint16(val) {
  return [(val >> 8) & 0xff, val & 0xff];
}

function writeUint32(val) {
  return [
    (val >> 24) & 0xff,
    (val >> 16) & 0xff,
    (val >> 8) & 0xff,
    val & 0xff,
  ];
}

// GM Instrument mapping fallback
const INSTRUMENT_PROGRAM_MAP = {
  acoustic_piano: 0,
  electric_piano: 4,
  organ: 16,
  acoustic_guitar: 24,
  clean_electric_guitar: 27,
  distorted_electric_guitar: 29,
  guitar: 24,
  acoustic_bass: 32,
  electric_bass: 33,
  bass: 33,
  violin: 40,
  viola: 41,
  cello: 42,
  contrabass: 43,
  orchestral_harp: 46,
  strings: 48,
  string_ensemble: 48,
  trumpet: 56,
  trombone: 57,
  tuba: 58,
  french_horn: 60,
  brass_section: 61,
  soprano_and_alto_sax: 65,
  tenor_sax: 66,
  baritone_sax: 67,
  oboe: 68,
  english_horn: 69,
  bassoon: 70,
  clarinet: 71,
  flutes: 73,
  synth_lead: 80,
  synth_pad: 88,
  voice: 54,
  vocals: 54,
};

export function exportNotesToMidiBlob(notes, { bpm = 120, timeSignature = [4, 4] } = {}) {
  const ppq = 480; // Standard ticks per quarter note
  const safeBpm = Math.max(20, Math.min(300, Number(bpm) || 120));
  const secondsPerTick = 60.0 / (safeBpm * ppq);
  const microsecondsPerQuarter = Math.round(60000000 / safeBpm);

  // Group notes by track / instrument, consolidating sub-stems of the same family
  const totalNotesCount = (notes || []).length;
  const rawTracksMap = new Map();
  (notes || []).forEach((n) => {
    let trackKey = n.track || "piano";
    const cleanKey = trackKey.toLowerCase().replace(/[\s-]/g, "_");

    // Consolidate sub-instruments of the same family into a single clean score staff
    if (cleanKey.includes("sax")) {
      trackKey = "Alto Saxophone";
    } else if (cleanKey.includes("guitar")) {
      trackKey = cleanKey.includes("bass") ? "Bass Guitar" : "Guitar";
    }

    if (!rawTracksMap.has(trackKey)) {
      rawTracksMap.set(trackKey, []);
    }
    rawTracksMap.get(trackKey).push(n);
  });

  // Find the primary track with the most notes
  let primaryTrack = "piano";
  let maxNotes = 0;
  for (const [k, arr] of rawTracksMap.entries()) {
    if (arr.length > maxNotes) {
      maxNotes = arr.length;
      primaryTrack = k;
    }
  }

  // Merge minor ghost tracks (< 5% of notes) into the primary track to avoid empty staves in score editors
  const tracksMap = new Map();
  for (const [k, arr] of rawTracksMap.entries()) {
    if (k === primaryTrack || arr.length >= Math.max(8, totalNotesCount * 0.05)) {
      tracksMap.set(k, arr);
    } else {
      if (!tracksMap.has(primaryTrack)) tracksMap.set(primaryTrack, []);
      tracksMap.get(primaryTrack).push(...arr);
    }
  }

  if (tracksMap.size === 0) {
    tracksMap.set("piano", []);
  }

  const trackEntries = Array.from(tracksMap.entries());
  const numTracks = trackEntries.length + 1; // 1 conductor track + N instrument tracks

  // --- Track 0: Conductor Track (Tempo & Time Signature) ---
  const conductorEvents = [];
  // Time signature: delta 0, FF 58 04 nn dd cc bb
  conductorEvents.push(...writeVLQ(0));
  conductorEvents.push(0xff, 0x58, 0x04, timeSignature[0] || 4, Math.log2(timeSignature[1] || 4) || 2, 24, 8);

  // Set Tempo: delta 0, FF 51 03 tttttt
  conductorEvents.push(...writeVLQ(0));
  conductorEvents.push(
    0xff,
    0x51,
    0x03,
    (microsecondsPerQuarter >> 16) & 0xff,
    (microsecondsPerQuarter >> 8) & 0xff,
    microsecondsPerQuarter & 0xff
  );

  // End of Track: delta 0, FF 2F 00
  conductorEvents.push(...writeVLQ(0), 0xff, 0x2f, 0x00);

  const tracksBytes = [];
  // Build Conductor Track Chunk
  tracksBytes.push(...writeString("MTrk"), ...writeUint32(conductorEvents.length), ...conductorEvents);

  // --- Instrument Tracks ---
  trackEntries.forEach(([trackName, trackNotes], idx) => {
    const channel = (idx % 15) === 9 ? 10 : (idx % 15); // avoid drum channel 9 for melodic instruments
    const program = INSTRUMENT_PROGRAM_MAP[trackName.toLowerCase().replace(/[\s-]/g, "_")] ?? 0;

    // Convert notes into on/off events sorted by tick
    const midiEvents = [];
    trackNotes.forEach((n) => {
      const startTick = Math.max(0, Math.round(n.start / secondsPerTick));
      const endTick = Math.max(startTick + 1, Math.round(n.end / secondsPerTick));
      const pitch = Math.max(0, Math.min(127, Math.round(n.pitch)));
      const vel = Math.max(1, Math.min(127, Math.round(n.velocity || 90)));

      midiEvents.push({ tick: startTick, type: "on", pitch, vel });
      midiEvents.push({ tick: endTick, type: "off", pitch, vel: 0 });
    });

    // Sort: earlier tick first; if same tick, note off before note on
    midiEvents.sort((a, b) => {
      if (a.tick !== b.tick) return a.tick - b.tick;
      if (a.type !== b.type) return a.type === "off" ? -1 : 1;
      return a.pitch - b.pitch;
    });

    const trackBytes = [];

    // Track Name: delta 0, FF 03 len name
    const nameBytes = writeString(trackName.replace(/_/g, " "));
    trackBytes.push(...writeVLQ(0), 0xff, 0x03, ...writeVLQ(nameBytes.length), ...nameBytes);

    // Program Change: delta 0, Cn program
    trackBytes.push(...writeVLQ(0), 0xc0 | (channel & 0x0f), program & 0x7f);

    // Note events with delta times
    let lastTick = 0;
    midiEvents.forEach((ev) => {
      const delta = Math.max(0, ev.tick - lastTick);
      lastTick = ev.tick;

      trackBytes.push(...writeVLQ(delta));
      if (ev.type === "on") {
        trackBytes.push(0x90 | (channel & 0x0f), ev.pitch & 0x7f, ev.vel & 0x7f);
      } else {
        trackBytes.push(0x80 | (channel & 0x0f), ev.pitch & 0x7f, 0x00);
      }
    });

    // End of track: delta 0, FF 2F 00
    trackBytes.push(...writeVLQ(0), 0xff, 0x2f, 0x00);

    tracksBytes.push(...writeString("MTrk"), ...writeUint32(trackBytes.length), ...trackBytes);
  });

  // --- Header Chunk MThd ---
  const header = [
    ...writeString("MThd"),
    ...writeUint32(6),
    ...writeUint16(1), // SMF Type 1 (Multi-track synchronous)
    ...writeUint16(numTracks),
    ...writeUint16(ppq),
  ];

  const fullMidi = new Uint8Array([...header, ...tracksBytes]);
  return new Blob([fullMidi], { type: "audio/midi" });
}

export function downloadTightenedMidi(notes, options = {}) {
  const filename = options.filename || "transcription_tightened.mid";
  const blob = exportNotesToMidiBlob(notes, options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
