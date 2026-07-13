(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const speedEl = document.getElementById("speed");
  const bonusEl = document.getElementById("bonus");
  const bonusPill = document.querySelector(".bonus-pill");
  const shieldEl = document.getElementById("shield");
  const shieldPill = document.getElementById("shieldPill");
  const soundToggleButton = document.getElementById("soundToggle");
  const overlay = document.getElementById("overlay");
  const overlayKicker = document.getElementById("overlayKicker");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const distanceResult = document.getElementById("distanceResult");
  const bonusResult = document.getElementById("bonusResult");
  const firstPlacePrize = document.getElementById("firstPlacePrize");
  const playerForm = document.getElementById("playerForm");
  const nicknameInput = document.getElementById("nickname");
  const startButton = document.getElementById("startButton");
  const startButtonLabel = startButton.querySelector("span");
  const leaderboardPanel = document.getElementById("leaderboardPanel");
  const refreshLeaderboardButton = document.getElementById("refreshLeaderboard");
  const leaderboardList = document.getElementById("leaderboardList");
  const leaderboardStatus = document.getElementById("leaderboardStatus");
  const leaderboardModal = document.getElementById("leaderboardModal");
  const leaderboardDialog = leaderboardModal.querySelector(".leaderboard-dialog");
  const closeLeaderboardButton = document.getElementById("closeLeaderboard");
  const fullLeaderboardList = document.getElementById("fullLeaderboardList");
  const fullLeaderboardStatus = document.getElementById("fullLeaderboardStatus");
  const myLeaderboardRank = document.getElementById("myLeaderboardRank");
  const myLeaderboardDetail = document.getElementById("myLeaderboardDetail");
  const jumpToMyRankButton = document.getElementById("jumpToMyRank");

  const STORAGE_KEY = "ski-downhill-best-v1";
  const PLAYER_NAME_KEY = "ski-downhill-player-name-v1";
  const LOCAL_LEADERBOARD_KEY = "ski-downhill-local-leaderboard-v1";
  const SOUND_MUTED_KEY = "ski-downhill-sound-muted-v1";
  const SOUND_MASTER_GAIN = 0.3;
  const SKI_LOOP_SRC = "./assets/ski-loop.wav";
  const LEADERBOARD_LIMIT = 10;
  const LEADERBOARD_FETCH_LIMIT = 25;
  const LEADERBOARD_FULL_LIMIT = 1000;
  const SCORE_SUBMIT_TIMEOUT_MS = 8000;
  const LEADERBOARD_NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, max-age=0",
    Pragma: "no-cache",
  };
  const BASE_SPEED = 8.5;
  const MAX_SPEED = 29;
  const FAST_DROP_MULTIPLIER = 1.55;
  const PX_PER_METER = 14;
  const OBSTACLE_HALF_WIDTH = 1250;
  const PLAYER_RADIUS = 13;
  const FLAKE_SCORE = 50;
  const SHIELD_MAX_CHARGES = 1;
  const TWO_PI = Math.PI * 2;

  const skierSprites = {
    straight: { image: loadSprite("./assets/skier-straight.png"), mirror: false },
    left: { image: loadSprite("./assets/skier-left.png"), mirror: false },
    right: { image: loadSprite("./assets/skier-left.png"), mirror: true },
    boost: { image: loadSprite("./assets/skier-boost.png"), mirror: false },
  };
  const snowflakeSprite = loadSprite("./assets/snowflake-pickup.png");

  const obstacleSpecs = {
    tree: { radius: 19, hit: 12 },
    rock: { radius: 18, hit: 12 },
    drift: { radius: 22, hit: 11 },
  };

  const supabaseClient = createSupabaseClient(window.SKI_DOWNHILL_CONFIG || {});

  const state = {
    mode: "ready",
    width: 0,
    height: 0,
    dpr: 1,
    lastTime: 0,
    distance: 0,
    speed: 0,
    playerX: 0,
    lateralVelocity: 0,
    steer: 0,
    fastDrop: false,
    keyLeft: false,
    keyRight: false,
    pointerSides: new Map(),
    lastSoundInput: "idle",
    rows: [],
    bonusScore: 0,
    shieldCharges: 0,
    invulnerableTime: 0,
    floaters: [],
    nextRowY: 20,
    safeCenter: 0,
    best: readBest(),
    playerName: readPlayerName(),
    leaderboardOnline: true,
    leaderboardRequestId: 0,
    fullLeaderboardRequestId: 0,
    idleTime: 0,
    deathDistance: 0,
    newBest: false,
    scoreSubmitted: false,
    scoreSubmissionPending: false,
  };

  let leaderboardModalReturnFocus = null;
  let leaderboardModalHistoryActive = false;

  const sound = createSoundController();

  bestEl.textContent = state.best.toLocaleString("ko-KR");
  speedEl.textContent = "0";
  bonusEl.textContent = "0";
  shieldEl.textContent = "0";
  nicknameInput.value = state.playerName;
  updateSoundToggle();

  function loadSprite(src) {
    const image = new Image();
    image.src = src;
    return image;
  }

  function readBest() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const value = Number.parseInt(raw || "0", 10);
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }

  function sanitizeNickname(value) {
    if (typeof value !== "string") return "스키어";

    const cleaned = value
      .replace(/[<>]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12);

    return cleaned || "스키어";
  }

  function readPlayerName() {
    try {
      return sanitizeNickname(window.localStorage.getItem(PLAYER_NAME_KEY) || "스키어");
    } catch {
      return "스키어";
    }
  }

  function savePlayerName(value) {
    state.playerName = sanitizeNickname(value);
    nicknameInput.value = state.playerName;

    try {
      window.localStorage.setItem(PLAYER_NAME_KEY, state.playerName);
    } catch {
      // Nickname persistence is helpful, but not required to play.
    }
  }

  function saveBest(value) {
    state.best = Math.max(state.best, value);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(state.best));
    } catch {
      // Some embedded browsers block storage; the current run can still display the best score.
    }
    bestEl.textContent = state.best.toLocaleString("ko-KR");
  }

  function readSoundMuted() {
    try {
      return window.localStorage.getItem(SOUND_MUTED_KEY) === "1";
    } catch {
      return false;
    }
  }

  function saveSoundMuted(value) {
    try {
      window.localStorage.setItem(SOUND_MUTED_KEY, value ? "1" : "0");
    } catch {
      // Sound preference is optional.
    }
  }

  function createSoundController() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    let audio = null;
    let master = null;
    let muted = readSoundMuted();
    let skiBuffer = null;
    let skiBufferPromise = null;
    let skiGain = null;
    let skiHighpass = null;
    let skiLowpass = null;
    let skiPlaying = false;
    let skiSource = null;
    let turnNoiseBuffer = null;
    let activeTurnVoice = null;
    let lastTurnTime = -Infinity;

    function ensureAudio() {
      if (!AudioContextClass) return null;
      if (audio) return audio;

      audio = new AudioContextClass();
      master = audio.createGain();
      // Keep the mix comfortably audible on phone speakers without pushing the
      // combined boost/crash effects into clipping.
      master.gain.value = muted ? 0 : SOUND_MASTER_GAIN;
      master.connect(audio.destination);
      return audio;
    }

    function setMasterGain(value, at = 0) {
      if (!master || !audio) return;
      const now = audio.currentTime + at;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(value, now, 0.025);
    }

    function ensureSkiGain() {
      if (!audio || !master) return null;
      if (skiGain) return skiGain;

      skiGain = audio.createGain();
      skiHighpass = audio.createBiquadFilter();
      skiLowpass = audio.createBiquadFilter();

      skiGain.gain.value = 0;
      skiHighpass.type = "highpass";
      skiHighpass.frequency.value = 160;
      skiHighpass.Q.value = 0.45;
      skiLowpass.type = "lowpass";
      skiLowpass.frequency.value = 5600;
      skiLowpass.Q.value = 0.25;

      skiGain.connect(skiHighpass);
      skiHighpass.connect(skiLowpass);
      skiLowpass.connect(master);
      return skiGain;
    }

    function trimLoopBuffer(buffer) {
      if (!audio || buffer.length < 2) return buffer;

      const threshold = 0.003;
      const padding = 0;
      let start = 0;
      let end = buffer.length;

      for (let i = 0; i < buffer.length; i += 1) {
        let level = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
          level = Math.max(level, Math.abs(buffer.getChannelData(channel)[i]));
        }
        if (level > threshold) {
          start = Math.max(0, i - padding);
          break;
        }
      }

      for (let i = buffer.length - 1; i >= start; i -= 1) {
        let level = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
          level = Math.max(level, Math.abs(buffer.getChannelData(channel)[i]));
        }
        if (level > threshold) {
          end = Math.min(buffer.length, i + padding);
          break;
        }
      }

      const length = Math.max(1, end - start);
      if (length >= buffer.length - 2) return buffer;

      const trimmed = audio.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        trimmed.copyToChannel(buffer.getChannelData(channel).subarray(start, end), channel);
      }
      return trimmed;
    }

    function loadSkiBuffer() {
      const instance = ensureAudio();
      if (!instance) return Promise.reject(new Error("Audio unavailable"));
      if (skiBuffer) return Promise.resolve(skiBuffer);
      if (skiBufferPromise) return skiBufferPromise;

      skiBufferPromise = fetch(SKI_LOOP_SRC)
        .then((response) => {
          if (!response.ok) throw new Error("Ski loop unavailable");
          return response.arrayBuffer();
        })
        .then((arrayBuffer) => instance.decodeAudioData(arrayBuffer))
        .then((buffer) => {
          skiBuffer = trimLoopBuffer(buffer);
          return skiBuffer;
        })
        .finally(() => {
          skiBufferPromise = null;
        });

      return skiBufferPromise;
    }

    function startSkiLoop() {
      if (muted) return;

      const instance = ensureAudio();
      const gain = ensureSkiGain();
      if (!instance || !gain) return;

      if (instance.state === "suspended") {
        instance.resume()
          .then(startSkiLoop)
          .catch(() => {});
        return;
      }

      gain.gain.cancelScheduledValues(instance.currentTime);
      gain.gain.setTargetAtTime(0.07, instance.currentTime, 0.08);

      if (skiPlaying) return;
      skiPlaying = true;

      loadSkiBuffer()
        .then((buffer) => {
          if (!skiPlaying || muted || !audio) return;
          const source = audio.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          source.loopStart = 0;
          source.loopEnd = Math.max(0.05, buffer.duration - 0.002);
          source.connect(gain);
          source.onended = () => {
            if (skiSource === source) skiSource = null;
          };
          skiSource = source;
          source.start(audio.currentTime + 0.03);
        })
        .catch(() => {
          skiPlaying = false;
        });
    }

    function stopSkiLoop() {
      skiPlaying = false;

      if (!audio) return;
      if (skiGain) {
        skiGain.gain.cancelScheduledValues(audio.currentTime);
        skiGain.gain.setTargetAtTime(0, audio.currentTime, 0.045);
      }

      if (skiSource) {
        const source = skiSource;
        skiSource = null;
        try {
          source.stop(audio.currentTime + 0.18);
        } catch {
          // The source may already have ended.
        }
      }
    }

    function tone(frequency, duration, options = {}) {
      if (!audio || !master) return;
      const now = audio.currentTime + (options.delay || 0);
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const volume = options.volume || 0.18;

      oscillator.type = options.type || "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      if (options.to) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, options.to), now + duration);
      }

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.04);
    }

    function noise(duration, options = {}) {
      if (!audio || !master) return;
      const frameCount = Math.max(1, Math.floor(audio.sampleRate * duration));
      const buffer = audio.createBuffer(1, frameCount, audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frameCount; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / frameCount);
      }

      const source = audio.createBufferSource();
      const filter = audio.createBiquadFilter();
      const gain = audio.createGain();
      const now = audio.currentTime + (options.delay || 0);

      source.buffer = buffer;
      filter.type = options.filterType || "highpass";
      filter.frequency.setValueAtTime(options.frequency || 700, now);
      gain.gain.setValueAtTime(options.volume || 0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(now);
      source.stop(now + duration + 0.03);
    }

    function whoosh(duration, options = {}) {
      if (!audio || !master) return;
      const frameCount = Math.max(1, Math.floor(audio.sampleRate * duration));
      const buffer = audio.createBuffer(1, frameCount, audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frameCount; i += 1) {
        const progress = i / frameCount;
        const envelope = Math.sin(Math.PI * progress) ** 0.55;
        data[i] = (Math.random() * 2 - 1) * envelope;
      }

      const source = audio.createBufferSource();
      const filter = audio.createBiquadFilter();
      const gain = audio.createGain();
      const panner = audio.createStereoPanner ? audio.createStereoPanner() : null;
      const now = audio.currentTime + (options.delay || 0);
      const volume = options.volume || 0.07;

      source.buffer = buffer;
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(options.from || 950, now);
      filter.frequency.exponentialRampToValueAtTime(options.to || 3200, now + duration);
      filter.Q.value = options.q || 0.8;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + duration * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      source.connect(filter);
      filter.connect(gain);
      if (panner) {
        panner.pan.value = options.pan || 0;
        gain.connect(panner);
        panner.connect(master);
      } else {
        gain.connect(master);
      }

      source.start(now);
      source.stop(now + duration + 0.03);
    }

    function ensureTurnNoiseBuffer() {
      if (!audio) return null;
      if (turnNoiseBuffer) return turnNoiseBuffer;

      const duration = 1.4;
      const frameCount = Math.max(1, Math.floor(audio.sampleRate * duration));
      const buffer = audio.createBuffer(1, frameCount, audio.sampleRate);
      const data = buffer.getChannelData(0);
      let snowBody = 0;
      let previous = 0;

      for (let i = 0; i < frameCount; i += 1) {
        const white = Math.random() * 2 - 1;
        snowBody = snowBody * 0.965 + white * 0.035;
        const edgeGrain = white - previous;
        data[i] = clamp(white * 0.62 + snowBody * 1.35 + edgeGrain * 0.08, -1, 1);
        previous = white;
      }

      turnNoiseBuffer = buffer;
      return turnNoiseBuffer;
    }

    function fadeActiveTurn(now) {
      if (!activeTurnVoice) return;

      const voice = activeTurnVoice;
      activeTurnVoice = null;
      voice.output.gain.cancelScheduledValues(now);
      voice.output.gain.setValueAtTime(1, now);
      voice.output.gain.setTargetAtTime(0.0001, now, 0.025);

      try {
        voice.source.stop(now + 0.11);
      } catch {
        // A completed turn voice no longer needs to be stopped.
      }
    }

    function skiTurn(direction, options = {}) {
      if (!audio || !master) return;

      const buffer = ensureTurnNoiseBuffer();
      if (!buffer) return;

      const now = audio.currentTime + 0.003;
      if (now - lastTurnTime < 0.07) return;
      lastTurnTime = now;

      const speedProgress = clamp((state.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1);
      const duration = 0.225 + speedProgress * 0.035 + Math.random() * 0.015;
      const reversalBoost = options.reversal ? 1.08 : 1;
      const turnVolume = 1.65;
      const bodyPeak = (0.061 + speedProgress * 0.012) * reversalBoost * turnVolume;
      const source = audio.createBufferSource();
      const snowHighpass = audio.createBiquadFilter();
      const snowLowpass = audio.createBiquadFilter();
      const snowGain = audio.createGain();
      const edgeBandpass = audio.createBiquadFilter();
      const edgeGain = audio.createGain();
      const panner = audio.createStereoPanner ? audio.createStereoPanner() : null;
      const output = audio.createGain();
      const offsetLimit = Math.max(0.01, buffer.duration - duration * 1.08);
      const offset = Math.random() * offsetLimit;

      fadeActiveTurn(now);

      source.buffer = buffer;
      source.playbackRate.value = 0.94 + Math.random() * 0.1;

      snowHighpass.type = "highpass";
      snowHighpass.frequency.value = 190;
      snowHighpass.Q.value = 0.45;

      snowLowpass.type = "lowpass";
      snowLowpass.frequency.setValueAtTime(1850, now);
      snowLowpass.frequency.exponentialRampToValueAtTime(4400 + speedProgress * 500, now + 0.055);
      snowLowpass.frequency.exponentialRampToValueAtTime(1650, now + duration);
      snowLowpass.Q.value = 0.45;

      snowGain.gain.setValueAtTime(0.0001, now);
      snowGain.gain.linearRampToValueAtTime(bodyPeak * 0.55, now + 0.018);
      snowGain.gain.linearRampToValueAtTime(bodyPeak, now + 0.052);
      snowGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      edgeBandpass.type = "bandpass";
      edgeBandpass.frequency.setValueAtTime(2400, now);
      edgeBandpass.frequency.exponentialRampToValueAtTime(4900, now + 0.06);
      edgeBandpass.frequency.exponentialRampToValueAtTime(2100, now + duration);
      edgeBandpass.Q.value = 0.62;

      edgeGain.gain.setValueAtTime(0.0001, now);
      edgeGain.gain.linearRampToValueAtTime(
        (0.021 + speedProgress * 0.006) * turnVolume,
        now + 0.05,
      );
      edgeGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.86);

      output.gain.value = 1;
      source.connect(snowHighpass);
      snowHighpass.connect(snowLowpass);
      snowLowpass.connect(snowGain);
      source.connect(edgeBandpass);
      edgeBandpass.connect(edgeGain);

      if (panner) {
        panner.pan.setValueAtTime(0, now);
        panner.pan.linearRampToValueAtTime(direction * 0.18, now + duration * 0.4);
        snowGain.connect(panner);
        edgeGain.connect(panner);
        panner.connect(output);
      } else {
        snowGain.connect(output);
        edgeGain.connect(output);
      }

      output.connect(master);
      activeTurnVoice = { source, output };
      source.onended = () => {
        if (activeTurnVoice && activeTurnVoice.source === source) {
          activeTurnVoice = null;
        }
      };
      source.start(now, offset);
      source.stop(now + duration + 0.03);
    }

    function schedule(name, options = {}) {
      if (muted) return;

      if (name === "turnLeft") {
        skiTurn(-1, options);
        return;
      }

      if (name === "turnRight") {
        skiTurn(1, options);
        return;
      }

      if (name === "boost") {
        whoosh(0.16, { from: 650, to: 3600, pan: 0, volume: 0.078, q: 0.72 });
        return;
      }

      if (name === "pickup") {
        tone(760, 0.07, { type: "sine", volume: 0.05 });
        tone(1160, 0.1, { type: "sine", volume: 0.04, delay: 0.045 });
        return;
      }

      if (name === "shield") {
        tone(420, 0.1, { type: "triangle", volume: 0.055 });
        tone(640, 0.14, { type: "triangle", volume: 0.05, delay: 0.08 });
        return;
      }

      if (name === "block") {
        tone(210, 0.12, { type: "sawtooth", volume: 0.05, to: 310 });
        tone(620, 0.16, { type: "triangle", volume: 0.045, delay: 0.05 });
        return;
      }

      if (name === "crash") {
        noise(0.24, { frequency: 240, filterType: "lowpass", volume: 0.08 });
        tone(140, 0.2, { type: "sawtooth", volume: 0.05, to: 78 });
        return;
      }

      if (name === "toggle") {
        tone(660, 0.07, { type: "sine", volume: 0.035 });
      }
    }

    return {
      isMuted() {
        return muted;
      },
      async unlock() {
        const instance = ensureAudio();
        if (!instance || instance.state !== "suspended") return;
        try {
          await instance.resume();
        } catch {
          // Browsers can reject resume outside direct user gestures.
        }
      },
      play(name, options = {}) {
        if (muted) return;
        const instance = ensureAudio();
        if (!instance) return;

        if (instance.state === "suspended") {
          instance.resume()
            .then(() => schedule(name, options))
            .catch(() => {});
          return;
        }

        schedule(name, options);
      },
      setMuted(value) {
        muted = Boolean(value);
        saveSoundMuted(muted);
        setMasterGain(muted ? 0 : SOUND_MASTER_GAIN);
        if (muted) stopSkiLoop();
        updateSoundToggle();
      },
      toggle() {
        this.setMuted(!muted);
        if (!muted) this.play("toggle");
      },
      startSkiLoop,
      stopSkiLoop,
    };
  }

  function updateSoundToggle() {
    const muted = sound.isMuted();
    soundToggleButton.classList.toggle("is-muted", muted);
    soundToggleButton.setAttribute("aria-label", muted ? "효과음 꺼짐" : "효과음 켜짐");
    soundToggleButton.setAttribute("aria-pressed", String(!muted));
  }

  function currentScore() {
    return Math.floor(state.distance) + state.bonusScore;
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function createSupabaseClient(config) {
    const supabaseUrl = typeof config.supabaseUrl === "string"
      ? config.supabaseUrl.replace(/\/+$/, "")
      : "";
    const supabaseAnonKey = typeof config.supabaseAnonKey === "string"
      ? config.supabaseAnonKey
      : "";

    if (!supabaseUrl || !supabaseAnonKey) return null;

    const baseHeaders = {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    };
    const readHeaders = {
      ...baseHeaders,
      ...LEADERBOARD_NO_CACHE_HEADERS,
    };

    return {
      async list(limit) {
        const query = new URLSearchParams({
          select: "nickname,score,distance,bonus,created_at",
          order: "score.desc,created_at.asc",
          limit: String(limit),
        });
        const response = await fetch(`${supabaseUrl}/rest/v1/leaderboard?${query}`, {
          headers: readHeaders,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Supabase leaderboard query failed");
        }

        return response.json();
      },
      async submit(entry) {
        const requestBody = JSON.stringify({
          p_nickname: entry.nickname,
          p_score: entry.score,
          p_distance: entry.distance,
          p_bonus: entry.bonus,
        });
        const response = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/submit_leaderboard_score_v2`, {
          method: "POST",
          headers: {
            ...baseHeaders,
            "Content-Type": "application/json",
          },
          body: requestBody,
        }, SCORE_SUBMIT_TIMEOUT_MS);

        if (response.ok) {
          const result = await response.json();
          if (!result || !Array.isArray(result.entries)) {
            throw new Error("Invalid Supabase score RPC response");
          }

          return {
            entries: result.entries,
            isNewFirstPlace: result.isNewFirstPlace === true,
          };
        }

        if (response.status !== 404) {
          throw new Error("Supabase score RPC failed");
        }

        const responseError = await response.json().catch(() => ({}));
        if (responseError.code !== "PGRST202") {
          throw new Error("Supabase score RPC unavailable");
        }

        const legacyResponse = await fetchWithTimeout(`${supabaseUrl}/rest/v1/rpc/submit_leaderboard_score`, {
          method: "POST",
          headers: {
            ...baseHeaders,
            "Content-Type": "application/json",
          },
          body: requestBody,
        }, SCORE_SUBMIT_TIMEOUT_MS);

        if (!legacyResponse.ok) {
          throw new Error("Supabase legacy score RPC failed");
        }

        return {
          entries: await legacyResponse.json(),
          isNewFirstPlace: false,
        };
      },
    };
  }

  function normalizeLeaderboardEntry(entry) {
    return {
      nickname: sanitizeNickname(entry && entry.nickname),
      score: Math.max(0, Number.parseInt(entry && entry.score, 10) || 0),
      distance: Math.max(0, Number.parseInt(entry && entry.distance, 10) || 0),
      bonus: Math.max(0, Number.parseInt(entry && entry.bonus, 10) || 0),
      createdAt: typeof (entry && entry.createdAt) === "string"
        ? entry.createdAt
        : typeof (entry && entry.created_at) === "string"
          ? entry.created_at
          : new Date().toISOString(),
    };
  }

  function sortLeaderboard(entries, limit = LEADERBOARD_LIMIT) {
    const normalizedLimit = Math.max(1, Number.parseInt(limit, 10) || LEADERBOARD_LIMIT);
    const seen = new Set();
    const sorted = entries
      .map(normalizeLeaderboardEntry)
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

    const deduped = [];
    for (const entry of sorted) {
      if (seen.has(entry.nickname)) continue;
      seen.add(entry.nickname);
      deduped.push(entry);
      if (deduped.length >= normalizedLimit) break;
    }

    return deduped;
  }

  function readLocalLeaderboard(limit = LEADERBOARD_LIMIT) {
    try {
      const raw = window.localStorage.getItem(LOCAL_LEADERBOARD_KEY);
      const parsed = JSON.parse(raw || "[]");
      return sortLeaderboard(Array.isArray(parsed) ? parsed : [], limit);
    } catch {
      return [];
    }
  }

  function saveLocalLeaderboardEntry(entry) {
    try {
      const entries = readLocalLeaderboard(LEADERBOARD_FULL_LIMIT);
      const nextEntry = normalizeLeaderboardEntry(entry);
      const previous = entries.find((item) => item.nickname === nextEntry.nickname);
      const nextEntries = previous && previous.score >= nextEntry.score
        ? entries
        : sortLeaderboard([
          ...entries.filter((item) => item.nickname !== nextEntry.nickname),
          nextEntry,
        ], LEADERBOARD_FULL_LIMIT);

      window.localStorage.setItem(LOCAL_LEADERBOARD_KEY, JSON.stringify(nextEntries));
      return nextEntries;
    } catch {
      return [];
    }
  }

  function setLeaderboardStatus(message) {
    leaderboardStatus.textContent = message;
  }

  function beginLeaderboardRequest(message) {
    state.leaderboardRequestId += 1;
    refreshLeaderboardButton.disabled = true;
    refreshLeaderboardButton.classList.add("is-loading");
    refreshLeaderboardButton.setAttribute("aria-label", "랭킹 불러오는 중");
    setLeaderboardStatus(message);
    return state.leaderboardRequestId;
  }

  function isCurrentLeaderboardRequest(requestId) {
    return requestId === state.leaderboardRequestId;
  }

  function finishLeaderboardRequest(requestId) {
    if (!isCurrentLeaderboardRequest(requestId)) return;
    refreshLeaderboardButton.disabled = false;
    refreshLeaderboardButton.classList.remove("is-loading");
    refreshLeaderboardButton.setAttribute("aria-label", "랭킹 새로고침");
  }

  function hideFirstPlacePrize() {
    firstPlacePrize.hidden = true;
  }

  function showFirstPlacePrize() {
    if (state.mode !== "gameover") return;
    firstPlacePrize.hidden = false;
  }

  function createLeaderboardItem(entry, index) {
    const item = document.createElement("li");
    if (entry.nickname === state.playerName) {
      item.classList.add("is-me");
      item.dataset.ownRank = String(index + 1);
    }

    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = `${index + 1}`;

    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = entry.nickname;
    if (entry.nickname === state.playerName) {
      const me = document.createElement("span");
      me.className = "leaderboard-me";
      me.textContent = "ME";
      name.append(me);
    }

    const score = document.createElement("span");
    score.className = "leaderboard-score";
    score.textContent = entry.score.toLocaleString("ko-KR");

    item.append(rank, name, score);
    return item;
  }

  function renderLeaderboard(entries) {
    const normalized = sortLeaderboard(entries);
    leaderboardList.replaceChildren();

    if (!normalized.length) {
      const item = document.createElement("li");
      item.className = "is-empty";
      item.textContent = "아직 등록된 기록이 없습니다.";
      leaderboardList.append(item);
      return;
    }

    normalized.forEach((entry, index) => {
      leaderboardList.append(createLeaderboardItem(entry, index));
    });
  }

  function renderFullLeaderboard(entries, statusMessage = "") {
    const normalized = sortLeaderboard(entries, LEADERBOARD_FULL_LIMIT);
    const ownIndex = normalized.findIndex((entry) => entry.nickname === state.playerName);
    fullLeaderboardList.replaceChildren();

    if (!normalized.length) {
      const item = document.createElement("li");
      item.className = "is-empty";
      item.textContent = "아직 등록된 기록이 없습니다.";
      fullLeaderboardList.append(item);
    } else {
      normalized.forEach((entry, index) => {
        fullLeaderboardList.append(createLeaderboardItem(entry, index));
      });
    }

    fullLeaderboardStatus.textContent = statusMessage || `전체 ${normalized.length.toLocaleString("ko-KR")}명`;

    if (ownIndex >= 0) {
      const ownEntry = normalized[ownIndex];
      myLeaderboardRank.textContent = `${(ownIndex + 1).toLocaleString("ko-KR")}위`;
      myLeaderboardDetail.textContent = `${ownEntry.nickname} · ${ownEntry.score.toLocaleString("ko-KR")}점`;
      jumpToMyRankButton.disabled = false;
      jumpToMyRankButton.textContent = "내 위치 보기";
      return;
    }

    myLeaderboardRank.textContent = "미등록";
    myLeaderboardDetail.textContent = `${state.playerName} 님의 완주 기록이 아직 없어요.`;
    jumpToMyRankButton.disabled = true;
    jumpToMyRankButton.textContent = "기록 없음";
  }

  function setFullLeaderboardLoading() {
    fullLeaderboardList.replaceChildren();
    const item = document.createElement("li");
    item.className = "is-empty";
    item.textContent = "전체 순위를 불러오는 중...";
    fullLeaderboardList.append(item);
    fullLeaderboardStatus.textContent = "전체 순위를 불러오는 중...";
    myLeaderboardRank.textContent = "—";
    myLeaderboardDetail.textContent = "내 기록을 확인하고 있어요.";
    jumpToMyRankButton.disabled = true;
    jumpToMyRankButton.textContent = "내 위치 보기";
  }

  async function loadFullLeaderboard() {
    state.fullLeaderboardRequestId += 1;
    const requestId = state.fullLeaderboardRequestId;
    setFullLeaderboardLoading();

    try {
      let entries;
      if (supabaseClient) {
        entries = await supabaseClient.list(LEADERBOARD_FULL_LIMIT);
      } else {
        const response = await fetch(`./api/leaderboard?limit=${LEADERBOARD_FULL_LIMIT}`, {
          headers: LEADERBOARD_NO_CACHE_HEADERS,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Leaderboard API unavailable");
        const data = await response.json();
        entries = data.entries;
      }

      if (requestId !== state.fullLeaderboardRequestId || leaderboardModal.hidden) return;
      renderFullLeaderboard(Array.isArray(entries) ? entries : []);
    } catch {
      if (requestId !== state.fullLeaderboardRequestId || leaderboardModal.hidden) return;
      renderFullLeaderboard(
        readLocalLeaderboard(LEADERBOARD_FULL_LIMIT),
        "오프라인에 저장된 순위입니다.",
      );
    }
  }

  function openLeaderboardModal() {
    if (!leaderboardModal.hidden) return;
    savePlayerName(nicknameInput.value);
    leaderboardModalReturnFocus = document.activeElement;
    leaderboardModal.hidden = false;
    document.body.classList.add("has-leaderboard-modal");

    try {
      window.history.pushState({ ...window.history.state, ssingLeaderboard: true }, "");
      leaderboardModalHistoryActive = true;
    } catch {
      leaderboardModalHistoryActive = false;
    }

    leaderboardDialog.focus({ preventScroll: true });
    void loadFullLeaderboard();
  }

  function closeLeaderboardModal(fromHistory = false) {
    if (leaderboardModal.hidden) return;
    leaderboardModal.hidden = true;
    document.body.classList.remove("has-leaderboard-modal");
    state.fullLeaderboardRequestId += 1;

    if (leaderboardModalHistoryActive && !fromHistory) {
      leaderboardModalHistoryActive = false;
      window.history.back();
    } else if (fromHistory) {
      leaderboardModalHistoryActive = false;
    }

    if (leaderboardModalReturnFocus instanceof HTMLElement && document.contains(leaderboardModalReturnFocus)) {
      leaderboardModalReturnFocus.focus({ preventScroll: true });
    }
    leaderboardModalReturnFocus = null;
  }

  function handleLeaderboardModalKeyDown(event) {
    if (leaderboardModal.hidden) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeLeaderboardModal();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = Array.from(
      leaderboardModal.querySelectorAll("button:not([disabled])"),
    );
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (document.activeElement === leaderboardDialog) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function loadLeaderboard(message = "") {
    const requestId = beginLeaderboardRequest(message);

    try {
      if (supabaseClient) {
        const entries = await supabaseClient.list(LEADERBOARD_FETCH_LIMIT);
        if (!isCurrentLeaderboardRequest(requestId)) return;
        state.leaderboardOnline = true;
        renderLeaderboard(Array.isArray(entries) ? entries : []);
        setLeaderboardStatus("");
        return;
      }

      const response = await fetch(`./api/leaderboard?limit=${LEADERBOARD_LIMIT}`, {
        headers: LEADERBOARD_NO_CACHE_HEADERS,
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Leaderboard API unavailable");
      }

      const data = await response.json();
      if (!isCurrentLeaderboardRequest(requestId)) return;
      state.leaderboardOnline = true;
      renderLeaderboard(Array.isArray(data.entries) ? data.entries : []);
      setLeaderboardStatus("");
    } catch {
      if (!isCurrentLeaderboardRequest(requestId)) return;
      state.leaderboardOnline = false;
      renderLeaderboard(readLocalLeaderboard());
      setLeaderboardStatus("오프라인 기록을 표시하고 있어요.");
    } finally {
      finishLeaderboardRequest(requestId);
    }
  }

  async function submitScore(score) {
    const requestId = beginLeaderboardRequest("기록 저장 중...");
    state.scoreSubmissionPending = true;
    startButton.disabled = true;
    startButtonLabel.textContent = "기록 확인 중...";
    const entry = {
      nickname: state.playerName,
      score,
      distance: Math.floor(state.distance),
      bonus: state.bonusScore,
      createdAt: new Date().toISOString(),
    };

    try {
      if (supabaseClient) {
        const submission = await supabaseClient.submit(entry);

        if (submission.isNewFirstPlace === true) showFirstPlacePrize();
        if (!isCurrentLeaderboardRequest(requestId)) return;
        const normalizedEntries = Array.isArray(submission.entries) ? submission.entries : [];
        state.leaderboardOnline = true;
        renderLeaderboard(normalizedEntries);
        setLeaderboardStatus("");
        if (!leaderboardModal.hidden) void loadFullLeaderboard();
        return;
      }

      const response = await fetch("./api/leaderboard", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(entry),
      });

      if (!response.ok) {
        throw new Error("Score submit failed");
      }

      const data = await response.json();
      if (!isCurrentLeaderboardRequest(requestId)) return;
      const normalizedEntries = Array.isArray(data.entries) ? data.entries : [];
      state.leaderboardOnline = true;
      renderLeaderboard(normalizedEntries);
      setLeaderboardStatus("");
      if (!leaderboardModal.hidden) void loadFullLeaderboard();
    } catch {
      const localEntries = saveLocalLeaderboardEntry(entry);
      if (!isCurrentLeaderboardRequest(requestId)) return;
      state.leaderboardOnline = false;
      renderLeaderboard(localEntries);
      setLeaderboardStatus("오프라인 기록으로 저장했어요.");
      if (!leaderboardModal.hidden) {
        renderFullLeaderboard(
          readLocalLeaderboard(LEADERBOARD_FULL_LIMIT),
          "오프라인에 저장된 순위입니다.",
        );
      }
    } finally {
      state.scoreSubmissionPending = false;
      startButton.disabled = false;
      if (state.mode === "gameover") {
        startButtonLabel.textContent = "한 번 더!";
      }
      finishLeaderboardRequest(requestId);
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function mixColor(a, b, t) {
    const ah = Number.parseInt(a.replace("#", ""), 16);
    const bh = Number.parseInt(b.replace("#", ""), 16);
    const ar = ah >> 16;
    const ag = (ah >> 8) & 255;
    const ab = ah & 255;
    const br = bh >> 16;
    const bg = (bh >> 8) & 255;
    const bb = bh & 255;
    const rr = Math.round(lerp(ar, br, t)).toString(16).padStart(2, "0");
    const rg = Math.round(lerp(ag, bg, t)).toString(16).padStart(2, "0");
    const rb = Math.round(lerp(ab, bb, t)).toString(16).padStart(2, "0");
    return `#${rr}${rg}${rb}`;
  }

  function hash(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
    return x - Math.floor(x);
  }

  function randomBetween(seed, min, max) {
    return min + (max - min) * hash(seed);
  }

  function isNearViewport(worldX, padding = 90) {
    return Math.abs(worldX - state.playerX) < state.width / 2 + padding;
  }

  function roundedRectPath(context, x, y, width, height, radius) {
    if (typeof context.roundRect === "function") {
      context.roundRect(x, y, width, height, radius);
      return;
    }

    const r = Math.min(radius, width / 2, height / 2);
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
  }

  function playerScreenY() {
    return clamp(state.height * 0.38, 210, state.height * 0.48);
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    state.width = Math.max(280, Math.round(rect.width));
    state.height = Math.max(420, Math.round(rect.height));
    state.dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  function setOverlay(mode) {
    overlay.dataset.mode = mode;

    if (mode === "running") {
      hideFirstPlacePrize();
      overlay.classList.add("is-hidden");
      overlay.classList.remove("is-splash");
      return;
    }

    overlay.classList.remove("is-hidden");

    if (mode === "ready") {
      hideFirstPlacePrize();
      overlay.classList.add("is-splash");
      overlayKicker.textContent = "HOW TO RIDE";
      overlayTitle.textContent = "씽씽 스키";
      overlayText.textContent = "터치한 쪽의 반대 방향으로 카빙하세요.";
      distanceResult.textContent = "0";
      bonusResult.textContent = "+0";
      startButtonLabel.textContent = "슬로프 출발!";
      return;
    }

    overlay.classList.remove("is-splash");
    overlayKicker.textContent = state.newBest ? "NEW BEST" : "RUN OVER";
    overlayTitle.textContent = `${state.deathDistance.toLocaleString("ko-KR")}점`;
    overlayText.textContent = state.newBest
      ? "최고 기록을 새로 썼어요!"
      : "아깝다! 바로 한 번 더 달려볼까요?";
    distanceResult.textContent = Math.floor(state.distance).toLocaleString("ko-KR");
    bonusResult.textContent = `+${state.bonusScore.toLocaleString("ko-KR")}`;
    startButtonLabel.textContent = "한 번 더!";
  }

  function resetRun() {
    if (state.scoreSubmissionPending) return;
    void sound.unlock();
    sound.startSkiLoop();
    savePlayerName(nicknameInput.value);
    state.mode = "running";
    state.distance = 0;
    state.speed = BASE_SPEED;
    state.playerX = 0;
    state.lateralVelocity = 0;
    state.steer = 0;
    state.fastDrop = false;
    state.lastSoundInput = "idle";
    state.pointerSides.clear();
    updateInputState();
    state.rows = [];
    state.bonusScore = 0;
    state.shieldCharges = 0;
    state.invulnerableTime = 0;
    state.floaters = [];
    state.nextRowY = 16;
    state.safeCenter = 0;
    state.deathDistance = 0;
    state.newBest = false;
    state.scoreSubmitted = false;
    generateRows();
    updateHud();
    setOverlay("running");
  }

  function gameOver() {
    state.mode = "gameover";
    state.deathDistance = currentScore();
    state.newBest = state.deathDistance > state.best;
    sound.stopSkiLoop();
    sound.play("crash");
    saveBest(state.deathDistance);
    hideFirstPlacePrize();
    setOverlay("gameover");
    if (!state.scoreSubmitted) {
      state.scoreSubmitted = true;
      void submitScore(state.deathDistance);
    }
  }

  function difficulty() {
    return clamp(state.distance / 720, 0, 1);
  }

  function rowSpacing(diff) {
    return lerp(15.5, 5.8, diff);
  }

  function safeGap(diff) {
    return lerp(142, 74, diff);
  }

  function introProgress(rowY) {
    return clamp((rowY - 16) / 110, 0, 1);
  }

  function nextObstacleType(seed, diff) {
    const roll = hash(seed);
    if (roll < 0.46 - diff * 0.1) return "tree";
    if (roll < 0.75) return "rock";
    return "drift";
  }

  function isBlockedByObstacle(items, x, y, clearance) {
    return items.some((item) => {
      const dx = item.x - x;
      const dy = item.y - y;
      return dx * dx + dy * dy < clearance * clearance;
    });
  }

  function createPickups(rowY, diff, gap, items) {
    const pickups = [];
    const seed = rowY * 1.37 + state.rows.length * 5.3;

    if (hash(seed + 3) < lerp(0.28, 0.4, diff)) {
      const x = state.safeCenter + randomBetween(seed + 11, -gap * 0.34, gap * 0.34);
      const y = rowY + randomBetween(seed + 17, -1.8, 1.8);

      if (!isBlockedByObstacle(items, x, y, 32)) {
        pickups.push({
          type: "flake",
          x,
          y,
          radius: 13,
          seed,
          collected: false,
        });
      }
    }

    if (state.distance > 55 && hash(seed + 41) < lerp(0.035, 0.052, diff)) {
      const x = state.safeCenter + randomBetween(seed + 43, -gap * 0.28, gap * 0.28);
      const y = rowY + randomBetween(seed + 47, -1.4, 1.4);

      if (!isBlockedByObstacle(items, x, y, 36)) {
        pickups.push({
          type: "shield",
          x,
          y,
          radius: 14,
          seed: seed + 41,
          collected: false,
        });
      }
    }

    return pickups;
  }

  function generateRows() {
    const visibleAhead = (state.height - playerScreenY()) / PX_PER_METER + 22;

    while (state.nextRowY < state.distance + visibleAhead) {
      const diff = difficulty();
      const rowY = state.nextRowY;
      const intro = introProgress(rowY);
      const moveLimit = lerp(26, lerp(54, 90, diff), intro);
      const offset = randomBetween(rowY * 0.37 + state.rows.length, -moveLimit, moveLimit);
      state.safeCenter = lerp(state.safeCenter, state.playerX, lerp(0.36, 0.16, intro)) + offset;

      const items = [];
      const gap = safeGap(diff);
      const step = lerp(52, 36, diff);
      const start = state.playerX - OBSTACLE_HALF_WIDTH;
      const end = state.playerX + OBSTACLE_HALF_WIDTH;
      const chance = lerp(0.42, lerp(0.62, 0.9, diff), intro);

      for (let x = start; x <= end; x += step) {
        const jitter = randomBetween(rowY + x * 0.13, -step * 0.24, step * 0.24);
        const obstacleX = x + jitter;
        const inSafeGap = Math.abs(obstacleX - state.safeCenter) < gap * 0.5;
        if (!inSafeGap && hash(rowY * 0.91 + x * 0.021) < chance) {
          const type = nextObstacleType(rowY + x, diff);
          items.push({
            type,
            x: obstacleX,
            y: rowY + randomBetween(rowY + x * 0.41, -1.6, 1.6),
            radius: obstacleSpecs[type].radius,
            hit: obstacleSpecs[type].hit,
            seed: rowY * 11 + x,
          });
        }
      }

      if (items.length < 2 && diff > 0.15) {
        const side = hash(rowY) > 0.5 ? -1 : 1;
        const type = nextObstacleType(rowY + 7, diff);
        items.push({
          type,
          x: state.safeCenter + side * (gap * 0.72 + 28),
          y: rowY,
          radius: obstacleSpecs[type].radius,
          hit: obstacleSpecs[type].hit,
          seed: rowY * 23,
        });
      }

      state.rows.push({ y: rowY, items, pickups: createPickups(rowY, diff, gap, items) });
      state.nextRowY += rowSpacing(diff) + randomBetween(rowY, -1.4, 2.2);
    }

    while (state.rows.length && state.rows[0].y < state.distance - 18) {
      state.rows.shift();
    }
  }

  function update(dt) {
    state.idleTime += dt;

    if (state.mode !== "running") {
      return;
    }

    const baseRunSpeed = Math.min(MAX_SPEED, BASE_SPEED + state.distance * 0.026);
    state.speed = baseRunSpeed * (state.fastDrop ? FAST_DROP_MULTIPLIER : 1);
    state.distance += state.speed * dt;

    const targetVelocity = state.steer * lerp(240, 335, difficulty());
    state.lateralVelocity = lerp(state.lateralVelocity, targetVelocity, clamp(dt * 11.5, 0, 1));
    state.playerX += state.lateralVelocity * dt;
    state.invulnerableTime = Math.max(0, state.invulnerableTime - dt);

    updateFloaters(dt);
    generateRows();
    checkPickups();
    checkCollision();
    updateHud();
  }

  function updateHud() {
    scoreEl.textContent = currentScore().toLocaleString("ko-KR");
    speedEl.textContent = String(Math.round(state.speed * 3.6));
    bonusEl.textContent = state.bonusScore.toLocaleString("ko-KR");
    shieldEl.textContent = String(state.shieldCharges);
    bonusPill.classList.toggle("is-active", state.bonusScore > 0);
    shieldPill.classList.toggle("is-active", state.shieldCharges > 0 || state.invulnerableTime > 0);
  }

  function addFloater(text, color) {
    state.floaters.push({
      text,
      color,
      age: 0,
      duration: 0.85,
      x: state.width / 2 + randomBetween(state.distance + state.floaters.length, -22, 22),
      y: playerScreenY() - 48,
    });
  }

  function updateFloaters(dt) {
    for (const floater of state.floaters) {
      floater.age += dt;
      floater.y -= dt * 24;
    }

    state.floaters = state.floaters.filter((floater) => floater.age < floater.duration);
  }

  function checkPickups() {
    const py = playerScreenY();
    const px = state.width / 2;

    for (const row of state.rows) {
      for (const pickup of row.pickups || []) {
        if (pickup.collected) continue;
        if (Math.abs(pickup.x - state.playerX) > 64) continue;

        const y = py + (pickup.y - state.distance) * PX_PER_METER;
        if (y < py - 42 || y > py + 42) continue;

        const x = px + (pickup.x - state.playerX);
        const dx = x - px;
        const dy = y - py;
        const collectRadius = PLAYER_RADIUS + pickup.radius;

        if (dx * dx + dy * dy >= collectRadius * collectRadius) continue;

        pickup.collected = true;

        if (pickup.type === "flake") {
          state.bonusScore += FLAKE_SCORE;
          addFloater(`+${FLAKE_SCORE}`, "#0284c7");
          sound.play("pickup");
        }

        if (pickup.type === "shield") {
          state.shieldCharges = Math.min(SHIELD_MAX_CHARGES, state.shieldCharges + 1);
          addFloater("방패", "#0a55d8");
          sound.play("shield");
        }
      }
    }
  }

  function checkCollision() {
    const py = playerScreenY();
    const px = state.width / 2;

    for (const row of state.rows) {
      for (const item of row.items) {
        if (item.cleared) continue;
        if (Math.abs(item.x - state.playerX) > 64) continue;

        const y = py + (item.y - state.distance) * PX_PER_METER;
        if (y < py - 44 || y > py + 44) continue;

        const x = px + (item.x - state.playerX);
        const dx = x - px;
        const dy = y - py;
        const hitRadius = PLAYER_RADIUS + item.hit;

        if (dx * dx + dy * dy < hitRadius * hitRadius) {
          if (state.invulnerableTime > 0) {
            item.cleared = true;
            continue;
          }

          if (state.shieldCharges > 0) {
            state.shieldCharges -= 1;
            state.invulnerableTime = 0.95;
            item.cleared = true;
            addFloater("방패 보호", "#0a55d8");
            sound.play("block");
            updateHud();
            return;
          }

          gameOver();
          return;
        }
      }
    }
  }

  function draw() {
    drawSnowfield();
    drawRows();
    drawSkier();
    drawFloaters();
  }

  function drawSnowfield() {
    const w = state.width;
    const h = state.height;
    const py = playerScreenY();
    const scroll = (state.distance + state.idleTime * 2.2) * PX_PER_METER;

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#dcf8ff");
    sky.addColorStop(0.42, "#f8fdff");
    sky.addColorStop(1, "#d8f3f8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const edgeGlow = ctx.createRadialGradient(w / 2, h * 0.28, w * 0.12, w / 2, h * 0.36, w * 0.78);
    edgeGlow.addColorStop(0, "rgba(255, 255, 255, 0)");
    edgeGlow.addColorStop(0.72, "rgba(125, 211, 252, 0.06)");
    edgeGlow.addColorStop(1, "rgba(14, 116, 144, 0.12)");
    ctx.fillStyle = edgeGlow;
    ctx.fillRect(0, 0, w, h);

    drawSnowTexture(w, h, scroll, py);
  }

  function drawSnowTexture(w, h, scroll, py) {
    ctx.save();
    ctx.globalAlpha = 0.75;

    for (let i = -8; i < 34; i += 1) {
      const y = ((i * 48 - scroll * 0.36) % (h + 96)) - 48;
      const seed = i + Math.floor(scroll / 500) * 37;
      const x = randomBetween(seed, 24, w - 24);
      const length = randomBetween(seed + 6, 16, 48);
      const alpha = randomBetween(seed + 10, 0.12, 0.36);

      ctx.strokeStyle = `rgba(14, 116, 144, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + randomBetween(seed + 2, -12, 12), y + length);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    for (let i = -3; i < 11; i += 1) {
      const y = ((i * 136 - scroll * 0.14) % (h + 220)) - 120;
      const seed = i + Math.floor(scroll / 1200) * 53;
      const x = randomBetween(seed, -60, w + 20);
      const width = randomBetween(seed + 4, 42, 112);
      ctx.strokeStyle = `rgba(14, 116, 144, ${randomBetween(seed + 7, 0.045, 0.085)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + width * 0.48, y + 12, x + width, y + randomBetween(seed + 3, -2, 8));
      ctx.stroke();
    }

    const trailLean = clamp(state.lateralVelocity / 260, -1, 1);
    ctx.strokeStyle = state.fastDrop ? "rgba(14, 165, 233, 0.28)" : "rgba(56, 189, 248, 0.22)";
    ctx.lineWidth = state.fastDrop ? 2.4 : 2;
    for (const offset of [-10, 10]) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + offset, py - 18);
      ctx.bezierCurveTo(
        w / 2 + offset - trailLean * 22,
        py - 74,
        w / 2 + offset - trailLean * 36,
        py - 132,
        w / 2 + offset - trailLean * 42,
        -20,
      );
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawRows() {
    const py = playerScreenY();
    const px = state.width / 2;

    for (const row of state.rows) {
      for (const item of row.items) {
        if (item.cleared) continue;
        if (!isNearViewport(item.x)) continue;

        const y = py + (item.y - state.distance) * PX_PER_METER;
        if (y < -60 || y > state.height + 80) continue;

        const x = px + (item.x - state.playerX);
        if (x < -80 || x > state.width + 80) continue;

        if (item.type === "tree") drawTree(x, y, item.radius, item.seed);
        if (item.type === "rock") drawRock(x, y, item.radius, item.seed);
        if (item.type === "drift") drawDrift(x, y, item.radius, item.seed);
      }

      for (const pickup of row.pickups || []) {
        if (pickup.collected) continue;
        if (!isNearViewport(pickup.x)) continue;

        const y = py + (pickup.y - state.distance) * PX_PER_METER;
        if (y < -60 || y > state.height + 80) continue;

        const x = px + (pickup.x - state.playerX);
        if (x < -80 || x > state.width + 80) continue;

        drawPickup(x, y, pickup);
      }
    }
  }

  function drawPickup(x, y, pickup) {
    if (pickup.type === "shield") {
      drawShieldPickup(x, y, pickup.radius, pickup.seed);
      return;
    }

    drawFlakePickup(x, y, pickup.radius, pickup.seed);
  }

  function drawFlakePickup(x, y, radius, seed) {
    const pulse = 1 + Math.sin(state.idleTime * 5 + seed) * 0.065;
    const size = radius * 2.35;
    const rotation = Math.sin(state.idleTime * 1.8 + seed) * 0.08;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(pulse, pulse);

    const glow = ctx.createRadialGradient(0, 0, radius * 0.18, 0, 0, radius * 1.65);
    glow.addColorStop(0, "rgba(255, 255, 255, 0.9)");
    glow.addColorStop(0.54, "rgba(147, 197, 253, 0.42)");
    glow.addColorStop(1, "rgba(14, 165, 233, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.72, 0, TWO_PI);
    ctx.fill();

    ctx.globalAlpha = 0.58;
    ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.92, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (snowflakeSprite.complete && snowflakeSprite.naturalWidth > 0) {
      const drawHeight = size * 1.06;
      const drawWidth = drawHeight * (snowflakeSprite.naturalWidth / snowflakeSprite.naturalHeight);
      ctx.drawImage(snowflakeSprite, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();
      return;
    }

    drawFallbackSnowflake(radius);
    ctx.restore();
  }

  function drawFallbackSnowflake(radius) {
    ctx.strokeStyle = "#bfdbfe";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      const inner = radius * 0.2;
      const outer = radius * 1.05;
      const branch = radius * 0.34;
      const sx = Math.cos(angle);
      const sy = Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(sx * inner, sy * inner);
      ctx.lineTo(sx * outer, sy * outer);
      ctx.stroke();

      for (const side of [-1, 1]) {
        const branchAngle = angle + side * 0.72;
        const baseX = sx * radius * 0.66;
        const baseY = sy * radius * 0.66;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(
          baseX + Math.cos(branchAngle) * branch,
          baseY + Math.sin(branchAngle) * branch,
        );
        ctx.stroke();
      }
    }
  }

  function drawShieldPickup(x, y, radius, seed) {
    const pulse = 1 + Math.sin(state.idleTime * 4.3 + seed) * 0.06;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);

    const glow = ctx.createRadialGradient(0, 0, radius * 0.25, 0, 0, radius * 1.55);
    glow.addColorStop(0, "rgba(204, 251, 241, 0.92)");
    glow.addColorStop(0.62, "rgba(20, 115, 237, 0.36)");
    glow.addColorStop(1, "rgba(10, 85, 216, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.55, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = "rgba(240, 253, 250, 0.96)";
    ctx.strokeStyle = "rgba(10, 85, 216, 0.36)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.86, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();

    const shieldGradient = ctx.createLinearGradient(0, -radius * 0.62, 0, radius * 0.72);
    shieldGradient.addColorStop(0, "#38bdf8");
    shieldGradient.addColorStop(1, "#0a55d8");
    ctx.fillStyle = shieldGradient;
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.7);
    ctx.quadraticCurveTo(radius * 0.56, -radius * 0.46, radius * 0.5, radius * 0.08);
    ctx.quadraticCurveTo(radius * 0.36, radius * 0.54, 0, radius * 0.76);
    ctx.quadraticCurveTo(-radius * 0.36, radius * 0.54, -radius * 0.5, radius * 0.08);
    ctx.quadraticCurveTo(-radius * 0.56, -radius * 0.46, 0, -radius * 0.7);
    ctx.fill();

    ctx.strokeStyle = "rgba(240, 253, 250, 0.72)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.18, -radius * 0.34);
    ctx.lineTo(radius * 0.22, radius * 0.1);
    ctx.stroke();
    ctx.restore();
  }

  function drawTree(x, y, radius, seed) {
    ctx.save();
    ctx.translate(x, y);

    drawGroundShadow(0, radius * 0.72, radius * 0.78, radius * 0.23, 0.17);

    const trunkGradient = ctx.createLinearGradient(-3, 0, 4, 0);
    trunkGradient.addColorStop(0, "#8b5a2b");
    trunkGradient.addColorStop(1, "#5f3b1d");
    ctx.fillStyle = trunkGradient;
    ctx.beginPath();
    roundedRectPath(ctx, -3.2, radius * 0.17, 6.4, radius * 0.56, 2);
    ctx.fill();

    const tint = randomBetween(seed, 0, 1);
    const dark = mixColor("#0f766e", "#115e59", tint);
    const light = mixColor("#2dd4bf", "#0f9f8f", tint);

    for (let i = 0; i < 3; i += 1) {
      const width = radius * (1.65 - i * 0.24);
      const top = -radius * (1.08 - i * 0.4);
      const bottom = radius * (0.6 - i * 0.18);
      const foliage = ctx.createLinearGradient(0, top, 0, bottom);
      foliage.addColorStop(0, light);
      foliage.addColorStop(0.62, dark);
      foliage.addColorStop(1, "#064e3b");

      ctx.fillStyle = foliage;
      ctx.beginPath();
      ctx.moveTo(0, top);
      ctx.quadraticCurveTo(-width * 0.42, bottom * 0.18, -width * 0.52, bottom);
      ctx.lineTo(width * 0.52, bottom);
      ctx.quadraticCurveTo(width * 0.42, bottom * 0.16, 0, top);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(240, 253, 250, 0.46)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-width * 0.16, top + radius * 0.2);
      ctx.lineTo(-width * 0.34, bottom - radius * 0.06);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.beginPath();
    ctx.ellipse(-radius * 0.2, -radius * 0.1, radius * 0.28, radius * 0.1, -0.2, 0, TWO_PI);
    ctx.ellipse(radius * 0.12, radius * 0.18, radius * 0.32, radius * 0.1, 0.1, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  function drawRock(x, y, radius, seed) {
    ctx.save();
    ctx.translate(x, y);

    drawGroundShadow(1, radius * 0.5, radius * 0.92, radius * 0.29, 0.18);

    const rockGradient = ctx.createLinearGradient(-radius, -radius * 0.75, radius, radius * 0.54);
    rockGradient.addColorStop(0, mixColor("#94a3b8", "#cbd5e1", hash(seed)));
    rockGradient.addColorStop(0.52, "#64748b");
    rockGradient.addColorStop(1, "#334155");

    ctx.fillStyle = rockGradient;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.95, radius * 0.32);
    ctx.quadraticCurveTo(-radius * 0.78, -radius * 0.34, -radius * 0.3, -radius * 0.55);
    ctx.quadraticCurveTo(radius * 0.12, -radius * 0.88, radius * 0.74, -radius * 0.18);
    ctx.quadraticCurveTo(radius * 0.98, radius * 0.24, radius * 0.58, radius * 0.54);
    ctx.quadraticCurveTo(-radius * 0.18, radius * 0.62, -radius * 0.95, radius * 0.32);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(248, 250, 252, 0.52)";
    ctx.beginPath();
    ctx.moveTo(-radius * 0.55, -radius * 0.18);
    ctx.quadraticCurveTo(-radius * 0.12, -radius * 0.45, radius * 0.34, -radius * 0.28);
    ctx.lineTo(radius * 0.18, -radius * 0.02);
    ctx.quadraticCurveTo(-radius * 0.18, -radius * 0.16, -radius * 0.55, -radius * 0.18);
    ctx.fill();

    ctx.strokeStyle = "rgba(15, 23, 42, 0.16)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.18, -radius * 0.52);
    ctx.lineTo(radius * 0.04, radius * 0.34);
    ctx.moveTo(radius * 0.36, -radius * 0.18);
    ctx.lineTo(radius * 0.62, radius * 0.28);
    ctx.stroke();
    ctx.restore();
  }

  function drawDrift(x, y, radius, seed) {
    ctx.save();
    ctx.translate(x, y);

    const tilt = randomBetween(seed, -0.18, 0.18);
    drawGroundShadow(0, radius * 0.2, radius * 1.18, radius * 0.42, 0.1);

    const driftGradient = ctx.createLinearGradient(0, -radius * 0.42, 0, radius * 0.48);
    driftGradient.addColorStop(0, "#ffffff");
    driftGradient.addColorStop(0.52, "#dff7ff");
    driftGradient.addColorStop(1, "#b9e8f5");

    ctx.fillStyle = driftGradient;
    ctx.beginPath();
    ctx.ellipse(-radius * 0.18, -radius * 0.02, radius * 0.82, radius * 0.36, tilt - 0.08, 0, TWO_PI);
    ctx.ellipse(radius * 0.42, -radius * 0.03, radius * 0.58, radius * 0.3, tilt + 0.16, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = "rgba(14, 116, 144, 0.24)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.7, radius * 0.04);
    ctx.quadraticCurveTo(-radius * 0.1, radius * 0.28, radius * 0.76, radius * 0.02);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.86)";
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.44, -radius * 0.2);
    ctx.quadraticCurveTo(-radius * 0.05, -radius * 0.34, radius * 0.38, -radius * 0.2);
    ctx.stroke();
    ctx.restore();
  }

  function drawGroundShadow(x, y, width, height, alpha) {
    ctx.fillStyle = `rgba(15, 23, 42, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(x, y, width, height, 0, 0, TWO_PI);
    ctx.fill();
  }

  function drawPlayerAura(x, y) {
    if (state.shieldCharges <= 0 && state.invulnerableTime <= 0) return;

    const pulse = 1 + Math.sin(state.idleTime * 8) * 0.04;
    const alpha = state.invulnerableTime > 0 ? 0.42 : 0.28;

    ctx.save();
    ctx.translate(x, y + 3);
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = `rgba(20, 115, 237, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 2, 38, 50, 0, 0, TWO_PI);
    ctx.stroke();

    ctx.strokeStyle = "rgba(204, 251, 241, 0.46)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, 2, 31, 42, 0, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }

  function drawFloaters() {
    if (!state.floaters.length) return;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "850 15px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

    for (const floater of state.floaters) {
      const progress = floater.age / floater.duration;
      const alpha = 1 - progress;
      ctx.globalAlpha = alpha;

      ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
      ctx.beginPath();
      roundedRectPath(ctx, floater.x - 35, floater.y - 13, 70, 26, 8);
      ctx.fill();

      ctx.fillStyle = floater.color;
      ctx.fillText(floater.text, floater.x, floater.y + progress * -4);
    }

    ctx.restore();
  }

  function drawSkier() {
    const pose = currentSkierPose();
    const sprite = skierSprites[pose];

    if (sprite.image.complete && sprite.image.naturalWidth > 0) {
      drawSpriteSkier(sprite, pose);
      return;
    }

    drawFallbackSkier();
  }

  function currentSkierPose() {
    if (state.fastDrop) return "boost";
    if (state.steer < -0.15) return "left";
    if (state.steer > 0.15) return "right";
    return "straight";
  }

  function drawSpriteSkier(sprite, pose) {
    const x = state.width / 2;
    const y = playerScreenY();
    const targetHeight = pose === "boost" ? 84 : 92;
    const targetWidth = targetHeight * (sprite.image.naturalWidth / sprite.image.naturalHeight);
    const verticalOffset = pose === "boost" ? 6 : 8;

    ctx.save();
    drawPlayerAura(x, y);

    ctx.fillStyle = "rgba(15, 23, 42, 0.15)";
    ctx.beginPath();
    ctx.ellipse(x, y + 30, targetWidth * 0.32, 7, 0, 0, TWO_PI);
    ctx.fill();

    if (sprite.mirror) {
      ctx.translate(x, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(
        sprite.image,
        -targetWidth / 2,
        y - targetHeight / 2 + verticalOffset,
        targetWidth,
        targetHeight,
      );
    } else {
      ctx.drawImage(
        sprite.image,
        x - targetWidth / 2,
        y - targetHeight / 2 + verticalOffset,
        targetWidth,
        targetHeight,
      );
    }
    ctx.restore();
  }

  function drawFallbackSkier() {
    const x = state.width / 2;
    const y = playerScreenY();
    const lean = clamp(state.lateralVelocity / 210, -0.48, 0.48);

    ctx.save();
    ctx.translate(x, y);

    drawPlayerAura(0, 0);

    ctx.fillStyle = "rgba(15, 23, 42, 0.18)";
    ctx.beginPath();
    ctx.ellipse(0, 18, 24, 8, 0, 0, TWO_PI);
    ctx.fill();

    ctx.rotate(lean);

    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const offset of [-8, 8]) {
      ctx.beginPath();
      ctx.moveTo(offset, -15);
      ctx.lineTo(offset, 27);
      ctx.stroke();
    }

    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-11, -4);
    ctx.lineTo(-22, 22);
    ctx.moveTo(11, -4);
    ctx.lineTo(22, 22);
    ctx.stroke();

    ctx.fillStyle = "#1473ed";
    ctx.beginPath();
    roundedRectPath(ctx, -11, -14, 22, 28, 7);
    ctx.fill();

    ctx.fillStyle = "#07245a";
    ctx.beginPath();
    ctx.arc(0, -22, 9, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = "rgba(248, 250, 252, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-5, -27);
    ctx.quadraticCurveTo(1, -30, 8, -26);
    ctx.stroke();

    ctx.fillStyle = "#19bde5";
    ctx.beginPath();
    ctx.arc(0, -13, 3.2, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.moveTo(-6, -20);
    ctx.lineTo(7, -22);
    ctx.lineTo(6, -18);
    ctx.lineTo(-6, -17);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function updateInputState() {
    let leftPressed = state.keyLeft;
    let rightPressed = state.keyRight;
    const previousSoundInput = state.lastSoundInput;

    for (const side of state.pointerSides.values()) {
      if (side === "left") leftPressed = true;
      if (side === "right") rightPressed = true;
    }

    state.fastDrop = leftPressed && rightPressed;

    if (state.fastDrop) {
      state.steer = 0;
      state.lastSoundInput = "boost";
      if (state.mode === "running" && previousSoundInput !== "boost") {
        sound.play("boost");
      }
      return;
    }

    if (leftPressed) {
      state.steer = 1;
      state.lastSoundInput = "turnRight";
      if (state.mode === "running" && previousSoundInput !== "turnRight") {
        sound.play("turnRight", { reversal: previousSoundInput === "turnLeft" });
      }
      return;
    }

    if (rightPressed) {
      state.steer = -1;
      state.lastSoundInput = "turnLeft";
      if (state.mode === "running" && previousSoundInput !== "turnLeft") {
        sound.play("turnLeft", { reversal: previousSoundInput === "turnRight" });
      }
      return;
    }

    state.steer = 0;
    state.lastSoundInput = "idle";
  }

  function setPointerSide(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    state.pointerSides.set(event.pointerId, x < rect.width / 2 ? "left" : "right");
    updateInputState();
  }

  function stopPointerSteer(event) {
    state.pointerSides.delete(event.pointerId);
    updateInputState();
  }

  function isOverlayInteraction(event) {
    return event.target instanceof Element
      && Boolean(event.target.closest(".overlay, .rotate-warning, .leaderboard-modal"));
  }

  function isControlInteraction(event) {
    return event.target instanceof Element
      && Boolean(event.target.closest("button, input, label, textarea, select"));
  }

  function handlePointerDown(event) {
    if (isControlInteraction(event)) {
      return;
    }

    if (state.mode !== "running" && isOverlayInteraction(event)) {
      return;
    }

    event.preventDefault();
    void sound.unlock();

    if (state.mode !== "running") {
      resetRun();
    }

    setPointerSide(event);
  }

  function handlePointerMove(event) {
    if (!state.pointerSides.has(event.pointerId) || state.mode !== "running") return;
    event.preventDefault();
    setPointerSide(event);
  }

  function handleKeyDown(event) {
    if (!leaderboardModal.hidden) return;
    if (event.repeat) return;
    void sound.unlock();

    if (event.code === "Space") {
      event.preventDefault();
      if (state.mode !== "running") resetRun();
    }

    if (event.code === "KeyR") {
      event.preventDefault();
      resetRun();
    }

    if (event.code === "ArrowLeft" || event.code === "KeyA") {
      state.keyLeft = true;
      updateInputState();
    }

    if (event.code === "ArrowRight" || event.code === "KeyD") {
      state.keyRight = true;
      updateInputState();
    }
  }

  function handleKeyUp(event) {
    if (event.code === "ArrowLeft" || event.code === "KeyA") {
      state.keyLeft = false;
    }

    if (event.code === "ArrowRight" || event.code === "KeyD") {
      state.keyRight = false;
    }

    updateInputState();
  }

  function loop(time) {
    const dt = state.lastTime ? Math.min(0.033, (time - state.lastTime) / 1000) : 0;
    state.lastTime = time;

    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        // Local file previews and some private browser modes can block service workers.
      });
    });
  }

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", resizeCanvas);
  window.addEventListener("pointerdown", handlePointerDown, { passive: false });
  window.addEventListener("pointermove", handlePointerMove, { passive: false });
  window.addEventListener("pointerup", stopPointerSteer);
  window.addEventListener("pointercancel", stopPointerSteer);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("popstate", () => {
    if (leaderboardModal.hidden) return;
    closeLeaderboardModal(true);
  });
  document.addEventListener("keydown", handleLeaderboardModalKeyDown);
  document.addEventListener("visibilitychange", () => {
    state.lastTime = 0;
    if (document.hidden) {
      sound.stopSkiLoop();
      return;
    }

    if (state.mode === "running") {
      sound.startSkiLoop();
    }
  });

  playerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.scoreSubmissionPending) return;
    void sound.unlock();
    if (state.mode !== "running") resetRun();
  });

  soundToggleButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void sound.unlock();
    sound.toggle();
    if (state.mode === "running" && !sound.isMuted()) {
      sound.startSkiLoop();
    }
  });

  refreshLeaderboardButton.addEventListener("click", () => {
    savePlayerName(nicknameInput.value);
    void loadLeaderboard("기록 새로고침 중...");
  });

  leaderboardPanel.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("#refreshLeaderboard")) return;
    openLeaderboardModal();
  });

  closeLeaderboardButton.addEventListener("click", () => {
    closeLeaderboardModal();
  });

  leaderboardModal.addEventListener("click", (event) => {
    if (event.target === leaderboardModal) closeLeaderboardModal();
  });

  jumpToMyRankButton.addEventListener("click", () => {
    const ownItem = fullLeaderboardList.querySelector(".is-me");
    if (!ownItem) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ownItem.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
  });

  resizeCanvas();
  setOverlay("ready");
  void loadLeaderboard();
  registerServiceWorker();
  requestAnimationFrame(loop);
})();
