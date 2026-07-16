import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const vaultPluginDir = join(
  pluginRoot,
  "..",
  "..",
  "notes",
  ".obsidian",
  "plugins",
  "board-notes"
);
const artifacts = ["main.js", "manifest.json", "styles.css"];

await mkdir(vaultPluginDir, { recursive: true });
await Promise.all(
  artifacts.map((name) => copyFile(join(pluginRoot, name), join(vaultPluginDir, name)))
);

console.log(`Deployed ${artifacts.join(", ")} to ${vaultPluginDir}`);
