import React, { useMemo } from "react";
import {
  Card,
  SimpleGrid,
  Text,
  Badge,
  Progress,
  Group,
  Stack,
  Paper,
  Box,
  Button,
  Title,
  ThemeIcon,
} from "@mantine/core";
import {
  IconNotes,
  IconClock,
  IconFlame,
  IconWaveSine,
  IconDownload,
  IconChartBar,
} from "@tabler/icons-react";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiToNoteName(midi) {
  if (midi == null || isNaN(midi)) return "-";
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

const INSTRUMENT_META = {
  acoustic_piano: { name: "Acoustic Piano", icon: "🎹", color: "#00e676" },
  electric_piano: { name: "Electric Piano", icon: "🎹", color: "#69f0ae" },
  piano: { name: "Piano & Keys", icon: "🎹", color: "#00e676" },
  organ: { name: "Organ", icon: "⛪", color: "#1de9b6" },
  acoustic_guitar: { name: "Acoustic Guitar", icon: "🎸", color: "#ffab00" },
  clean_electric_guitar: { name: "Clean Guitar", icon: "🎸", color: "#ffd740" },
  distorted_electric_guitar: { name: "Distorted Guitar", icon: "🎸", color: "#ff9100" },
  guitar: { name: "Guitar", icon: "🎸", color: "#ffab00" },
  acoustic_bass: { name: "Acoustic Bass", icon: "🎸", color: "#b388ff" },
  electric_bass: { name: "Electric Bass", icon: "🎸", color: "#7c4dff" },
  bass: { name: "Bass", icon: "🎸", color: "#b388ff" },
  voice: { name: "Vocal Melody", icon: "🎤", color: "#00e5ff" },
  vocals: { name: "Lead Vocals", icon: "🎤", color: "#00e5ff" },
  vocal: { name: "Vocal Melody", icon: "🎤", color: "#00e5ff" },
  violin: { name: "Violin", icon: "🎻", color: "#e040fb" },
  viola: { name: "Viola", icon: "🎻", color: "#d500f9" },
  cello: { name: "Cello", icon: "🎻", color: "#aa00ff" },
  contrabass: { name: "Contrabass", icon: "🎻", color: "#651fff" },
  strings: { name: "Strings", icon: "🎻", color: "#e040fb" },
  trumpet: { name: "Trumpet", icon: "🎺", color: "#ff6e40" },
  trombone: { name: "Trombone", icon: "🎺", color: "#ff3d00" },
  drums: { name: "Drums & Percussion", icon: "🥁", color: "#ff5252" },
  percussion: { name: "Percussion", icon: "🥁", color: "#ff5252" },
  synth: { name: "Synthesizer", icon: "🎛️", color: "#00b0ff" },
  lead: { name: "Lead Synth", icon: "⚡", color: "#00e5ff" },
};

function getInstMeta(id) {
  if (!id) return { name: "Instrument", icon: "🎵", color: "#00e5ff" };
  const clean = id.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return INSTRUMENT_META[clean] || {
    name: id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, " "),
    icon: "🎵",
    color: "#00e5ff",
  };
}

export default function AnalysisView({ session }) {
  const result = session?.result;
  const duration = result?.duration_seconds || session?.duration || 0;
  const events = useMemo(() => {
    return (result?.events || []).filter((e) => e.type === "note" && e.values?.pitch != null);
  }, [result]);

  const analysis = useMemo(() => {
    if (events.length === 0) return null;

    let minPitch = 127;
    let maxPitch = 0;
    let totalVel = 0;
    let totalDur = 0;

    const pitchClassCounts = new Array(12).fill(0);
    const instMap = {};

    events.forEach((ev) => {
      const p = ev.values.pitch;
      const d = ev.values.duration || 0.1;
      const v = ev.values.velocity || 80;
      const track = ev.track || "all";

      if (p < minPitch) minPitch = p;
      if (p > maxPitch) maxPitch = p;
      totalVel += v;
      totalDur += d;

      pitchClassCounts[((p % 12) + 12) % 12]++;

      if (!instMap[track]) {
        instMap[track] = {
          id: track,
          count: 0,
          minP: p,
          maxP: p,
          totalV: 0,
          totalD: 0,
        };
      }
      instMap[track].count++;
      instMap[track].totalV += v;
      instMap[track].totalD += d;
      if (p < instMap[track].minP) instMap[track].minP = p;
      if (p > instMap[track].maxP) instMap[track].maxP = p;
    });

    const maxPitchCount = Math.max(1, ...pitchClassCounts);
    const sortedPitchClasses = pitchClassCounts
      .map((count, idx) => ({ name: NOTE_NAMES[idx], count, idx }))
      .sort((a, b) => b.count - a.count);

    const instList = Object.values(instMap).map((item) => ({
      ...item,
      meta: getInstMeta(item.id),
      avgVel: Math.round(item.totalV / item.count),
      avgDur: (item.totalD / item.count).toFixed(2),
      pct: ((item.count / events.length) * 100).toFixed(1),
    })).sort((a, b) => b.count - a.count);

    const numBuckets = 24;
    const bucketDur = duration > 0 ? duration / numBuckets : 1;
    const activityBuckets = new Array(numBuckets).fill(0);
    events.forEach((ev) => {
      const idx = Math.min(numBuckets - 1, Math.max(0, Math.floor(ev.time / bucketDur)));
      activityBuckets[idx]++;
    });
    const maxBucketCount = Math.max(1, ...activityBuckets);

    return {
      totalNotes: events.length,
      minPitch,
      maxPitch,
      avgVelocity: Math.round(totalVel / events.length),
      avgDuration: (totalDur / events.length).toFixed(2),
      notesPerSecond: duration > 0 ? (events.length / duration).toFixed(1) : "0",
      pitchClassCounts,
      maxPitchCount,
      sortedPitchClasses,
      instList,
      activityBuckets,
      maxBucketCount,
      bucketDur,
    };
  }, [events, duration]);

  if (!result || events.length === 0) {
    return (
      <Box p="xl" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Paper
          p="xl"
          radius="md"
          withBorder
          style={{
            maxWidth: 500,
            textAlign: "center",
            background: "var(--bg-card)",
          }}
        >
          <ThemeIcon size={56} radius="xl" variant="light" color="cyan" mb="md" mx="auto">
            <IconChartBar size={32} />
          </ThemeIcon>
          <Title order={3} mb="xs">
            No Transcription Analytics Available
          </Title>
          <Text size="sm" c="dimmed" lh={1.6}>
            Run transcription using the <strong>MuScriptor Medium</strong> engine from the top navigation bar or
            transcribe individual stems from the <strong>Stems Mixer</strong> to generate note distributions, harmonic
            keys, and performance metrics.
          </Text>
        </Paper>
      </Box>
    );
  }

  const {
    totalNotes,
    minPitch,
    maxPitch,
    notesPerSecond,
    pitchClassCounts,
    maxPitchCount,
    sortedPitchClasses,
    instList,
    activityBuckets,
    maxBucketCount,
  } = analysis;

  const bpmText = result.detected_bpm ? `${result.detected_bpm} BPM` : "120 BPM (Default)";
  const sessionId = session.session_id;
  const midiFilename = result.midi_file || "transcription.mid";

  return (
    <Box
      p="lg"
      style={{
        flex: 1,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        maxWidth: 1400,
        margin: "0 auto",
        width: "100%",
      }}
    >
      {/* 1. TOP METRICS KPI CARDS */}
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 5 }} spacing="md">
        <Card p="md" radius="md" withBorder style={{ background: "var(--bg-card)" }}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">
              Transcribed Notes
            </Text>
            <ThemeIcon size={28} radius="md" variant="light" color="cyan">
              <IconNotes size={16} />
            </ThemeIcon>
          </Group>
          <Text size="xl" fw={800} c="cyan.4">
            {totalNotes.toLocaleString()}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            Density: {notesPerSecond} notes/sec
          </Text>
        </Card>

        <Card p="md" radius="md" withBorder style={{ background: "var(--bg-card)" }}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">
              Estimated Tempo
            </Text>
            <ThemeIcon size={28} radius="md" variant="light" color="teal">
              <IconClock size={16} />
            </ThemeIcon>
          </Group>
          <Text size="xl" fw={800} c="teal.4">
            {bpmText}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            {result.beats_per_bar ? `${result.beats_per_bar}/4 meter` : "Standard 4/4 meter"}
          </Text>
        </Card>

        <Card p="md" radius="md" withBorder style={{ background: "var(--bg-card)" }}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">
              Active Instruments
            </Text>
            <ThemeIcon size={28} radius="md" variant="light" color="grape">
              <IconFlame size={16} />
            </ThemeIcon>
          </Group>
          <Text size="xl" fw={800} c="grape.4">
            {instList.length}
          </Text>
          <Text size="xs" c="dimmed" mt={4} truncate>
            {instList.map((i) => i.meta.name).slice(0, 3).join(", ")}
            {instList.length > 3 && ` +${instList.length - 3}`}
          </Text>
        </Card>

        <Card p="md" radius="md" withBorder style={{ background: "var(--bg-card)" }}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">
              Pitch Range
            </Text>
            <ThemeIcon size={28} radius="md" variant="light" color="teal">
              <IconWaveSine size={16} />
            </ThemeIcon>
          </Group>
          <Text size="xl" fw={800} c="teal.4">
            {midiToNoteName(minPitch)} → {midiToNoteName(maxPitch)}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            Span: {maxPitch - minPitch + 1} semitones
          </Text>
        </Card>

        <Card p="md" radius="md" withBorder style={{ background: "var(--bg-card)" }}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">
              Target Stem
            </Text>
            <Badge size="xs" variant="light" color="cyan">
              PyTorch
            </Badge>
          </Group>
          <Text size="md" fw={700} truncate>
            {result.target_stem ? `Stem: ${result.target_stem.toUpperCase()}` : "Full Source Mix"}
          </Text>
          <Button
            component="a"
            href={`/api/audio/${sessionId}/${encodeURIComponent(midiFilename)}`}
            download={`${sessionId}.mid`}
            size="xs"
            radius="md"
            variant="light"
            color="cyan"
            leftSection={<IconDownload size={14} />}
            mt="xs"
            fullWidth
          >
            Download MIDI
          </Button>
        </Card>
      </SimpleGrid>

      {/* 2. ACTIVITY TIMELINE & NOTE DENSITY */}
      <Card p="lg" radius="md" withBorder style={{ background: "var(--bg-card)" }}>
        <Group justify="space-between" align="center" mb="md">
          <Box>
            <Text size="sm" fw={700}>
              Note Density & Energy Profile Over Time
            </Text>
            <Text size="xs" c="dimmed">
              Temporal distribution of transcribed note onsets across track timeline
            </Text>
          </Box>
          <Badge size="sm" variant="light" color="cyan" style={{ fontFamily: "var(--font-mono, monospace)" }}>
            Duration: {duration.toFixed(1)}s
          </Badge>
        </Group>

        <Group gap={4} align="flex-end" style={{ height: 75, padding: "4px 0" }}>
          {activityBuckets.map((count, idx) => {
            const heightPct = Math.max(8, (count / maxBucketCount) * 100);
            return (
              <Box
                key={idx}
                style={{
                  flex: 1,
                  height: `${heightPct}%`,
                  background: count > 0 ? "linear-gradient(180deg, #00e5ff 0%, #007799 100%)" : "rgba(255, 255, 255, 0.05)",
                  borderRadius: "2px",
                  transition: "opacity 0.15s ease",
                  cursor: "pointer",
                }}
                title={`Section ${idx + 1}: ${count} notes`}
              />
            );
          })}
        </Group>
        <Group justify="space-between" mt="xs">
          <Text size="10px" c="dimmed">0.0s</Text>
          <Text size="10px" c="dimmed">{(duration * 0.5).toFixed(1)}s</Text>
          <Text size="10px" c="dimmed">{duration.toFixed(1)}s</Text>
        </Group>
      </Card>

      {/* 3. PITCH CLASS PROFILE & INSTRUMENT BREAKDOWN */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        {/* Instrument Track Breakdown */}
        <Card p="lg" radius="md" withBorder style={{ background: "var(--bg-card)" }}>
          <Text size="sm" fw={700} mb="md">
            Instrument Track Breakdown
          </Text>
          <Stack gap="xs">
            {instList.map((inst) => (
              <Paper
                key={inst.id}
                p="sm"
                radius="sm"
                withBorder
                style={{ background: "var(--bg-surface)" }}
              >
                <Group justify="space-between" align="center" wrap="nowrap" gap="md">
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 150 }}>
                    <span style={{ fontSize: "20px" }}>{inst.meta.icon}</span>
                    <Box>
                      <Text size="xs" fw={700} style={{ color: inst.meta.color }}>
                        {inst.meta.name}
                      </Text>
                      <Text size="10px" c="dimmed">
                        Range: {midiToNoteName(inst.minP)} – {midiToNoteName(inst.maxP)}
                      </Text>
                    </Box>
                  </Group>

                  <Box style={{ flex: 1, maxWidth: 220 }}>
                    <Progress
                      value={parseFloat(inst.pct)}
                      size="sm"
                      radius="xl"
                      color={inst.meta.color}
                    />
                    <Text size="10px" c="dimmed" ta="right" mt={2}>
                      {inst.pct}% of notes
                    </Text>
                  </Box>

                  <Box ta="right" style={{ minWidth: 70 }}>
                    <Text size="xs" fw={700}>
                      {inst.count} notes
                    </Text>
                    <Text size="10px" c="dimmed">
                      Vel: {inst.avgVel}
                    </Text>
                  </Box>
                </Group>
              </Paper>
            ))}
          </Stack>
        </Card>

        {/* 12-Tone Chromatic Profile */}
        <Card p="lg" radius="md" withBorder style={{ background: "var(--bg-card)" }}>
          <Group justify="space-between" align="center" mb="md">
            <Box>
              <Text size="sm" fw={700}>
                12-Tone Chromatic Profile
              </Text>
              <Text size="xs" c="dimmed">
                Pitch class distribution & harmonic root strength
              </Text>
            </Box>
            {sortedPitchClasses[0] && (
              <Badge size="sm" variant="light" color="teal">
                Top Root: {sortedPitchClasses[0].name}
              </Badge>
            )}
          </Group>

          <SimpleGrid cols={6} spacing="xs">
            {NOTE_NAMES.map((name, idx) => {
              const count = pitchClassCounts[idx];
              const pct = maxPitchCount > 0 ? (count / maxPitchCount) * 100 : 0;
              const isTop = sortedPitchClasses[0]?.name === name;

              return (
                <Paper
                  key={name}
                  p="xs"
                  radius="sm"
                  withBorder
                  style={{
                    textAlign: "center",
                    background: isTop ? "rgba(0, 230, 118, 0.08)" : "var(--bg-surface)",
                    borderColor: isTop ? "var(--mantine-color-teal-6)" : "var(--border-subtle)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Text size="xs" fw={700} c={isTop ? "teal.4" : "white"}>
                    {name}
                  </Text>
                  <Box style={{ width: "100%", height: 38, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                    <Box
                      style={{
                        width: 14,
                        height: `${Math.max(4, pct)}%`,
                        background: isTop ? "var(--mantine-color-teal-5)" : "var(--mantine-color-cyan-6)",
                        borderRadius: "2px",
                      }}
                    />
                  </Box>
                  <Text size="10px" c="dimmed">
                    {count}
                  </Text>
                </Paper>
              );
            })}
          </SimpleGrid>
        </Card>
      </SimpleGrid>
    </Box>
  );
}
