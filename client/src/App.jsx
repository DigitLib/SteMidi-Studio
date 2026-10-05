import React, { useEffect, useState } from "react";
import {
  Paper,
  Group,
  Text,
  Badge,
  Loader,
  Tabs,
  Box,
} from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconPiano,
  IconCheck,
  IconAlertCircle,
  IconSparkles,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

import TopNav from "./components/TopNav";
import WaveformPlayer from "./components/WaveformPlayer";
import PianoRoll from "./components/PianoRoll";
import StemsMixer from "./components/StemsMixer";
import ModelHubModal from "./components/ModelHubModal";
import ExportModal from "./components/ExportModal";
import TranscriptionSettingsModal from "./components/TranscriptionSettingsModal";
import SessionsModal from "./components/SessionsModal";
import {
  fetchStatus,
  uploadAudio,
  uploadAudioPath,
  startTranscription,
  connectProgressWebSocket,
  getSession,
  purgeVRAM,
} from "./utils/api";

export default function App() {
  const [status, setStatus] = useState(null);
  const [session, setSession] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState("stems"); // "stems", "pianoroll", "analysis"
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [showModelModal, setShowModelModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0.85);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [settings, setSettings] = useState({
    device: "auto",
    targetStem: "original",
    muscriptorModel: "large",
    muscriptorInstruments: [],
    manualTempo: "",
    singleTrack: true,
  });
  // Transcribed stem currently loaded in PianoRoll (e.g. "saxophone")
  const [transcribedStemId, setTranscribedStemId] = useState(null);
  // Audio source mode in PianoRoll: "stem" (isolated stem audio) or "mix" (full audio mix)
  const [audioSourceMode, setAudioSourceMode] = useState("stem");

  const availableStemForPianoRoll =
    transcribedStemId || (session?.result?.target_stem && session.result.target_stem !== "original" ? session.result.target_stem : null);

  const effectiveStemForPlayer =
    activeTab === "pianoroll" && audioSourceMode === "stem"
      ? availableStemForPianoRoll
      : null;

  // Load system status on mount
  useEffect(() => {
    refreshStatus();
  }, []);

  const refreshStatus = async () => {
    try {
      const data = await fetchStatus();
      setStatus(data);
    } catch (err) {
      console.error("Status load failed", err);
    }
  };

  // Spacebar hotkey to play/pause
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === "Space" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleUpload = async (file) => {
    try {
      setProgressMsg("Uploading and processing audio waveform...");
      const sess = await uploadAudio(file);
      setSession(sess);
      setTranscribedStemId(null);
      setAudioSourceMode("mix");
      setCurrentTime(0);
      setIsPlaying(false);
      setActiveTab("stems");
      setProgressMsg("");
      notifications.show({
        title: "Audio Uploaded",
        message: `Loaded "${file.name}" into Studio session.`,
        color: "teal",
        icon: <IconCheck size={16} />,
      });
    } catch (err) {
      notifications.show({
        title: "Upload Failed",
        message: err.message,
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
    }
  };

  const handleUploadPath = async (filePath) => {
    try {
      const fileName = filePath.split(/[/\\]/).pop();
      setProgressMsg(`Importing "${fileName}"...`);
      const sess = await uploadAudioPath(filePath);
      setSession(sess);
      setTranscribedStemId(null);
      setAudioSourceMode("mix");
      setCurrentTime(0);
      setIsPlaying(false);
      setActiveTab("stems");
      setProgressMsg("");
      notifications.show({
        title: "Audio Imported",
        message: `Loaded "${fileName}" into Studio session.`,
        color: "teal",
        icon: <IconCheck size={16} />,
      });
    } catch (err) {
      setProgressMsg("");
      notifications.show({
        title: "Import Failed",
        message: err.message,
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
    }
  };

  // Electron Native Menu & Audio Import actions integration
  useEffect(() => {
    if (!window.stemidiAPI) return;

    const unsubs = [];

    // Direct path import from native file dialog
    if (window.stemidiAPI.onImportAudioPath) {
      unsubs.push(
        window.stemidiAPI.onImportAudioPath((filePath) => {
          handleUploadPath(filePath);
        })
      );
    }

    // Generic menu action handler
    if (window.stemidiAPI.onMenuAction) {
      unsubs.push(
        window.stemidiAPI.onMenuAction(async (action) => {
          if (action === "open-audio") {
            try {
              const res = await window.stemidiAPI.openAudioFileDialog();
              if (!res.canceled) {
                if (res.filePath) {
                  handleUploadPath(res.filePath);
                } else if (res.dataBase64) {
                  const byteCharacters = atob(res.dataBase64);
                  const byteNumbers = new Array(byteCharacters.length);
                  for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                  }
                  const byteArray = new Uint8Array(byteNumbers);
                  const blob = new Blob([byteArray], { type: "audio/wav" });
                  const file = new File([blob], res.fileName, { type: "audio/wav" });
                  handleUpload(file);
                }
              }
            } catch (err) {
              console.error("Native audio open failed", err);
            }
          } else if (action === "purge-vram") {
            try {
              await purgeVRAM();
              refreshStatus();
              notifications.show({
                title: "GPU VRAM Purged",
                message: "PyTorch CUDA cache cleared and inactive models unloaded.",
                color: "teal",
              });
            } catch (e) {
              notifications.show({
                title: "Purge Failed",
                message: e.message,
                color: "red",
              });
            }
          }
        })
      );
    }

    return () => {
      unsubs.forEach((fn) => fn && fn());
    };
  }, []);

  // Periodic polling fallback while isProcessing is true
  useEffect(() => {
    let pollTimer = null;
    if (isProcessing && session?.session_id) {
      pollTimer = setInterval(async () => {
        try {
          const updated = await getSession(session.session_id);
          if (updated.status === "completed" || updated.status === "error") {
            setIsProcessing(false);
            setProgressMsg("");
            setSession((prev) => ({
              ...updated,
              result: prev?.result || updated.result,
            }));
            clearInterval(pollTimer);
          }
        } catch (e) {}
      }, 3000);
    }
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [isProcessing, session?.session_id]);

  const handleTranscribe = async (targetStemOverride = null, customOptions = {}) => {
    if (!session) return;
    try {
      setIsProcessing(true);
      const chosenStem = typeof targetStemOverride === "string" ? targetStemOverride : (settings.targetStem || "original");
      const stemLabel = chosenStem === "original" ? "Full Audio Mix" : `${String(chosenStem).toUpperCase()} Stem`;
      setProgressMsg(`Initializing MuScriptor MIDI transcription (${stemLabel})...`);

      // Connect progress websocket
      connectProgressWebSocket(
        session.session_id,
        (event) => {
          if (event.type === "progress") {
            const data = event.data;
            if (data?.message) {
              setProgressMsg(data.message);
            }
          } else if (event.type === "status") {
            if (event.stage === "separating_stems") {
              setProgressMsg("⚡ Isolating audio stem with BS-RoFormer Mega...");
            } else if (event.stage === "loading_model") {
              setProgressMsg("Loading MuScriptor Medium PyTorch Safetensors...");
            } else if (event.stage === "transcribing") {
              setProgressMsg(`Transcribing ${stemLabel} directly to MIDI...`);
            } else if (event.stage === "building_midi") {
              setProgressMsg("Assembling Type 1 multi-track MIDI file...");
            }
          } else if (event.type === "completed") {
            setIsProcessing(false);
            setProgressMsg("");
            const completedResult = event.data;
            const targetStemDone = (completedResult && completedResult.target_stem && completedResult.target_stem !== "original")
              ? completedResult.target_stem
              : (chosenStem && chosenStem !== "original" ? chosenStem : null);

            // Update session result with newly transcribed MIDI
            if (completedResult) {
              setSession((prev) => ({
                ...prev,
                status: "completed",
                result: completedResult,
              }));
            }

            notifications.show({
              title: "Transcription Complete",
              message: `Generated multi-track MIDI with ${completedResult?.events_count || 0} note events.`,
              color: "teal",
              icon: <IconSparkles size={16} />,
            });

            // Immediately switch PianoRoll & Waveform Player to the newly transcribed stem audio
            if (targetStemDone) {
              setTranscribedStemId(targetStemDone);
              setAudioSourceMode("stem");
              setSettings((s) => ({ ...s, targetStem: targetStemDone }));
            } else {
              setTranscribedStemId(null);
              setAudioSourceMode("mix");
              setSettings((s) => ({ ...s, targetStem: "original" }));
            }
            setActiveTab("pianoroll");

            // Refresh session metadata (stems, peaks, flags) without clobbering the active result
            getSession(session.session_id).then((updated) => {
              if (updated) {
                setSession((prev) => ({
                  ...updated,
                  result: completedResult || prev?.result || updated.result,
                  status: "completed",
                }));
              }
            });
          } else if (event.type === "error") {
            setIsProcessing(false);
            setProgressMsg(`Transcription error: ${event.error}`);
            notifications.show({
              title: "Transcription Error",
              message: event.error,
              color: "red",
              icon: <IconAlertCircle size={16} />,
            });
          }
        },
        (err) => console.warn("WebSocket disconnected", err)
      );

      const chosenInstruments = customOptions.muscriptorInstruments !== undefined
        ? customOptions.muscriptorInstruments
        : (settings.muscriptorInstruments?.length ? settings.muscriptorInstruments : null);
      const chosenTempo = customOptions.manualTempo !== undefined
        ? customOptions.manualTempo
        : (settings.manualTempo || null);
      const chosenSingleTrack = customOptions.singleTrack !== undefined
        ? customOptions.singleTrack
        : (settings.singleTrack ?? true);
      const chosenModel = customOptions.muscriptorModel || settings.muscriptorModel || "large";

      await startTranscription(session.session_id, {
        device: settings.device || "auto",
        targetStem: chosenStem,
        muscriptorModel: chosenModel,
        muscriptorInstruments: chosenInstruments,
        manualTempo: chosenTempo,
        singleTrack: chosenSingleTrack,
        cfgCoef: customOptions.cfgCoef ?? 1.0,
        maxGenLen: customOptions.maxGenLen ?? 1024,
      });
    } catch (err) {
      setIsProcessing(false);
      notifications.show({
        title: "Transcription Trigger Failed",
        message: err.message,
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
    }
  };

  const handleViewStemScore = async (stemId) => {
    if (!session?.session_id) return;
    try {
      const res = await fetch(`/api/session/${session.session_id}/stem_result/${stemId}`);
      if (res.ok) {
        const stemData = await res.json();
        setSession((prev) => ({
          ...prev,
          result: stemData,
        }));
        setTranscribedStemId(stemId);
        setAudioSourceMode("stem");
        setSettings((s) => ({ ...s, targetStem: stemId }));
        setActiveTab("pianoroll");
      }
    } catch (e) {
      console.warn("Could not load stem result:", e);
    }
  };

  const stemsCount = session?.stems ? Object.keys(session.stems).length : 0;
  const notesCount = session?.result?.events?.length || 0;

  return (
    <div className="app-container">
      <TopNav
        status={status}
        session={session}
        isProcessing={isProcessing}
        onUpload={handleUpload}
        onTranscribe={handleTranscribe}
        onOpenModelModal={() => setShowModelModal(true)}
        onOpenExportModal={() => setShowExportModal(true)}
        onOpenSettingsModal={() => setShowSettingsModal(true)}
        onOpenSessionsModal={() => setShowSessionsModal(true)}
      />

      {/* Modern Progress Banner */}
      {isProcessing && (
        <Paper
          px="md"
          py={7}
          style={{
            background: "rgba(10, 16, 28, 0.98)",
            borderBottom: "1px solid rgba(18, 184, 134, 0.35)",
          }}
        >
          <Group justify="space-between">
            <Group gap="xs">
              <Loader size={14} color="teal" />
              <Text size="xs" fw={600} c="teal.4">
                {progressMsg || "Transcribing audio to MIDI..."}
              </Text>
            </Group>
            <Badge size="xs" color="teal" variant="light">
              Processing
            </Badge>
          </Group>
        </Paper>
      )}

      <div className="workspace">
        {/* Waveform Player & Master Transport */}
        <WaveformPlayer
          session={session}
          activeStemId={effectiveStemForPlayer}
          availableStemId={activeTab === "pianoroll" ? availableStemForPianoRoll : null}
          audioSourceMode={audioSourceMode}
          onSelectAudioSource={setAudioSourceMode}
          activeTab={activeTab}
          currentTime={currentTime}
          onTimeUpdate={(t) => setCurrentTime(t)}
          isPlaying={isPlaying}
          onPlayPause={(p) => setIsPlaying(p)}
          volume={audioVolume}
          muted={isAudioMuted}
        />

        {/* Studio Workspace Tabs with Mantine Tabs */}
        <Box px="md" pt="xs" style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border-subtle)" }}>
          <Tabs value={activeTab} onChange={setActiveTab} variant="pills" radius="sm">
            <Tabs.List>
              <Tabs.Tab
                value="stems"
                leftSection={<IconAdjustmentsHorizontal size={16} />}
                rightSection={
                  stemsCount > 0 ? (
                    <Badge size="xs" variant="light" color="teal" circle>
                      {stemsCount}
                    </Badge>
                  ) : null
                }
              >
                Stems Separation & Mixer
              </Tabs.Tab>

              <Tabs.Tab
                value="pianoroll"
                leftSection={<IconPiano size={16} />}
                rightSection={
                  notesCount > 0 ? (
                    <Badge size="xs" variant="light" color="green">
                      {notesCount}
                    </Badge>
                  ) : null
                }
              >
                Multi-Track Piano Roll & MIDI
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>
        </Box>

        {/* Workspace Tab Content */}
        <div className="tab-content">
          <div
            style={{
              display: activeTab === "stems" ? "flex" : "none",
              flexDirection: "column",
              flex: 1,
              height: "100%",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <StemsMixer
              session={session}
              isProcessing={isProcessing}
              currentTime={currentTime}
              onTimeUpdate={setCurrentTime}
              isPlaying={isPlaying}
              onPlayPause={setIsPlaying}
              onTranscribeStem={(stemId, customOpts) => {
                setSettings((s) => ({ ...s, targetStem: stemId }));
                handleTranscribe(stemId, customOpts);
              }}
              onViewStemScore={handleViewStemScore}
              onSessionUpdate={() => {
                if (session?.session_id) {
                  getSession(session.session_id).then((updated) => setSession(updated));
                }
              }}
            />
          </div>

          <div
            style={{
              display: activeTab === "pianoroll" ? "flex" : "none",
              flexDirection: "column",
              flex: 1,
              height: "100%",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <PianoRoll
              session={session}
              isActive={activeTab === "pianoroll"}
              availableStemId={availableStemForPianoRoll}
              audioSourceMode={audioSourceMode}
              onToggleAudioSource={setAudioSourceMode}
              onSelectStemScore={handleViewStemScore}
              currentTime={currentTime}
              onTimeUpdate={setCurrentTime}
              isPlaying={isPlaying}
              onPlayPause={setIsPlaying}
              audioVolume={audioVolume}
              onVolumeChange={setAudioVolume}
              isAudioMuted={isAudioMuted}
              onMuteChange={setIsAudioMuted}
              onSessionUpdate={() => {
                if (session?.session_id) {
                  getSession(session.session_id).then((updated) => setSession(updated));
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Modals */}
      {showModelModal && (
        <ModelHubModal
          status={status}
          onClose={() => setShowModelModal(false)}
          onRefreshStatus={refreshStatus}
        />
      )}

      {showExportModal && (
        <ExportModal
          session={session}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {showSettingsModal && (
        <TranscriptionSettingsModal
          settings={settings}
          session={session}
          onUpdateSettings={(newVals) => setSettings((s) => ({ ...s, ...newVals }))}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {showSessionsModal && (
        <SessionsModal
          activeSessionId={session?.session_id}
          onClose={() => setShowSessionsModal(false)}
          onSelectSession={async (sessId) => {
            try {
              setProgressMsg("Loading project session...");
              const loaded = await getSession(sessId);
              setSession(loaded);
              setCurrentTime(0);
              setIsPlaying(false);
              setShowSessionsModal(false);
              setProgressMsg("");
              if (loaded?.result) {
                if (loaded.result.target_stem && loaded.result.target_stem !== "original") {
                  setTranscribedStemId(loaded.result.target_stem);
                  setAudioSourceMode("stem");
                } else {
                  setTranscribedStemId(null);
                  setAudioSourceMode("mix");
                }
                setActiveTab("pianoroll");
              } else if (loaded?.stems && Object.keys(loaded.stems).length > 0) {
                setTranscribedStemId(null);
                setAudioSourceMode("mix");
                setActiveTab("stems");
              } else {
                setTranscribedStemId(null);
                setAudioSourceMode("mix");
              }
              notifications.show({
                title: "Session Loaded",
                message: `Opened session "${loaded?.filename || sessId}".`,
                color: "teal",
              });
            } catch (err) {
              notifications.show({
                title: "Failed to Load Session",
                message: err.message,
                color: "red",
              });
            }
          }}
          onSessionDeleted={(delId) => {
            if (session?.session_id === delId) {
              setSession(null);
              setCurrentTime(0);
              setIsPlaying(false);
            }
          }}
        />
      )}
    </div>
  );
}
