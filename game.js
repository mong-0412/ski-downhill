(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const speedEl = document.getElementById("speed");
  const bonusEl = document.getElementById("bonus");
  const shieldEl = document.getElementById("shield");
  const shieldPill = document.getElementById("shieldPill");
  const soundToggleButton = document.getElementById("soundToggle");
  const soundIcon = document.getElementById("soundIcon");
  const overlay = document.getElementById("overlay");
  const overlayKicker = document.getElementById("overlayKicker");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const playerForm = document.getElementById("playerForm");
  const nicknameInput = document.getElementById("nickname");
  const startButton = document.getElementById("startButton");
  const refreshLeaderboardButton = document.getElementById("refreshLeaderboard");
  const leaderboardList = document.getElementById("leaderboardList");
  const leaderboardStatus = document.getElementById("leaderboardStatus");

  const STORAGE_KEY = "ski-downhill-best-v1";
  const PLAYER_NAME_KEY = "ski-downhill-player-name-v1";
  const LOCAL_LEADERBOARD_KEY = "ski-downhill-local-leaderboard-v1";
  const SOUND_MUTED_KEY = "ski-downhill-sound-muted-v1";
  const SKI_LOOP_SRC = "./assets/ski-loop.wav";
  const LEADERBOARD_LIMIT = 10;
  const LEADERBOARD_FETCH_LIMIT = 25;
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
    idleTime: 0,
    deathDistance: 0,
    scoreSubmitted: false,
  };

  const sound = createSoundController();

  bestEl.textContent = String(state.best);
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
    bestEl.textContent = String(state.best);
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
    let skiCompressor = null;
    let skiPlaying = false;
    let skiSource = null;

    function ensureAudio() {
      if (!AudioContextClass) return null;
      if (audio) return audio;

      audio = new AudioContextClass();
      master = audio.createGain();
      master.gain.value = muted ? 0 : 0.23;
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
      skiCompressor = audio.createDynamicsCompressor();

      skiGain.gain.value = 0;
      skiHighpass.type = "highpass";
      skiHighpass.frequency.value = 160;
      skiHighpass.Q.value = 0.45;
      skiLowpass.type = "lowpass";
      skiLowpass.frequency.value = 5600;
      skiLowpass.Q.value = 0.25;
      skiCompressor.threshold.value = -34;
      skiCompressor.knee.value = 18;
      skiCompressor.ratio.value = 8;
      skiCompressor.attack.value = 0.004;
      skiCompressor.release.value = 0.16;

      skiGain.connect(skiHighpass);
      skiHighpass.connect(skiLowpass);
      skiLowpass.connect(skiCompressor);
      skiCompressor.connect(master);
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
      gain.gain.setTargetAtTime(0.08, instance.currentTime, 0.08);

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

    function schedule(name) {
      if (muted) return;

      if (name === "pickup") {
        tone(760, 0.07, { type: "sine", volume: 0.12 });
        tone(1160, 0.1, { type: "sine", volume: 0.1, delay: 0.045 });
        return;
      }

      if (name === "shield") {
        tone(420, 0.1, { type: "triangle", volume: 0.13 });
        tone(640, 0.14, { type: "triangle", volume: 0.12, delay: 0.08 });
        return;
      }

      if (name === "block") {
        tone(210, 0.12, { type: "sawtooth", volume: 0.11, to: 310 });
        tone(620, 0.16, { type: "triangle", volume: 0.12, delay: 0.05 });
        return;
      }

      if (name === "crash") {
        noise(0.24, { frequency: 240, filterType: "lowpass", volume: 0.2 });
        tone(140, 0.2, { type: "sawtooth", volume: 0.11, to: 78 });
        return;
      }

      if (name === "toggle") {
        tone(660, 0.07, { type: "sine", volume: 0.08 });
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
      play(name) {
        if (muted) return;
        const instance = ensureAudio();
        if (!instance) return;

        if (instance.state === "suspended") {
          instance.resume()
            .then(() => schedule(name))
            .catch(() => {});
          return;
        }

        schedule(name);
      },
      setMuted(value) {
        muted = Boolean(value);
        saveSoundMuted(muted);
        setMasterGain(muted ? 0 : 0.23);
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
    soundIcon.textContent = muted ? "×" : "♪";
  }

  function currentScore() {
    return Math.floor(state.distance) + state.bonusScore;
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
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/submit_leaderboard_score`, {
          method: "POST",
          headers: {
            ...baseHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            p_nickname: entry.nickname,
            p_score: entry.score,
            p_distance: entry.distance,
            p_bonus: entry.bonus,
          }),
        });

        if (!response.ok) {
          throw new Error("Supabase score RPC failed");
        }

        return response.json();
      },
      async insert(entry) {
        const response = await fetch(`${supabaseUrl}/rest/v1/leaderboard`, {
          method: "POST",
          headers: {
            ...baseHeaders,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            nickname: entry.nickname,
            score: entry.score,
            distance: entry.distance,
            bonus: entry.bonus,
          }),
        });

        if (!response.ok) {
          throw new Error("Supabase score submit failed");
        }
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

  function sortLeaderboard(entries) {
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
      if (deduped.length >= LEADERBOARD_LIMIT) break;
    }

    return deduped;
  }

  function readLocalLeaderboard() {
    try {
      const raw = window.localStorage.getItem(LOCAL_LEADERBOARD_KEY);
      const parsed = JSON.parse(raw || "[]");
      return sortLeaderboard(Array.isArray(parsed) ? parsed : []);
    } catch {
      return [];
    }
  }

  function saveLocalLeaderboardEntry(entry) {
    try {
      const entries = readLocalLeaderboard();
      const nextEntry = normalizeLeaderboardEntry(entry);
      const previous = entries.find((item) => item.nickname === nextEntry.nickname);
      const nextEntries = previous && previous.score >= nextEntry.score
        ? entries
        : sortLeaderboard([
          ...entries.filter((item) => item.nickname !== nextEntry.nickname),
          nextEntry,
        ]);

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
    refreshLeaderboardButton.textContent = "불러오는 중";
    setLeaderboardStatus(message);
    return state.leaderboardRequestId;
  }

  function isCurrentLeaderboardRequest(requestId) {
    return requestId === state.leaderboardRequestId;
  }

  function finishLeaderboardRequest(requestId) {
    if (!isCurrentLeaderboardRequest(requestId)) return;
    refreshLeaderboardButton.disabled = false;
    refreshLeaderboardButton.textContent = "새로고침";
  }

  function leaderboardSyncedMessage(prefix) {
    const time = new Date().toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return `${prefix} · ${time} 업데이트`;
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
      const item = document.createElement("li");
      if (entry.nickname === state.playerName) {
        item.classList.add("is-me");
      }

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = `${index + 1}`;

      const name = document.createElement("span");
      name.className = "leaderboard-name";
      name.textContent = entry.nickname;

      const score = document.createElement("span");
      score.className = "leaderboard-score";
      score.textContent = `${entry.score}점`;

      item.append(rank, name, score);
      leaderboardList.append(item);
    });
  }

  async function loadLeaderboard(message = "리더보드를 불러오는 중입니다.") {
    const requestId = beginLeaderboardRequest(message);

    try {
      if (supabaseClient) {
        const entries = await supabaseClient.list(LEADERBOARD_FETCH_LIMIT);
        if (!isCurrentLeaderboardRequest(requestId)) return;
        state.leaderboardOnline = true;
        renderLeaderboard(Array.isArray(entries) ? entries : []);
        setLeaderboardStatus(leaderboardSyncedMessage("Supabase 리더보드 연결됨"));
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
      setLeaderboardStatus(leaderboardSyncedMessage("로컬 리더보드 연결됨"));
    } catch {
      if (!isCurrentLeaderboardRequest(requestId)) return;
      state.leaderboardOnline = false;
      renderLeaderboard(readLocalLeaderboard());
      setLeaderboardStatus("서버 연결 전이라 이 기기 기록만 표시됩니다.");
    } finally {
      finishLeaderboardRequest(requestId);
    }
  }

  async function submitScore(score) {
    const requestId = beginLeaderboardRequest("점수를 제출하는 중입니다.");
    const entry = {
      nickname: state.playerName,
      score,
      distance: Math.floor(state.distance),
      bonus: state.bonusScore,
      createdAt: new Date().toISOString(),
    };

    try {
      if (supabaseClient) {
        let entries;
        try {
          entries = await supabaseClient.submit(entry);
        } catch {
          await supabaseClient.insert(entry);
          entries = await supabaseClient.list(LEADERBOARD_FETCH_LIMIT);
        }

        if (!isCurrentLeaderboardRequest(requestId)) return;
        state.leaderboardOnline = true;
        renderLeaderboard(Array.isArray(entries) ? entries : []);
        setLeaderboardStatus(leaderboardSyncedMessage("점수가 Supabase 리더보드에 반영됨"));
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
      state.leaderboardOnline = true;
      renderLeaderboard(Array.isArray(data.entries) ? data.entries : []);
      setLeaderboardStatus(leaderboardSyncedMessage("점수가 리더보드에 반영됨"));
    } catch {
      if (!isCurrentLeaderboardRequest(requestId)) return;
      state.leaderboardOnline = false;
      renderLeaderboard(saveLocalLeaderboardEntry(entry));
      setLeaderboardStatus("서버 저장 실패: 이 기기 기록으로 저장했습니다.");
    } finally {
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
    if (mode === "running") {
      overlay.classList.add("is-hidden");
      overlay.classList.remove("is-splash");
      return;
    }

    overlay.classList.remove("is-hidden");

    if (mode === "ready") {
      overlay.classList.add("is-splash");
      overlayKicker.textContent = "모바일 스키런";
      overlayTitle.textContent = "씽씽 스키";
      overlayText.textContent = "닉네임을 입력하고 기록에 도전하세요. 눈결정은 +50점, 방패는 충돌을 한 번 막아줍니다.";
      startButton.textContent = "시작하기";
      return;
    }

    overlay.classList.remove("is-splash");
    overlayKicker.textContent = `${state.deathDistance}점 기록`;
    overlayTitle.textContent = "넘어졌어요";
    overlayText.textContent = "점수를 리더보드에 반영합니다. 다시 시작해서 더 높은 순위를 노려보세요.";
    startButton.textContent = "다시 시작";
  }

  function resetRun() {
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
    state.scoreSubmitted = false;
    generateRows();
    updateHud();
    setOverlay("running");
  }

  function gameOver() {
    state.mode = "gameover";
    state.deathDistance = currentScore();
    sound.stopSkiLoop();
    sound.play("crash");
    saveBest(state.deathDistance);
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
    scoreEl.textContent = String(currentScore());
    speedEl.textContent = String(Math.round(state.speed * 3.6));
    bonusEl.textContent = String(state.bonusScore);
    shieldEl.textContent = String(state.shieldCharges);
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
          addFloater("방패", "#0f766e");
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
            addFloater("방패 보호", "#0f766e");
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
    glow.addColorStop(0.62, "rgba(20, 184, 166, 0.36)");
    glow.addColorStop(1, "rgba(15, 118, 110, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.55, 0, TWO_PI);
    ctx.fill();

    ctx.fillStyle = "rgba(240, 253, 250, 0.96)";
    ctx.strokeStyle = "rgba(15, 118, 110, 0.36)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.86, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();

    const shieldGradient = ctx.createLinearGradient(0, -radius * 0.62, 0, radius * 0.72);
    shieldGradient.addColorStop(0, "#2dd4bf");
    shieldGradient.addColorStop(1, "#0f766e");
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
    ctx.strokeStyle = `rgba(20, 184, 166, ${alpha})`;
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

    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    roundedRectPath(ctx, -11, -14, 22, 28, 7);
    ctx.fill();

    ctx.fillStyle = "#0f766e";
    ctx.beginPath();
    ctx.arc(0, -22, 9, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = "rgba(248, 250, 252, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-5, -27);
    ctx.quadraticCurveTo(1, -30, 8, -26);
    ctx.stroke();

    ctx.fillStyle = "#064e3b";
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

    for (const side of state.pointerSides.values()) {
      if (side === "left") leftPressed = true;
      if (side === "right") rightPressed = true;
    }

    state.fastDrop = leftPressed && rightPressed;

    if (state.fastDrop) {
      state.steer = 0;
      return;
    }

    if (leftPressed) {
      state.steer = 1;
      return;
    }

    if (rightPressed) {
      state.steer = -1;
      return;
    }

    state.steer = 0;
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
      && Boolean(event.target.closest(".overlay, .rotate-warning"));
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
    void loadLeaderboard("리더보드를 새로고침하는 중입니다.");
  });

  resizeCanvas();
  setOverlay("ready");
  void loadLeaderboard();
  registerServiceWorker();
  requestAnimationFrame(loop);
})();
