import React, { useState, useEffect } from "react";
import {
  Modal,
  Card,
  Group,
  Stack,
  Text,
  Badge,
  Button,
  TextInput,
  ThemeIcon,
  ScrollArea,
  Code,
  Loader,
  Box,
} from "@mantine/core";
import {
  IconFolder,
  IconSearch,
  IconRefresh,
  IconClock,
  IconCalendar,
  IconTrash,
  IconFileMusic,
  IconHeadphones,
  IconFolderOpen,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { fetchSessions, deleteSession } from "../utils/api";

export default function SessionsModal({
  activeSessionId,
  onClose,
  onSelectSession,
  onSessionDeleted,
}) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const res = await fetchSessions();
      setSessions(res.sessions || []);
    } catch (err) {
      notifications.show({
        title: "Failed to Load Sessions",
        message: err.message,
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleDelete = async (e, sessionId) => {
    e.stopPropagation();
    try {
      setDeletingId(sessionId);
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      notifications.show({
        title: "Session Deleted",
        message: `Session ${sessionId} was permanently removed.`,
        color: "teal",
      });
      if (onSessionDeleted) {
        onSessionDeleted(sessionId);
      }
    } catch (err) {
      notifications.show({
        title: "Delete Failed",
        message: err.message,
        color: "red",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const formatDuration = (secs) => {
    if (!secs || secs <= 0) return "--:--";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "";
    const d = new Date(timestamp * 1000);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const filteredSessions = sessions.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.session_id.toLowerCase().includes(q) ||
      (s.filename && s.filename.toLowerCase().includes(q)) ||
      (s.stem_names && s.stem_names.some((n) => n.toLowerCase().includes(q)))
    );
  });

  return (
    <Modal
      opened={true}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ThemeIcon size="md" variant="light" color="teal">
            <IconFolder size={18} />
          </ThemeIcon>
          <Text fw={700} size="lg">Project Sessions & Output History</Text>
        </Group>
      }
      size="xl"
      radius="md"
    >
      <Stack gap="sm">
        <Group gap="xs">
          <TextInput
            placeholder="Search sessions by audio filename, ID, or stem..."
            leftSection={<IconSearch size={15} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: 1 }}
            size="sm"
          />
          <Button
            variant="default"
            size="sm"
            leftSection={<IconRefresh size={14} />}
            onClick={loadSessions}
            loading={loading}
          >
            Refresh
          </Button>
          {window.stemidiAPI?.openSessionsFolder && (
            <Button
              variant="light"
              color="teal"
              size="sm"
              leftSection={<IconFolderOpen size={14} />}
              onClick={() => window.stemidiAPI.openSessionsFolder()}
            >
              Open Folder
            </Button>
          )}
        </Group>

        <ScrollArea.Autosize mah="60vh" type="scroll">
          {loading ? (
            <Box py="xl" ta="center">
              <Loader size="md" color="teal" mb="xs" />
              <Text size="sm" c="dimmed">Loading past sessions...</Text>
            </Box>
          ) : filteredSessions.length === 0 ? (
            <Box py="xl" ta="center">
              <Text size="sm" c="dimmed">
                {search ? "No sessions match your search query." : "No saved sessions found in output folder."}
              </Text>
            </Box>
          ) : (
            <Stack gap="xs">
              {filteredSessions.map((s) => {
                const isActive = s.session_id === activeSessionId;
                return (
                  <Card
                    key={s.session_id}
                    withBorder
                    padding="sm"
                    radius="md"
                    style={{
                      borderColor: isActive ? "var(--mantine-color-teal-6)" : undefined,
                      backgroundColor: isActive ? "rgba(18, 184, 134, 0.08)" : undefined,
                    }}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" mb={4} wrap="wrap">
                          <Text fw={700} size="sm" c={isActive ? "teal.4" : "white"}>
                            {s.filename}
                          </Text>
                          {isActive && (
                            <Badge color="teal" variant="filled" size="xs">
                              ACTIVE
                            </Badge>
                          )}
                          <Code fz="xs">{s.session_id}</Code>
                        </Group>

                        <Group gap="md" wrap="wrap">
                          <Group gap={4}>
                            <IconClock size={13} style={{ opacity: 0.6 }} />
                            <Text size="xs" c="dimmed">{formatDuration(s.duration)}</Text>
                          </Group>
                          <Group gap={4}>
                            <IconCalendar size={13} style={{ opacity: 0.6 }} />
                            <Text size="xs" c="dimmed">{formatDate(s.created_at)}</Text>
                          </Group>
                          {s.stems_count > 0 && (
                            <Group gap={4}>
                              <IconHeadphones size={13} style={{ color: "var(--mantine-color-teal-4)" }} />
                              <Text size="xs" c="teal.4">
                                {s.stems_count} Stems ({s.stem_names.join(", ")})
                              </Text>
                            </Group>
                          )}
                          {s.has_midi && (
                            <Group gap={4}>
                              <IconFileMusic size={13} style={{ color: "var(--mantine-color-green-4)" }} />
                              <Text size="xs" c="green.4">MIDI Ready</Text>
                            </Group>
                          )}
                        </Group>
                      </Box>

                      <Group gap="xs" wrap="nowrap">
                        <Button
                          size="xs"
                          variant={isActive ? "default" : "light"}
                          color="teal"
                          leftSection={<IconFolderOpen size={14} />}
                          onClick={() => onSelectSession(s.session_id)}
                          disabled={isActive}
                        >
                          {isActive ? "Active" : "Reopen"}
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          loading={deletingId === s.session_id}
                          onClick={(e) => handleDelete(e, s.session_id)}
                        >
                          Delete
                        </Button>
                      </Group>
                    </Group>
                  </Card>
                );
              })}
            </Stack>
          )}
        </ScrollArea.Autosize>

        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
