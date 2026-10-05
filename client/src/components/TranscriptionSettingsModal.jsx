import React, { useState } from "react";
import {
  Modal,
  Card,
  Group,
  Stack,
  Text,
  Badge,
  Button,
  TextInput,
  Select,
  Switch,
  NumberInput,
  ThemeIcon,
  SegmentedControl,
  SimpleGrid,
  ScrollArea,
  Divider,
  Box,
} from "@mantine/core";
import {
  IconSettings,
  IconCpu,
  IconMusic,
  IconSearch,
  IconCheck,
  IconSparkles,
} from "@tabler/icons-react";

export const MT3_INSTRUMENT_CATEGORIES = [
  {
    name: "Keyboards & Pianos",
    icon: "🎹",
    items: [
      { id: "acoustic_piano", name: "Acoustic Piano" },
      { id: "electric_piano", name: "Electric Piano" },
      { id: "organ", name: "Organ" },
    ],
  },
  {
    name: "Guitars",
    icon: "🎸",
    items: [
      { id: "acoustic_guitar", name: "Acoustic Guitar" },
      { id: "clean_electric_guitar", name: "Clean Electric Guitar" },
      { id: "distorted_electric_guitar", name: "Distorted Guitar" },
    ],
  },
  {
    name: "Bass",
    icon: "🎸",
    items: [
      { id: "acoustic_bass", name: "Acoustic Bass" },
      { id: "electric_bass", name: "Electric Bass" },
    ],
  },
  {
    name: "Strings",
    icon: "🎻",
    items: [
      { id: "violin", name: "Violin" },
      { id: "viola", name: "Viola" },
      { id: "cello", name: "Cello" },
      { id: "contrabass", name: "Contrabass" },
      { id: "orchestral_harp", name: "Orchestral Harp" },
      { id: "string_ensemble", name: "String Ensemble" },
      { id: "synth_strings", name: "Synth Strings" },
    ],
  },
  {
    name: "Brass",
    icon: "🎺",
    items: [
      { id: "trumpet", name: "Trumpet" },
      { id: "trombone", name: "Trombone" },
      { id: "tuba", name: "Tuba" },
      { id: "french_horn", name: "French Horn" },
      { id: "brass_section", name: "Brass Section" },
    ],
  },
  {
    name: "Woodwinds",
    icon: "🎷",
    items: [
      { id: "soprano_and_alto_sax", name: "Alto / Soprano Sax" },
      { id: "tenor_sax", name: "Tenor Sax" },
      { id: "baritone_sax", name: "Baritone Sax" },
      { id: "oboe", name: "Oboe" },
      { id: "english_horn", name: "English Horn" },
      { id: "bassoon", name: "Bassoon" },
      { id: "clarinet", name: "Clarinet" },
      { id: "flutes", name: "Flutes" },
    ],
  },
  {
    name: "Vocals",
    icon: "🎤",
    items: [
      { id: "voice", name: "Voice / Vocals" },
    ],
  },
  {
    name: "Synths",
    icon: "🎛️",
    items: [
      { id: "synth_lead", name: "Synth Lead" },
      { id: "synth_pad", name: "Synth Pad" },
    ],
  },
  {
    name: "Drums & Percussion",
    icon: "🥁",
    items: [
      { id: "drums", name: "Drum Kit" },
      { id: "chromatic_percussion", name: "Chromatic Percussion" },
      { id: "timpani", name: "Timpani" },
      { id: "orchestra_hit", name: "Orchestra Hit" },
    ],
  },
];

export const ALL_INSTRUMENTS = MT3_INSTRUMENT_CATEGORIES.flatMap((c) => c.items);

export default function TranscriptionSettingsModal({
  settings,
  session,
  onUpdateSettings,
  onClose,
}) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchFilter, setSearchFilter] = useState("");

  const selectedInstruments = settings.muscriptorInstruments || [];
  const currentStem = settings.targetStem || "original";
  const currentDevice = settings.device || "auto";
  const currentModel = settings.muscriptorModel || "large";

  const handleToggleInstrument = (instId) => {
    let next;
    if (selectedInstruments.includes(instId)) {
      next = selectedInstruments.filter((id) => id !== instId);
    } else {
      next = [...selectedInstruments, instId];
    }
    onUpdateSettings({ muscriptorInstruments: next });
  };

  const handleSelectPreset = (instList) => {
    onUpdateSettings({ muscriptorInstruments: instList });
  };

  const availableStems = session?.stems ? Object.keys(session.stems) : [];

  const filteredCategories = MT3_INSTRUMENT_CATEGORIES.map((cat) => {
    const items = cat.items.filter((item) => {
      const matchesSearch =
        item.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        item.id.toLowerCase().includes(searchFilter.toLowerCase());
      const matchesCategory =
        activeCategory === "all" || cat.name.toLowerCase() === activeCategory.toLowerCase();
      return matchesSearch && matchesCategory;
    });
    return { ...cat, items };
  }).filter((cat) => cat.items.length > 0);

  const stemOptions = [
    { label: "Full Audio Mix", value: "original" },
    ...availableStems.map((s) => ({
      label: `${session?.stems?.[s]?.icon || "🎵"} ${session?.stems?.[s]?.name || s}`,
      value: s,
    })),
  ];

  return (
    <Modal
      opened={true}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ThemeIcon size="md" variant="light" color="teal">
            <IconSettings size={18} />
          </ThemeIcon>
          <Text fw={700} size="md">MuScriptor MIDI Transcription Settings</Text>
        </Group>
      }
      size="lg"
      radius="md"
      centered
      styles={{
        content: { maxWidth: "min(760px, 94vw)", overflow: "hidden" },
        body: { padding: "12px 16px 16px 16px" },
      }}
    >
      <ScrollArea.Autosize mah="75vh" type="auto" style={{ width: "100%", maxWidth: "100%", overflowX: "hidden" }}>
        <Stack gap="sm" style={{ width: "100%", maxWidth: "100%", overflow: "hidden" }}>
          {/* Model Selection (Large vs Medium) */}
          <Card withBorder padding="sm" radius="md" style={{ background: "rgba(18, 184, 134, 0.04)", borderColor: "rgba(18, 184, 134, 0.2)" }}>
            <Group justify="space-between" mb="xs" wrap="wrap" gap="xs">
              <Box style={{ flex: 1, minWidth: 200 }}>
                <Text fw={700} size="sm" c="teal.4">
                  🧠 Transcription Model Variant
                </Text>
                <Text size="xs" c="dimmed">
                  Choose model size. Both run with native BF16 CUDA acceleration on your RTX 4060.
                </Text>
              </Box>
              <Badge variant="filled" color={currentModel === "large" ? "teal" : "cyan"} size="sm">
                {currentModel === "large" ? "1.3B Parameters" : "350M Parameters"}
              </Badge>
            </Group>

            <SegmentedControl
              value={currentModel}
              onChange={(val) => onUpdateSettings({ muscriptorModel: val })}
              data={[
                {
                  value: "large",
                  label: (
                    <Box py={3} px={4}>
                      <Group gap={6} justify="center" wrap="wrap">
                        <Text fw={700} size="sm">🔥 MuScriptor Large (1.3B)</Text>
                        <Badge size="xs" color="teal" variant="light">Recommended</Badge>
                      </Group>
                      <Text size="xs" c="dimmed" ta="center" mt={2}>
                        48 layers • ~3.1 GB VRAM • Max Polyphony
                      </Text>
                    </Box>
                  ),
                },
                {
                  value: "medium",
                  label: (
                    <Box py={3} px={4}>
                      <Group gap={6} justify="center" wrap="wrap">
                        <Text fw={700} size="sm">⚡ MuScriptor Medium (350M)</Text>
                      </Group>
                      <Text size="xs" c="dimmed" ta="center" mt={2}>
                        24 layers • ~1.2 GB VRAM • Ultra-Fast
                      </Text>
                    </Box>
                  ),
                },
              ]}
              fullWidth
              size="sm"
              radius="md"
              styles={{
                label: { whiteSpace: "normal", padding: "6px 8px" },
              }}
            />
          </Card>

          {/* Engine Banner */}
          <Card withBorder padding="sm" radius="md" style={{ background: "rgba(18, 184, 134, 0.05)", borderColor: "rgba(18, 184, 134, 0.25)" }}>
            <Group justify="space-between" wrap="wrap" gap="xs">
              <Box style={{ flex: 1, minWidth: 200 }}>
                <Text fw={700} size="sm" c="teal.4">
                  {currentModel === "large" ? "⚡ MuScriptor Large 1.3B (PyTorch BF16 CUDA)" : "⚡ MuScriptor Medium 350M (PyTorch BF16 CUDA)"}
                </Text>
                <Text size="xs" c="dimmed">
                  {currentModel === "large"
                    ? "Deep 48-layer transformer for state-of-the-art pitch, velocity, and multi-track polyphony."
                    : "Fast 24-layer transformer transcribing audio to Type 1 multi-track MIDI with audio-time alignment."}
                </Text>
              </Box>
              <Badge variant="dot" color="green">Ready</Badge>
            </Group>
          </Card>

          {/* Audio Input Target & Device */}
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Card withBorder padding="sm" radius="md">
              <Text fw={600} size="xs" c="dimmed" mb={6} style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Target Audio Stem
              </Text>
              <Select
                data={stemOptions}
                value={currentStem}
                onChange={(val) => onUpdateSettings({ targetStem: val || "original" })}
                searchable
                size="xs"
              />
              <Text size="11px" c="dimmed" mt={4}>
                Audio track to transcribe into MIDI notes
              </Text>
            </Card>

            <Card withBorder padding="sm" radius="md">
              <Text fw={600} size="xs" c="dimmed" mb={6} style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Compute Accelerator (Hardware)
              </Text>
              <SegmentedControl
                value={currentDevice === "cpu" ? "cpu" : "auto"}
                onChange={(val) => onUpdateSettings({ device: val })}
                data={[
                  { label: "⚡ NVIDIA CUDA (GPU)", value: "auto" },
                  { label: "CPU Compatibility", value: "cpu" },
                ]}
                fullWidth
                size="xs"
                styles={{
                  label: { whiteSpace: "normal", padding: "6px" },
                }}
              />
              <Text size="11px" c="dimmed" mt={4}>
                Runs model on RTX 4060 GPU (~2s) or CPU fallback
              </Text>
            </Card>
          </SimpleGrid>

          {/* Manual Tempo & Beat Grid Alignment */}
          <Card withBorder padding="sm" radius="md">
            <Group justify="space-between" mb="xs" wrap="wrap" gap="xs">
              <Text fw={600} size="sm">Target Tempo / BPM (Beat Grid Alignment)</Text>
              <Text size="xs" c="dimmed">
                {settings.manualTempo ? `Manual: ${settings.manualTempo} BPM` : "Auto-Detecting from audio"}
              </Text>
            </Group>

            <Group gap="xs" wrap="wrap">
              <NumberInput
                min={30}
                max={300}
                placeholder="Auto (detect from audio)"
                value={settings.manualTempo ? Number(settings.manualTempo) : ""}
                onChange={(val) => onUpdateSettings({ manualTempo: val ? String(val) : "" })}
                style={{ width: 160 }}
                size="xs"
              />
              <Button
                variant={!settings.manualTempo ? "light" : "default"}
                size="xs"
                onClick={() => onUpdateSettings({ manualTempo: "" })}
              >
                Auto-Detect
              </Button>
              <Button
                variant={settings.manualTempo === "120" ? "light" : "default"}
                size="xs"
                onClick={() => onUpdateSettings({ manualTempo: "120" })}
              >
                120 BPM
              </Button>
              <Button
                variant={settings.manualTempo === "136" ? "light" : "default"}
                size="xs"
                onClick={() => onUpdateSettings({ manualTempo: "136" })}
              >
                136 BPM
              </Button>
            </Group>
            <Text size="xs" c="dimmed" mt="xs">
              Setting exact BPM writes the MIDI header tempo and aligns bar lines, eliminating awkward tuplets and rests in notation software.
            </Text>
          </Card>

          {/* Single-Track Consolidation Mode */}
          <Card withBorder padding="sm" radius="md">
            <Group justify="space-between" wrap="nowrap" gap="md">
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text fw={600} size="sm">Consolidate into 1 Single Track</Text>
                <Text size="xs" c="dimmed" mt={2}>
                  Outputs all notes for this stem into a single clean MIDI track instead of splitting into multiple staves in MuseScore/Sibelius.
                </Text>
              </Box>
              <Switch
                checked={settings.singleTrack !== false}
                onChange={(e) => onUpdateSettings({ singleTrack: e.currentTarget.checked })}
                color="teal"
                size="md"
                style={{ flexShrink: 0 }}
              />
            </Group>
          </Card>

          {/* Instrument Conditioning Filter */}
          <Card withBorder padding="sm" radius="md">
            <Group justify="space-between" mb="xs" wrap="wrap" gap="xs">
              <Box style={{ flex: 1, minWidth: 200 }}>
                <Text fw={600} size="sm">Instrument Conditioning Filter (35 Instruments)</Text>
                <Text size="xs" c="dimmed">
                  {selectedInstruments.length === 0
                    ? "Detecting all instruments in audio"
                    : `${selectedInstruments.length} instrument(s) actively constrained`}
                </Text>
              </Box>

              <Group gap="xs">
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => handleSelectPreset([])}
                >
                  Clear (All Mix)
                </Button>
                <Button
                  size="compact-xs"
                  variant="light"
                  color="teal"
                  onClick={() => handleSelectPreset(ALL_INSTRUMENTS.map((i) => i.id))}
                >
                  Select All 35
                </Button>
              </Group>
            </Group>

            {/* Quick Presets */}
            <Group gap={6} mb="sm" wrap="wrap">
              <Text size="xs" c="dimmed" fw={600}>Presets:</Text>
              {[
                { name: "🎹 Piano & Keys", ids: ["acoustic_piano", "electric_piano", "organ"] },
                { name: "🎸 Guitars & Bass", ids: ["acoustic_guitar", "clean_electric_guitar", "distorted_electric_guitar", "electric_bass"] },
                { name: "🎻 Strings Quartet", ids: ["violin", "viola", "cello", "contrabass"] },
                { name: "🎺 Brass & Sax", ids: ["trumpet", "trombone", "tenor_sax", "soprano_and_alto_sax"] },
                { name: "🥁 Drums Kit", ids: ["drums", "timpani"] },
                { name: "🎤 Vocals Only", ids: ["voice"] },
              ].map((p) => (
                <Button
                  key={p.name}
                  variant="default"
                  size="compact-xs"
                  onClick={() => handleSelectPreset(p.ids)}
                >
                  {p.name}
                </Button>
              ))}
            </Group>

            {/* Search & Category Filter */}
            <Group gap="xs" mb="sm" wrap="wrap">
              <TextInput
                placeholder="Search instruments..."
                leftSection={<IconSearch size={14} />}
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.currentTarget.value)}
                style={{ flex: 1, minWidth: 150 }}
                size="xs"
              />
              <Select
                value={activeCategory}
                onChange={(val) => setActiveCategory(val || "all")}
                data={[
                  { value: "all", label: "All Categories" },
                  ...MT3_INSTRUMENT_CATEGORIES.map((c) => ({
                    value: c.name.toLowerCase(),
                    label: `${c.icon} ${c.name}`,
                  })),
                ]}
                style={{ width: 170, minWidth: 140 }}
                size="xs"
              />
            </Group>

            {/* Instrument Grid */}
            <ScrollArea.Autosize mah={220} type="auto">
              <Stack gap="sm">
                {filteredCategories.map((cat) => (
                  <Box key={cat.name}>
                    <Text size="xs" fw={700} c="dimmed" mb={4}>
                      {cat.icon} {cat.name}
                    </Text>
                    <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing={6}>
                      {cat.items.map((item) => {
                        const isChecked = selectedInstruments.includes(item.id);
                        return (
                          <Card
                            key={item.id}
                            padding="xs"
                            radius="sm"
                            withBorder
                            onClick={() => handleToggleInstrument(item.id)}
                            style={{
                              cursor: "pointer",
                              borderColor: isChecked ? "var(--mantine-color-teal-6)" : undefined,
                              backgroundColor: isChecked ? "rgba(18, 184, 134, 0.12)" : undefined,
                              transition: "all 0.15s ease",
                              minWidth: 0,
                            }}
                          >
                            <Group gap="xs" justify="space-between" wrap="nowrap">
                              <Text size="xs" fw={isChecked ? 600 : 400} c={isChecked ? "teal.4" : undefined} truncate>
                                {item.name}
                              </Text>
                              {isChecked && (
                                <ThemeIcon size="xs" radius="xl" color="teal" variant="filled" style={{ flexShrink: 0 }}>
                                  <IconCheck size={10} stroke={3} />
                                </ThemeIcon>
                              )}
                            </Group>
                          </Card>
                        );
                      })}
                    </SimpleGrid>
                  </Box>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Card>
        </Stack>
      </ScrollArea.Autosize>

      <Group justify="flex-end" mt="md">
        <Button variant="filled" color="teal" onClick={onClose}>
          Done
        </Button>
      </Group>
    </Modal>
  );
}
