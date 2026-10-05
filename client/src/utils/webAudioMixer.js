/**
 * WebAudioMixer - Studio-grade multitrack audio engine for SteMidi Studio.
 *
 * Replaces multiple HTML5 <audio> elements to solve the browser HTTP/1.1
 * 6-connection per host limit, eliminates TCP socket blocking (0 B / Blocked),
 * prevents NS_BINDING_ABORTED errors, and provides sample-accurate synchronized
 * multitrack playback.
 */
export class WebAudioMixer {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.tracks = new Map(); // id -> { id, url, buffer, gainNode, sourceNode, loadingPromise, abortController, volume, muted, solo }
    this.isPlaying = false;
    this.activeTrackIds = new Set();
    this.playbackStartTime = 0; // audioCtx.currentTime when playback started
    this.startOffset = 0; // track position in seconds when started
    this.duration = 0;
    this.onTimeUpdate = null;
    this.onEnded = null;
    this.animFrameId = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        console.error("[WebAudioMixer] Web Audio API is not supported in this browser.");
        return null;
      }
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch((e) => console.warn("[WebAudioMixer] Context resume failed:", e));
    }
    return this.ctx;
  }

  async loadTrack(id, url) {
    this.ensureContext();
    if (!this.ctx) return null;

    let track = this.tracks.get(id);
    if (!track) {
      const gainNode = this.ctx.createGain();
      gainNode.connect(this.masterGain);
      track = {
        id,
        url,
        buffer: null,
        gainNode,
        sourceNode: null,
        loadingPromise: null,
        abortController: null,
        volume: 0.8,
        muted: false,
        solo: false,
      };
      this.tracks.set(id, track);
    }

    // Return cached buffer if URL has not changed
    if (track.buffer && track.url === url) {
      return track.buffer;
    }

    // If currently loading this exact URL, return the ongoing promise
    if (track.loadingPromise && track.url === url) {
      return track.loadingPromise;
    }

    // Abort any prior request for a different URL
    if (track.abortController) {
      track.abortController.abort();
    }

    track.url = url;
    const controller = new AbortController();
    track.abortController = controller;

    track.loadingPromise = (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
        track.buffer = audioBuf;
        if (audioBuf.duration > this.duration) {
          this.duration = audioBuf.duration;
        }
        return audioBuf;
      } catch (err) {
        if (err.name !== "AbortError") {
          console.warn(`[WebAudioMixer] Failed to load track '${id}':`, err);
        }
        return null;
      } finally {
        track.loadingPromise = null;
        track.abortController = null;
      }
    })();

    return track.loadingPromise;
  }

  /**
   * Preload tracks sequentially or with max concurrency of 2
   * to ensure no connection congestion.
   */
  async preloadTracks(trackList) {
    const queue = [...trackList];
    const concurrency = 2;
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item && item.id && item.url) {
          await this.loadTrack(item.id, item.url);
        }
      }
    });
    await Promise.all(workers);
  }

  updateAllTracksState(stateMap) {
    if (!stateMap) return;
    const hasSolo = Object.values(stateMap).some((s) => s?.solo);

    for (const [id, track] of this.tracks.entries()) {
      const state = stateMap[id] || {};
      const vol = state.volume ?? 0.8;
      const isMuted = !!state.muted;
      const isSolo = !!state.solo;

      track.volume = vol;
      track.muted = isMuted;
      track.solo = isSolo;

      let targetGain = vol;
      if (hasSolo) {
        targetGain = isSolo ? vol : 0;
      } else if (isMuted) {
        targetGain = 0;
      }

      if (this.ctx) {
        track.gainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.015);
      } else {
        track.gainNode.gain.value = targetGain;
      }
    }
  }

  async play(trackIds, offset = 0, { onTimeUpdate, onEnded } = {}) {
    this.ensureContext();
    if (!this.ctx) return;

    this.stopSources();
    this.onTimeUpdate = onTimeUpdate || null;
    this.onEnded = onEnded || null;
    this.activeTrackIds = new Set(trackIds);

    // Ensure all required tracks are buffered
    await Promise.all(
      trackIds.map(async (id) => {
        const track = this.tracks.get(id);
        if (track && !track.buffer && track.url) {
          await this.loadTrack(id, track.url);
        }
      })
    );

    const now = this.ctx.currentTime;
    this.playbackStartTime = now;
    this.startOffset = Math.max(0, offset);
    this.isPlaying = true;

    for (const id of trackIds) {
      const track = this.tracks.get(id);
      if (track && track.buffer) {
        try {
          const source = this.ctx.createBufferSource();
          source.buffer = track.buffer;
          source.connect(track.gainNode);
          source.start(now, this.startOffset);
          track.sourceNode = source;
        } catch (e) {
          console.warn(`[WebAudioMixer] Failed to start source for track '${id}':`, e);
        }
      }
    }

    this._startTimeLoop();
  }

  pause() {
    const current = this.getCurrentTime();
    this.stopSources();
    this.isPlaying = false;
    this.startOffset = current;
    return current;
  }

  seek(newTime) {
    this.startOffset = Math.max(0, newTime);
    if (this.isPlaying) {
      const activeIds = Array.from(this.activeTrackIds);
      this.play(activeIds, this.startOffset, {
        onTimeUpdate: this.onTimeUpdate,
        onEnded: this.onEnded,
      });
    } else {
      if (this.onTimeUpdate) {
        this.onTimeUpdate(this.startOffset);
      }
    }
  }

  stopSources() {
    this._stopTimeLoop();
    for (const track of this.tracks.values()) {
      if (track.sourceNode) {
        try {
          track.sourceNode.stop();
          track.sourceNode.disconnect();
        } catch (_) {}
        track.sourceNode = null;
      }
    }
    this.activeTrackIds.clear();
  }

  getCurrentTime() {
    if (!this.isPlaying || !this.ctx) {
      return this.startOffset;
    }
    const elapsed = this.ctx.currentTime - this.playbackStartTime;
    return this.startOffset + elapsed;
  }

  _startTimeLoop() {
    this._stopTimeLoop();
    let lastEmit = 0;
    const tick = (now) => {
      if (!this.isPlaying) return;
      const t = this.getCurrentTime();
      if (this.duration > 0 && t >= this.duration) {
        this.pause();
        if (this.onEnded) this.onEnded();
        return;
      }
      // Throttle UI timer updates to ~20 FPS (>= 50ms) to prevent high-Hz iGPU compositing churn
      if (now - lastEmit >= 50) {
        lastEmit = now;
        if (this.onTimeUpdate) {
          this.onTimeUpdate(t);
        }
      }
      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  _stopTimeLoop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  destroy() {
    this.stopSources();
    for (const track of this.tracks.values()) {
      if (track.abortController) {
        track.abortController.abort();
      }
    }
    this.tracks.clear();
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch (_) {}
      this.ctx = null;
    }
  }
}
