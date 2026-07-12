import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const staticFiles = [
  "index.html",
  "styles.css",
  "game.js",
  "manifest.webmanifest",
  "sw.js",
  "icon.svg",
];

const assetFiles = [
  "skier-boost.png",
  "skier-left.png",
  "skier-straight.png",
  "ski-loop.mp3",
  "snowflake-pickup.png",
  "splash-banner.png",
];

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

async function readLocalEnv() {
  try {
    return parseEnvFile(await readFile(path.join(root, ".env.local"), "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    throw error;
  }
}

const localEnv = await readLocalEnv();
const config = {
  supabaseUrl: process.env.SUPABASE_URL || localEnv.SUPABASE_URL || "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || localEnv.SUPABASE_ANON_KEY || "",
};

if (!config.supabaseUrl || !config.supabaseAnonKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY.");
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of staticFiles) {
  await cp(path.join(root, file), path.join(dist, file));
}

await mkdir(path.join(dist, "assets"), { recursive: true });
for (const file of assetFiles) {
  await cp(path.join(root, "assets", file), path.join(dist, "assets", file));
}
await writeFile(
  path.join(dist, "config.js"),
  `window.SKI_DOWNHILL_CONFIG = ${JSON.stringify(config)};\n`,
  "utf8",
);

console.log("Built dist/");
