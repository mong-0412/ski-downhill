import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname);
const preferredPort = Number.parseInt(process.env.PORT || "4173", 10);
const host = "0.0.0.0";
const dataDir = path.join(root, ".data");
const leaderboardPath = path.join(dataDir, "leaderboard.json");
const leaderboardLimit = 100;
let writeQueue = Promise.resolve();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".otf", "font/otf"],
  [".ico", "image/x-icon"],
]);

function resolveRequestPath(url) {
  const parsed = new URL(url, "http://localhost");
  const pathname = decodeURIComponent(parsed.pathname);

  const pathParts = pathname.split("/").filter(Boolean);
  if (pathParts.some((part) => part.startsWith(".") && part !== ".well-known")) {
    return null;
  }

  const requested = path.resolve(root, `.${pathname}`);

  if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  return requested;
}

async function getFilePath(requested) {
  const info = await stat(requested);
  if (info.isDirectory()) return path.join(requested, "index.html");
  return requested;
}

function sendError(response, status, message) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function parseEnvFile(content) {
  const values = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }

  return values;
}

async function readPublicConfig() {
  let fileValues = {};

  try {
    fileValues = parseEnvFile(await readFile(path.join(root, ".env.local"), "utf8"));
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }

  return {
    supabaseUrl: process.env.SUPABASE_URL || fileValues.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || fileValues.SUPABASE_ANON_KEY || "",
  };
}

async function sendConfigScript(response) {
  const config = await readPublicConfig();
  response.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`window.SKI_DOWNHILL_CONFIG = ${JSON.stringify(config)};\n`);
}

function sanitizeNickname(value) {
  const fallback = "스키어";
  if (typeof value !== "string") return fallback;

  const cleaned = value
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12);

  return cleaned || fallback;
}

function normalizeScore(value) {
  const score = Number.parseInt(value, 10);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(999999, score));
}

async function readLeaderboard() {
  try {
    const raw = await readFile(leaderboardPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeLeaderboard(entries) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    leaderboardPath,
    `${JSON.stringify({ entries }, null, 2)}\n`,
    "utf8",
  );
}

function sortLeaderboard(entries) {
  return entries
    .slice()
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    })
    .slice(0, leaderboardLimit);
}

async function readRequestJson(request) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) {
      throw new Error("Request body too large");
    }
  }

  return body ? JSON.parse(body) : {};
}

async function handleLeaderboard(request, response, parsedUrl) {
  if (request.method === "GET") {
    const limit = Math.max(1, Math.min(50, Number.parseInt(parsedUrl.searchParams.get("limit") || "10", 10)));
    const entries = sortLeaderboard(await readLeaderboard()).slice(0, limit);
    sendJson(response, 200, { entries });
    return true;
  }

  if (request.method === "POST") {
    let payload;
    try {
      payload = await readRequestJson(request);
    } catch {
      sendJson(response, 400, { error: "Invalid JSON body" });
      return true;
    }

    const nickname = sanitizeNickname(payload.nickname);
    const score = normalizeScore(payload.score);
    const distance = normalizeScore(payload.distance);
    const bonus = normalizeScore(payload.bonus);
    const createdAt = new Date().toISOString();

    if (score <= 0) {
      sendJson(response, 400, { error: "Score must be positive" });
      return true;
    }

    writeQueue = writeQueue.then(async () => {
      const entries = await readLeaderboard();
      const previous = entries.find((entry) => entry.nickname === nickname);
      const nextEntry = { nickname, score, distance, bonus, createdAt };

      if (previous && previous.score >= score) {
        return sortLeaderboard(entries);
      }

      const nextEntries = sortLeaderboard([
        ...entries.filter((entry) => entry.nickname !== nickname),
        nextEntry,
      ]);

      await writeLeaderboard(nextEntries);
      return nextEntries;
    });

    try {
      const entries = await writeQueue;
      sendJson(response, 200, {
        entry: entries.find((entry) => entry.nickname === nickname) || null,
        entries: entries.slice(0, 10),
      });
    } catch {
      sendJson(response, 500, { error: "Failed to save leaderboard" });
    }

    return true;
  }

  sendJson(response, 405, { error: "Method not allowed" });
  return true;
}

const server = createServer(async (request, response) => {
  try {
    const parsedUrl = new URL(request.url || "/", "http://localhost");

    if (parsedUrl.pathname === "/api/leaderboard") {
      await handleLeaderboard(request, response, parsedUrl);
      return;
    }

    if (parsedUrl.pathname === "/config.js") {
      await sendConfigScript(response);
      return;
    }

    const requested = resolveRequestPath(request.url || "/");
    if (!requested) {
      sendError(response, 403, "Forbidden");
      return;
    }

    const filePath = await getFilePath(requested);
    await access(filePath);

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes.get(ext) || "application/octet-stream";
    const cacheControl = ext === ".html"
      ? "no-cache"
      : "public, max-age=3600";

    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      sendError(response, 404, "Not found");
      return;
    }
    sendError(response, 500, "Server error");
  }
});

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

function listen(port, attemptsLeft = 12) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    throw error;
  });

  server.listen(port, host, () => {
    const actualPort = server.address().port;
    console.log("");
    console.log("Ski Downhill is running.");
    console.log(`Local:   http://localhost:${actualPort}`);

    for (const address of lanAddresses()) {
      console.log(`Phone:   http://${address}:${actualPort}`);
    }

    console.log("");
    console.log("Open the Phone URL on a device connected to the same Wi-Fi.");
    console.log("Press Ctrl+C to stop the server.");
  });
}

listen(preferredPort);
