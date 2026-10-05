import React, { useState, useMemo } from "react";
import {
  Card,
  Group,
  Stack,
  Text,
  Badge,
  Button,
  TextInput,
  SegmentedControl,
  SimpleGrid,
  ScrollArea,
  ActionIcon,
  ThemeIcon,
  Box,
} from "@mantine/core";
import {
  IconSearch,
  IconCheck,
  IconX,
  IconChevronUp,
  IconMusic,
} from "@tabler/icons-react";

export const MEGA_53_CATALOG = [
  // Vocals
  { id: "lead-vocal", name: "Lead Vocal", category: "vocals", icon: "🎤", color: "#e07a5f" },
  { id: "back-vocal", name: "Backing Vocal", category: "vocals", icon: "🎙️", color: "#e8a87c" },
  { id: "vocal", name: "Vocals (Full)", category: "vocals", icon: "🗣️", color: "#d97d43" },

  // Keyboards & Pianos
  { id: "piano", name: "Acoustic Piano", category: "keyboards", icon: "🎹", color: "#00e676" },
  { id: "digital-piano", name: "Digital Piano", category: "keyboards", icon: "🎹", color: "#69f0ae" },
  { id: "organ", name: "Organ", category: "keyboards", icon: "⛪", color: "#b9f6ca" },
  { id: "harpsichord", name: "Harpsichord", category: "keyboards", icon: "🎼", color: "#a7ffeb" },
  { id: "keys", name: "Keyboards", category: "keyboards", icon: "🎹", color: "#1de9b6" },
  { id: "synth", name: "Synthesizer", category: "keyboards", icon: "🎛️", color: "#00bfa5" },

  // Guitars & Plucked Strings
  { id: "acoustic-guitar", name: "Acoustic Guitar", category: "guitars", icon: "🎸", color: "#ffab00" },
  { id: "electric-guitar", name: "Electric Guitar", category: "guitars", icon: "🎸", color: "#ffd740" },
  { id: "guitar", name: "Guitar (General)", category: "guitars", icon: "🎸", color: "#ffc400" },
  { id: "bass", name: "Bass Guitar", category: "guitars", icon: "🎸", color: "#b388ff" },
  { id: "banjo", name: "Banjo", category: "guitars", icon: "🪕", color: "#ffe57f" },
  { id: "mandolin", name: "Mandolin", category: "guitars", icon: "🪕", color: "#ffca28" },
  { id: "ukulele", name: "Ukulele", category: "guitars", icon: "🪕", color: "#ffb300" },
  { id: "sitar", name: "Sitar", category: "guitars", icon: "🪕", color: "#ffa000" },
  { id: "harp", name: "Harp", category: "guitars", icon: "🪗", color: "#ff8f00" },
  { id: "dobro", name: "Dobro", category: "guitars", icon: "🎸", color: "#ff6f00" },

  // Bowed Strings & Orchestral
  { id: "strings", name: "Strings Ensemble", category: "strings", icon: "🎻", color: "#ea80fc" },
  { id: "violin", name: "Violin", category: "strings", icon: "🎻", color: "#e040fb" },
  { id: "viola", name: "Viola", category: "strings", icon: "🎻", color: "#d500f9" },
  { id: "cello", name: "Cello", category: "strings", icon: "🎻", color: "#aa00ff" },
  { id: "double-bass", name: "Double Bass", category: "strings", icon: "🎻", color: "#7c4dff" },
  { id: "bowed_strings", name: "Bowed Strings", category: "strings", icon: "🎻", color: "#651fff" },

  // Brass
  { id: "brass", name: "Brass Section", category: "brass", icon: "🎺", color: "#ff6e40" },
  { id: "trumpet", name: "Trumpet", category: "brass", icon: "🎺", color: "#ff3d00" },
  { id: "trombone", name: "Trombone", category: "brass", icon: "🎺", color: "#dd2c00" },
  { id: "french-horn", name: "French Horn", category: "brass", icon: "📯", color: "#ff9e80" },
  { id: "tuba", name: "Tuba", category: "brass", icon: "📯", color: "#ff5722" },

  // Woodwinds & Harmonicas
  { id: "woodwind", name: "Woodwinds Section", category: "woodwinds", icon: "🎷", color: "#ff4081" },
  { id: "saxophone", name: "Saxophone", category: "woodwinds", icon: "🎷", color: "#f50057" },
  { id: "flute", name: "Flute", category: "woodwinds", icon: "🪈", color: "#c51162" },
  { id: "clarinet", name: "Clarinet", category: "woodwinds", icon: "🪵", color: "#ff80ab" },
  { id: "oboe", name: "Oboe", category: "woodwinds", icon: "🪵", color: "#ec407a" },
  { id: "bassoon", name: "Bassoon", category: "woodwinds", icon: "🪵", color: "#ad1457" },
  { id: "wind", name: "Winds (General)", category: "woodwinds", icon: "💨", color: "#f06292" },
  { id: "accordion", name: "Accordion", category: "woodwinds", icon: "🪗", color: "#ba68c8" },
  { id: "harmonica", name: "Harmonica", category: "woodwinds", icon: "🎵", color: "#ab47bc" },

  // Drums & Percussion
  { id: "drums", name: "Drum Kit", category: "percussion", icon: "🥁", color: "#ff5252" },
  { id: "kick", name: "Kick Drum", category: "percussion", icon: "🥁", color: "#ff1744" },
  { id: "snare", name: "Snare Drum", category: "percussion", icon: "🥁", color: "#d50000" },
  { id: "hh", name: "Hi-Hat", category: "percussion", icon: "🥢", color: "#ff8a80" },
  { id: "toms", name: "Toms", category: "percussion", icon: "🥁", color: "#ff616f" },
  { id: "percussion", name: "Percussion (General)", category: "percussion", icon: "🪘", color: "#ff9800" },
  { id: "congas", name: "Congas", category: "percussion", icon: "🪘", color: "#fb8c00" },
  { id: "tambourine", name: "Tambourine", category: "percussion", icon: "🪇", color: "#f57c00" },
  { id: "marimba", name: "Marimba", category: "percussion", icon: "🪵", color: "#ef6c00" },
  { id: "glockenspiel", name: "Glockenspiel", category: "percussion", icon: "🔔", color: "#e65100" },
  { id: "bells", name: "Bells", category: "percussion", icon: "🔔", color: "#ffd600" },
  { id: "timpani", name: "Timpani", category: "percussion", icon: "🥁", color: "#ffab00" },
  { id: "triangle", name: "Triangle", category: "percussion", icon: "📐", color: "#ffc400" },
  { id: "wind-chimes", name: "Wind Chimes", category: "percussion", icon: "🎐", color: "#ffe57f" },
];

const CATEGORIES = [
  { id: "all", name: "All (53)" },
  { id: "vocals", name: "🎤 Vocals (3)" },
  { id: "keyboards", name: "🎹 Keys (6)" },
  { id: "guitars", name: "🎸 Guitars (10)" },
  { id: "strings", name: "🎻 Strings (6)" },
  { id: "brass", name: "🎺 Brass (5)" },
  { id: "woodwinds", name: "🎷 Winds (9)" },
  { id: "percussion", name: "🥁 Drums (14)" },
];

const PRESETS = [
  {
    name: "Standard Band (6)",
    stems: ["lead-vocal", "piano", "guitar", "bass", "drums", "strings"],
    desc: "Vocals, Piano, Guitar, Bass, Drums, Strings",
  },
  {
    name: "Orchestral (8)",
    stems: ["strings", "violin", "cello", "flute", "clarinet", "oboe", "trumpet", "french-horn"],
    desc: "Orchestral strings, woodwinds, and brass",
  },
  {
    name: "Crisp Split Drums (3)",
    stems: ["kick", "snare", "hh"],
    desc: "Isolated Kick, Snare & Hi-Hat (Far sharper transients than full drum kit)",
  },
  {
    name: "Rhythm & Beats (5)",
    stems: ["drums", "kick", "snare", "hh", "bass"],
    desc: "Complete rhythm section",
  },
  {
    name: "Jazz Section (6)",
    stems: ["saxophone", "trumpet", "trombone", "piano", "double-bass", "drums"],
    desc: "Classic jazz horn section & trio",
  },
  {
    name: "Rock / Funk (Organ + Sax) (6)",
    stems: ["vocal", "organ", "electric-guitar", "saxophone", "bass", "drums"],
    desc: "Vocals (Full), Hammond Organ, Electric Guitar, Saxophone, Bass, Drums",
  },
  {
    name: "Vocals Only (2)",
    stems: ["lead-vocal", "back-vocal"],
    desc: "Lead and backing vocal isolation",
  },
];

export default function MegaInstrumentSelector({
  selectedInstruments = [],
  onChange,
  disabled = false,
  onClose = null,
}) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredInstruments = useMemo(() => {
    return MEGA_53_CATALOG.filter((inst) => {
      const matchesCat = activeCategory === "all" || inst.category === activeCategory;
      const matchesSearch =
        !searchQuery ||
        inst.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inst.id.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [activeCategory, searchQuery]);

  const toggleStem = (id) => {
    if (disabled) return;
    if (selectedInstruments.includes(id)) {
      if (selectedInstruments.length === 1) return; // Keep at least one
      onChange(selectedInstruments.filter((x) => x !== id));
    } else {
      onChange([...selectedInstruments, id]);
    }
  };

  const applyPreset = (presetStems) => {
    if (disabled) return;
    onChange(presetStems);
  };

  const selectAllFiltered = () => {
    if (disabled) return;
    const ids = new Set(selectedInstruments);
    filteredInstruments.forEach((i) => ids.add(i.id));
    onChange(Array.from(ids));
  };

  const deselectFiltered = () => {
    if (disabled) return;
    const toRemove = new Set(filteredInstruments.map((i) => i.id));
    const remaining = selectedInstruments.filter((id) => !toRemove.has(id));
    onChange(remaining.length > 0 ? remaining : [MEGA_53_CATALOG[0].id]);
  };

  return (
    <Card
      withBorder
      padding="md"
      radius="md"
      mb="md"
      style={{
        background: "rgba(16, 18, 22, 0.95)",
        borderColor: "rgba(18, 184, 134, 0.3)",
      }}
    >
      <Stack gap="sm">
        {/* Top Header: Title, Preset Badges & Stats */}
        <Group justify="space-between" wrap="wrap">
          <Group gap="xs">
            <ThemeIcon size="md" variant="light" color="teal">
              <IconMusic size={18} />
            </ThemeIcon>
            <Text fw={700} size="sm" c="teal.4">
              BS-RoFormer MVSep Mega (53 Stems)
            </Text>
            <Badge color="green" variant="light" size="sm">
              {selectedInstruments.length} stem{selectedInstruments.length !== 1 ? "s" : ""} selected
            </Badge>
          </Group>

          <Group gap="xs" wrap="wrap">
            <Text size="xs" c="dimmed" fw={600}>Presets:</Text>
            {PRESETS.map((p) => (
              <Button
                key={p.name}
                variant="default"
                size="compact-xs"
                onClick={() => applyPreset(p.stems)}
                disabled={disabled}
                title={p.desc}
              >
                {p.name}
              </Button>
            ))}
            {onClose && (
              <Button
                variant="subtle"
                color="gray"
                size="compact-xs"
                leftSection={<IconChevronUp size={14} />}
                onClick={onClose}
              >
                Hide
              </Button>
            )}
          </Group>
        </Group>

        {/* Filter Row: Category Tabs & Search */}
        <Group justify="space-between" wrap="wrap" gap="xs">
          <ScrollArea type="never" style={{ maxWidth: "100%" }}>
            <Group gap={4}>
              {CATEGORIES.map((cat) => {
                const isActive = activeCategory === cat.id;
                return (
                  <Button
                    key={cat.id}
                    variant={isActive ? "light" : "subtle"}
                    color={isActive ? "teal" : "gray"}
                    size="compact-xs"
                    onClick={() => setActiveCategory(cat.id)}
                  >
                    {cat.name}
                  </Button>
                );
              })}
            </Group>
          </ScrollArea>

          <Group gap="xs">
            <TextInput
              placeholder="Filter instruments..."
              leftSection={<IconSearch size={13} />}
              rightSection={
                searchQuery ? (
                  <ActionIcon size="xs" variant="transparent" c="dimmed" onClick={() => setSearchQuery("")}>
                    <IconX size={12} />
                  </ActionIcon>
                ) : null
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              size="xs"
              style={{ width: 170 }}
            />
            <Button variant="subtle" color="teal" size="compact-xs" onClick={selectAllFiltered} disabled={disabled}>
              Select All
            </Button>
            <Button variant="subtle" color="gray" size="compact-xs" onClick={deselectFiltered} disabled={disabled}>
              Clear
            </Button>
          </Group>
        </Group>

        {/* 53-Instrument Chips Grid (Short Buttons / 6-8 Columns) */}
        <ScrollArea.Autosize mah={360} type="scroll">
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 6, xl: 8 }} spacing={6}>
            {filteredInstruments.map((inst) => {
              const isSelected = selectedInstruments.includes(inst.id);
              const stemColor = inst.color || "var(--mantine-color-teal-5)";
              return (
                <Card
                  key={inst.id}
                  padding={0}
                  radius="sm"
                  withBorder
                  onClick={() => toggleStem(inst.id)}
                  style={{
                    cursor: disabled ? "not-allowed" : "pointer",
                    borderColor: isSelected ? stemColor : "var(--border-subtle, rgba(255, 255, 255, 0.08))",
                    borderLeft: isSelected ? `3px solid ${stemColor}` : undefined,
                    backgroundColor: isSelected ? "rgba(18, 184, 134, 0.12)" : "rgba(255, 255, 255, 0.02)",
                    padding: "4px 8px",
                    minHeight: "32px",
                    display: "flex",
                    justifyContent: "center",
                    transition: "all 0.12s ease",
                    userSelect: "none",
                  }}
                  title={`Click to ${isSelected ? "unselect" : "select"} ${inst.name}`}
                >
                  <Group justify="space-between" wrap="nowrap" gap={4} style={{ width: "100%" }}>
                    <Group gap={5} wrap="nowrap" style={{ overflow: "hidden", minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: "13px", lineHeight: 1, flexShrink: 0 }}>{inst.icon}</span>
                      <Text
                        size="xs"
                        fw={isSelected ? 600 : 400}
                        c={isSelected ? "white" : "dimmed"}
                        truncate
                        style={{ fontSize: "11px", lineHeight: 1.2 }}
                      >
                        {inst.name}
                      </Text>
                    </Group>
                    {isSelected && (
                      <ThemeIcon size={14} radius="xl" color="teal" variant="filled" style={{ flexShrink: 0 }}>
                        <IconCheck size={9} stroke={3} />
                      </ThemeIcon>
                    )}
                  </Group>
                </Card>
              );
            })}
          </SimpleGrid>
        </ScrollArea.Autosize>
      </Stack>
    </Card>
  );
}
