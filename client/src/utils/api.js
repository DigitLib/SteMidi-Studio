const BASE_URL = "/api";

export async function fetchStatus() {
  const res = await fetch(`${BASE_URL}/status`);
  if (!res.ok) throw new Error("Failed to fetch system status");
  return await res.json();
}

export async function uploadAudio(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Failed to upload audio");
  return await res.json();
}

export async function uploadAudioPath(filePath) {
  const res = await fetch(`${BASE_URL}/upload-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: filePath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to load audio file");
  }
  return await res.json();
}

export async function startTranscription(sessionId, options = {}) {
  const formData = new FormData();
  if (options.device) formData.append("device", options.device);
  if (options.targetStem) formData.append("target_stem", options.targetStem);
  if (options.muscriptorModel) formData.append("muscriptor_model", options.muscriptorModel);
  if (options.muscriptorInstruments) {
    const instStr = Array.isArray(options.muscriptorInstruments)
      ? options.muscriptorInstruments.join(",")
      : options.muscriptorInstruments;
    formData.append("muscriptor_instruments", instStr);
  }
  if (options.manualTempo) {
    formData.append("manual_tempo", options.manualTempo);
  }
  if (options.singleTrack) {
    formData.append("single_track", "true");
  }
  if (options.cfgCoef !== undefined && options.cfgCoef !== null) {
    formData.append("cfg_coef", options.cfgCoef.toString());
  }
  if (options.maxGenLen !== undefined && options.maxGenLen !== null) {
    formData.append("max_gen_len", options.maxGenLen.toString());
  }

  const res = await fetch(`${BASE_URL}/transcribe/${sessionId}`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Failed to start transcription");
  return await res.json();
}

export async function fetchMuscriptorInstruments() {
  const res = await fetch(`${BASE_URL}/models/muscriptor_instruments`);
  if (!res.ok) throw new Error("Failed to fetch MuScriptor instruments");
  return await res.json();
}

export async function startStemSeparation(
  sessionId,
  modelName = "bs_roformer_mega_53stem",
  device = "auto",
  instruments = null,
  quality = "high_quality"
) {
  const formData = new FormData();
  formData.append("model_name", "bs_roformer_mega_53stem");
  formData.append("device", device);
  formData.append("quality", quality);
  if (instruments && instruments.length > 0) {
    formData.append("instruments", Array.isArray(instruments) ? instruments.join(",") : instruments);
  }

  const res = await fetch(`${BASE_URL}/separate/${sessionId}`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Failed to start stem separation");
  return await res.json();
}

export async function fetchMegaInstruments() {
  const res = await fetch(`${BASE_URL}/models/mega_instruments`);
  if (!res.ok) throw new Error("Failed to fetch mega instruments");
  return await res.json();
}

export async function fetchStems(sessionId) {
  const res = await fetch(`${BASE_URL}/stems/${sessionId}`);
  if (!res.ok) throw new Error("Failed to fetch stems");
  return await res.json();
}

export async function getSession(sessionId) {
  const res = await fetch(`${BASE_URL}/session/${sessionId}`);
  if (!res.ok) throw new Error("Failed to get session");
  return await res.json();
}

export async function fetchSessions() {
  const res = await fetch(`${BASE_URL}/sessions`);
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return await res.json();
}

export async function deleteSession(sessionId) {
  const res = await fetch(`${BASE_URL}/session/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete session");
  return await res.json();
}

export async function deleteStems(sessionId) {
  let res = await fetch(`${BASE_URL}/stems/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    res = await fetch(`${BASE_URL}/session/${sessionId}/stems`, {
      method: "DELETE",
    });
  }
  if (!res.ok) {
    let msg = "Failed to delete stems";
    try {
      const data = await res.json();
      if (data && data.detail) msg = data.detail;
    } catch {}
    throw new Error(msg);
  }
  return await res.json();
}

export async function deleteSingleStem(sessionId, stemName) {
  const res = await fetch(`${BASE_URL}/stems/${sessionId}/${encodeURIComponent(stemName)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    let msg = "Failed to delete stem";
    try {
      const data = await res.json();
      if (data && data.detail) msg = data.detail;
    } catch {}
    throw new Error(msg);
  }
  return await res.json();
}

export function connectProgressWebSocket(sessionId, onMessage, onError) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const ws = new WebSocket(`${protocol}//${host}/api/ws/${sessionId}`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (err) {
      console.error("WebSocket message parse error", err);
    }
  };

  ws.onerror = (err) => {
    if (onError) onError(err);
  };

  return ws;
}

export async function unloadModels() {
  const res = await fetch(`${BASE_URL}/models/unload`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to unload models");
  return await res.json();
}

export async function purgeVRAM() {
  const res = await fetch(`${BASE_URL}/purge-vram`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to purge VRAM");
  return await res.json();
}

export async function updateSessionMidi(sessionId, payload) {
  const res = await fetch(`${BASE_URL}/session/${sessionId}/update_midi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to save MIDI edits to session");
  return await res.json();
}
