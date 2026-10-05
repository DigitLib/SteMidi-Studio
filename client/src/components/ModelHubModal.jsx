import React from "react";
import {
  Modal,
  Card,
  Group,
  Stack,
  Text,
  Badge,
  Button,
  Code,
  Progress,
  ThemeIcon,
  Box,
} from "@mantine/core";
import {
  IconSparkles,
  IconWaveSine,
  IconPiano,
  IconCpu,
  IconTrash,
  IconRefresh,
  IconFolder,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { unloadModels } from "../utils/api";

export default function ModelHubModal({ status, onClose, onRefreshStatus }) {
  const megaStatus = status?.models?.mega_roformer;
  const muscriptorStatus = status?.models?.muscriptor;

  const handlePurgeVram = async () => {
    try {
      await unloadModels();
      notifications.show({
        title: "VRAM Cleared",
        message: "Models unloaded and GPU memory cache emptied.",
        color: "teal",
        icon: <IconSparkles size={16} />,
      });
      if (onRefreshStatus) onRefreshStatus();
    } catch (e) {
      notifications.show({
        title: "Failed to Unload Models",
        message: String(e.message || e),
        color: "red",
      });
    }
  };

  const vramUsed = status?.vram_used_mb || 0;
  const vramTotal = status?.vram_total_mb || 1;
  const vramPercent = Math.min(100, Math.round((vramUsed / vramTotal) * 100));

  return (
    <Modal
      opened={true}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ThemeIcon size="md" variant="light" color="teal">
            <IconSparkles size={18} />
          </ThemeIcon>
          <Text fw={700} size="lg">Studio AI Models Hub</Text>
        </Group>
      }
      size="lg"
      radius="md"
    >
      <Stack gap="md">
        {/* Separation Engine: BS-RoFormer Mega-53 */}
        <Card withBorder padding="md" radius="md">
          <Group justify="space-between" mb="xs">
            <Group gap="xs">
              <ThemeIcon size="md" variant="light" color="teal">
                <IconWaveSine size={18} />
              </ThemeIcon>
              <Text fw={600} size="sm">Audio Source Separation</Text>
            </Group>
            <Badge
              variant="dot"
              color={megaStatus?.available ? "teal" : "gray"}
            >
              {megaStatus?.available ? "Available" : "Not Found"}
            </Badge>
          </Group>

          <Text fw={700} size="md" c="teal.4">
            BS-RoFormer MVSep Mega-53-Stems
          </Text>

          <Text size="xs" c="dimmed" mt="xs" style={{ lineHeight: 1.5 }}>
            {megaStatus?.available ? (
              <>
                Loaded <strong>{megaStatus.stems_count} dedicated instrument checkpoints</strong> ({megaStatus.size_mb} MB) from <Code>models/BS-Roformer-MVSep-Mega-53-stems/v1</Code>.
                Selective overlap-add inference with automatic VRAM management.
              </>
            ) : (
              "Mega-53 model files not found in models/BS-Roformer-MVSep-Mega-53-stems."
            )}
          </Text>

          <Group gap="md" mt="sm">
            <Text size="xs" c="dimmed">⚡ {status?.gpu_name || "CUDA GPU"}</Text>
            <Text size="xs" c="dimmed">• 8x Hann OLA (87.5%)</Text>
            <Text size="xs" c="dimmed">• RoPE Rotary Attention</Text>
          </Group>
        </Card>

        {/* Transcription Engines: MuScriptor Large & Medium */}
        <Card withBorder padding="md" radius="md">
          <Group justify="space-between" mb="xs">
            <Group gap="xs">
              <ThemeIcon size="md" variant="light" color="teal">
                <IconPiano size={18} />
              </ThemeIcon>
              <Text fw={600} size="sm">Music Transcription Engines</Text>
            </Group>
            <Badge
              variant="dot"
              color={muscriptorStatus?.available ? "teal" : "gray"}
            >
              {muscriptorStatus?.available ? "Available" : "Not Found"}
            </Badge>
          </Group>

          <Stack gap="sm">
            {/* MuScriptor Large Card */}
            <Card withBorder padding="sm" radius="md" style={{ background: "rgba(18, 184, 134, 0.04)", borderColor: "rgba(18, 184, 134, 0.2)" }}>
              <Group justify="space-between">
                <Group gap="xs">
                  <Text fw={700} size="sm" c="teal.4">🔥 MuScriptor Large (1.3B)</Text>
                  <Badge size="xs" color="teal" variant="light">Recommended</Badge>
                </Group>
                <Badge size="xs" variant="outline" color={muscriptorStatus?.variants?.large?.available ? "teal" : "gray"}>
                  {muscriptorStatus?.variants?.large?.available ? "Installed (5.2 GB)" : "Not Found"}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" mt={4}>
                Deep 48-layer transformer for maximum multi-track polyphony and chord precision.
                Memory budget: <strong>~3.1 GB VRAM</strong> in native BF16 (fits easily in RTX 4060 8 GB).
              </Text>
            </Card>

            {/* MuScriptor Medium Card */}
            <Card withBorder padding="sm" radius="md" style={{ background: "rgba(255, 255, 255, 0.02)" }}>
              <Group justify="space-between">
                <Group gap="xs">
                  <Text fw={700} size="sm" c="gray.2">⚡ MuScriptor Medium (350M)</Text>
                </Group>
                <Badge size="xs" variant="outline" color={muscriptorStatus?.variants?.medium?.available ? "green" : "gray"}>
                  {muscriptorStatus?.variants?.medium?.available ? "Installed (1.2 GB)" : "Not Found"}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" mt={4}>
                Lightweight 24-layer transformer for ultra-fast generation.
                Memory budget: <strong>~1.2 GB VRAM</strong> in BF16.
              </Text>
            </Card>
          </Stack>

          <Group gap="md" mt="sm">
            <Text size="xs" c="dimmed">⚡ {muscriptorStatus?.format || "Safetensors BF16 CUDA"}</Text>
            <Text size="xs" c="dimmed">
              • Status: {muscriptorStatus?.loaded_in_vram ? `⚡ Resident (${muscriptorStatus?.active_variant?.toUpperCase()})` : "💤 Unloaded (0 MB VRAM)"}
            </Text>
            <Text size="xs" c="dimmed">• Format: Type 1 MIDI (.mid)</Text>
          </Group>
        </Card>

        {/* Hardware & VRAM Management */}
        <Card withBorder padding="md" radius="md">
          <Group justify="space-between" mb="xs">
            <Group gap="xs">
              <ThemeIcon size="md" variant="light" color="indigo">
                <IconCpu size={18} />
              </ThemeIcon>
              <Box>
                <Text fw={600} size="sm">GPU Hardware & VRAM</Text>
                <Text size="xs" c="dimmed">
                  {vramUsed} MB / {vramTotal} MB ({vramPercent}%)
                </Text>
              </Box>
            </Group>
            <Button
              variant="light"
              color="teal"
              size="xs"
              leftSection={<IconTrash size={14} />}
              onClick={handlePurgeVram}
            >
              Free VRAM
            </Button>
          </Group>

          <Progress value={vramPercent} color={vramPercent > 85 ? "red" : vramPercent > 60 ? "yellow" : "teal"} size="sm" radius="xl" mt="xs" />
        </Card>

        <Group justify="space-between" mt="xs">
          <Group gap="xs">
            <Button
              variant="default"
              size="xs"
              leftSection={<IconRefresh size={14} />}
              onClick={onRefreshStatus}
            >
              Refresh Status
            </Button>
            {window.stemidiAPI?.openModelsFolder && (
              <Button
                variant="light"
                color="blue"
                size="xs"
                leftSection={<IconFolder size={14} />}
                onClick={() => window.stemidiAPI.openModelsFolder()}
              >
                Open Models Folder
              </Button>
            )}
          </Group>
          <Button variant="subtle" color="gray" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
