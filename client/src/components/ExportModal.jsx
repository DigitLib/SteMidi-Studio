import React from "react";
import {
  Modal,
  Card,
  Group,
  Stack,
  Text,
  Button,
  ThemeIcon,
  Box,
} from "@mantine/core";
import {
  IconFileMusic,
  IconHeadphones,
  IconArchive,
  IconChartBar,
  IconDownload,
} from "@tabler/icons-react";

export default function ExportModal({ session, onClose }) {
  const sessionId = session?.session_id;

  const exportItems = [
    {
      id: "midi",
      label: "Multi-Instrument MIDI (.mid)",
      ext: ".mid",
      icon: <IconFileMusic size={22} />,
      color: "teal",
      desc: "Standard Type 1 multi-track MIDI file for any DAW (FL Studio, Ableton, Logic, Reaper, MuseScore)",
      highlight: true,
    },
    {
      id: "stems_zip",
      label: "Separated Audio Stems (44.1kHz WAV ZIP)",
      ext: ".zip",
      icon: <IconHeadphones size={22} />,
      color: "violet",
      desc: "All isolated instrument stems from BS-RoFormer Mega",
      highlight: false,
    },
    {
      id: "zip",
      label: "Complete Studio Archive (Stems + MIDI)",
      ext: ".zip",
      icon: <IconArchive size={22} />,
      color: "indigo",
      desc: "Full archive containing all WAV stems, multi-track MIDI, and project metadata",
      highlight: false,
    },
    {
      id: "events",
      label: "Note Events & Pitch Data (JSON)",
      ext: ".json",
      icon: <IconChartBar size={22} />,
      color: "teal",
      desc: "Raw note timestamps, pitches, durations, and instruments for custom music analysis",
      highlight: false,
    },
  ];

  return (
    <Modal
      opened={true}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ThemeIcon size="md" variant="light" color="teal">
            <IconDownload size={18} />
          </ThemeIcon>
          <Text fw={700} size="lg">Export MIDI & Stems</Text>
        </Group>
      }
      size="lg"
      radius="md"
    >
      <Stack gap="sm">
        {exportItems.map((item) => (
          <Card
            key={item.id}
            withBorder
            padding="md"
            radius="md"
            style={{
              borderColor: item.highlight ? "var(--mantine-color-teal-6)" : undefined,
              backgroundColor: item.highlight ? "rgba(18, 184, 134, 0.08)" : undefined,
            }}
          >
            <Group justify="space-between" wrap="nowrap">
              <Group gap="md" wrap="nowrap">
                <ThemeIcon
                  size="xl"
                  radius="md"
                  variant="light"
                  color={item.color}
                >
                  {item.icon}
                </ThemeIcon>
                <Box>
                  <Text fw={600} size="sm" c={item.highlight ? "teal.4" : undefined}>
                    {item.label}
                  </Text>
                  <Text size="xs" c="dimmed" mt={2} style={{ lineHeight: 1.4 }}>
                    {item.desc}
                  </Text>
                </Box>
              </Group>

              <Button
                component="a"
                href={`/api/export/${sessionId}/${item.id}`}
                download
                size="sm"
                variant={item.highlight ? "filled" : "light"}
                color={item.color}
                leftSection={<IconDownload size={16} />}
                style={{ flexShrink: 0 }}
              >
                Download {item.ext}
              </Button>
            </Group>
          </Card>
        ))}

        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
