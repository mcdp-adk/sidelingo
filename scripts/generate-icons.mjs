// Draws sidelingo's icon files from the two sources in src-tauri/icons: icon.svg, and icon-small.svg,
// its simplified form for 24 px and below, where icon.svg's lettering blurs together.
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const icons = join(root, "src-tauri/icons");
if (!process.env.npm_execpath) throw new Error("Run this script with pnpm icons.");
const pnpmIsScript = /\.[cm]?js$/i.test(process.env.npm_execpath);
const pnpm = (args) =>
  execFileSync(
    pnpmIsScript ? process.execPath : process.env.npm_execpath,
    pnpmIsScript ? [process.env.npm_execpath, ...args] : args,
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );

// Windows picks the icon.ico frame nearest each size it draws, so 16–24 px come from icon-small.svg.
const smallSizes = [16, 20, 24, 32];
const largeSizes = [32, 40, 48, 64, 128, 256];
const icoFrames = [
  ["small", 16],
  ["small", 20],
  ["small", 24],
  ["large", 32],
  ["large", 40],
  ["large", 48],
  ["large", 64],
  ["large", 256],
];

const temporary = await mkdtemp(join(tmpdir(), "sidelingo-icons-"));
try {
  const png = (kind, size) => join(temporary, kind, `${size}x${size}.png`);
  pnpm(["tauri", "icon", join(icons, "icon-small.svg"), "-o", join(temporary, "small"), "-p", smallSizes.join(",")]);
  pnpm(["tauri", "icon", join(icons, "icon.svg"), "-o", join(temporary, "large"), "-p", largeSizes.join(",")]);

  // The tray and window icon: Windows scales this one image to every size it shows them at.
  await copyFile(png("small", 32), join(icons, "icon-small.png"));
  // The bundle icons tauri.conf.json lists besides icon.ico.
  await copyFile(png("large", 32), join(icons, "32x32.png"));
  await copyFile(png("large", 128), join(icons, "128x128.png"));
  await copyFile(png("large", 256), join(icons, "128x128@2x.png"));

  // An ICO is a 6-byte header, a 16-byte entry per frame, then the frames, here stored as PNG.
  const frames = await Promise.all(icoFrames.map(([kind, size]) => readFile(png(kind, size))));
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  icoFrames.forEach(([, size], index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size % 256, entry); // 0 means 256
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frames[index].length;
  });
  await writeFile(join(icons, "icon.ico"), Buffer.concat([header, ...frames]));
} finally {
  await rm(temporary, { recursive: true });
}
