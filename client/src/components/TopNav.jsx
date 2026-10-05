import React, { useRef } from "react";
import {
  Group,
  Button,
  Badge,
  Text,
  ThemeIcon,
  Tooltip,
  Paper,
  Box,
} from "@mantine/core";
import {
  IconWaveSine,
  IconCpu,
  IconCpuOff,
  IconFolder,
  IconUpload,
  IconBolt,
  IconDownload,
  IconSettings,
  IconSparkles,
} from "@tabler/icons-react";

export default function TopNav({
  status,
  session,
  isProcessing,
  onUpload,
  onTranscribe,
  onOpenModelModal,
  onOpenExportModal,
  onOpenSettingsModal,
  onOpenSessionsModal,
}) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
    }
  };

  const hasResult = Boolean(session?.result?.midi_file || session?.result?.events?.length);
  const isGpu = Boolean(status?.gpu_available);

  return (
    <Paper
      component="header"
      px="md"
      py="xs"
      style={{
        backgroundColor: "rgba(16, 18, 22, 0.95)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "12px",
        zIndex: 100,
        position: "sticky",
        top: 0,
      }}
    >
      {/* Brand & Logo */}
      <Group gap="sm">
        <ThemeIcon
          size="lg"
          radius="md"
          variant="light"
          color="teal"
        >
          <IconWaveSine size={22} stroke={2} />
        </ThemeIcon>
        <Box>
          <Group gap={6} align="center">
            <Text fw={700} size="md" c="white" style={{ letterSpacing: "-0.3px" }}>
              SteMidi Studio
            </Text>
            <Badge
              variant="filled"
              color="teal.9"
              size="xs"
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontWeight: 600,
                fontSize: "10px",
                letterSpacing: "0.3px",
                padding: "2px 6px",
                border: "1px solid rgba(32, 201, 151, 0.35)",
              }}
            >
              v0.0.1
            </Badge>
            <Badge
              variant="outline"
              color="teal"
              size="xs"
              style={{ textTransform: "none", letterSpacing: "0.2px" }}
            >
              Mega-53 & MuScriptor
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" style={{ fontSize: "11px", lineHeight: 1.2 }}>
            Selective Multi-Stem Separation & Multi-Instrument MIDI Transcription
          </Text>
        </Box>
      </Group>

      {/* Center: Hardware & Engine Badges */}
      <Group gap="xs">
        <Tooltip label={isGpu ? "GPU Acceleration Active" : "Running on CPU"} withArrow>
          <Badge
            variant="light"
            color={isGpu ? "teal" : "gray"}
            leftSection={
              isGpu ? <IconCpu size={14} /> : <IconCpuOff size={14} />
            }
            size="md"
            style={{ fontWeight: 500 }}
          >
            {status?.gpu_name || "CPU Mode"}
            {status?.vram_total_mb > 0 && (
              <span style={{ opacity: 0.7, marginLeft: 5 }}>
                ({status.vram_used_mb}MB / {status.vram_total_mb}MB)
              </span>
            )}
          </Badge>
        </Tooltip>

        <Tooltip label="Click to view loaded model status and VRAM usage" withArrow>
          <Badge
            variant="outline"
            color="teal"
            size="md"
            leftSection={<IconSparkles size={14} />}
            style={{ cursor: "pointer", transition: "all 0.2s ease" }}
            onClick={onOpenModelModal}
          >
            Mega-53 + MuScriptor
          </Badge>
        </Tooltip>
      </Group>

      {/* Right: Actions */}
      <Group gap="xs">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a"
          style={{ display: "none" }}
        />

        <Button
          variant="subtle"
          color="gray"
          leftSection={<IconFolder size={16} />}
          onClick={onOpenSessionsModal}
        >
          Sessions
        </Button>

        <Button
          variant="light"
          color="teal"
          leftSection={<IconUpload size={16} />}
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          Import Audio
        </Button>

        <Button
          variant="filled"
          color="teal"
          leftSection={<IconBolt size={16} />}
          onClick={() => onTranscribe()}
          loading={isProcessing}
          disabled={!session || session.status === "processing"}
        >
          {isProcessing ? "Transcribing..." : "Transcribe to MIDI"}
        </Button>

        {hasResult && (
          <Button
            variant="light"
            color="teal"
            leftSection={<IconDownload size={16} />}
            onClick={onOpenExportModal}
          >
            Export MIDI
          </Button>
        )}

        <Tooltip label="Settings & Parameters" withArrow>
          <Button
            variant="default"
            leftSection={<IconSettings size={16} />}
            onClick={onOpenSettingsModal}
          >
            Settings
          </Button>
        </Tooltip>
      </Group>
    </Paper>
  );
}
