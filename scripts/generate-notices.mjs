import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.npm_execpath) throw new Error("Run this script with pnpm notices.");
const pnpmIsScript = /\.[cm]?js$/i.test(process.env.npm_execpath);
const run = (command, args) =>
  execFileSync(
    command === "pnpm" ? (pnpmIsScript ? process.execPath : process.env.npm_execpath) : command,
    command === "pnpm" && pnpmIsScript ? [process.env.npm_execpath, ...args] : args,
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const sections = [];
// These npm packages omit their upstream license file. Pin the exact package
// versions so a dependency change requires checking the upstream notice again.
const missingLicenses = {
  "@fluentui/react-icons@2.0.343": "fluentui-system-icons.txt",
  "embla-carousel@8.6.0": "embla-carousel.txt",
  "embla-carousel-autoplay@8.6.0": "embla-carousel.txt",
  "embla-carousel-fade@8.6.0": "embla-carousel.txt",
};

// pnpm includes production dependencies and their transitive dependencies.
const frontend = Object.values(JSON.parse(run("pnpm", ["licenses", "list", "--prod", "--json"])))
  .flat()
  .sort((a, b) => a.name.localeCompare(b.name));
for (const dependency of frontend) {
  for (const directory of dependency.paths) {
    const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const files = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^(licen[sc]e|copying|notice)([.-]|$)/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const fallback = missingLicenses[`${metadata.name}@${metadata.version}`];
    if (!fallback && !files.some((name) => /^(licen[sc]e|copying)([.-]|$)/i.test(name))) {
      throw new Error(`No license text packaged by ${metadata.name}@${metadata.version}`);
    }
    const texts = await Promise.all(
      files.map(
        async (name) => `<h4>${escape(name)}</h4><pre>${escape(await readFile(join(directory, name), "utf8"))}</pre>`,
      ),
    );
    if (fallback)
      texts.push(
        `<h4>Upstream LICENSE</h4><pre>${escape(await readFile(join(root, "scripts/licenses", fallback), "utf8"))}</pre>`,
      );
    sections.push(
      `<section><h3>${escape(metadata.name)} ${escape(metadata.version)}</h3><p>${escape(dependency.license)}</p>${texts.join("\n")}</section>`,
    );
  }
}

const temporary = await mkdtemp(join(tmpdir(), "sidelingo-notices-"));
let rust;
try {
  const report = join(temporary, "rust.json");
  run("cargo", [
    "about",
    "generate",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--locked",
    "--fail",
    "--format",
    "json",
    "--output-file",
    report,
  ]);
  rust = JSON.parse(await readFile(report, "utf8"));
} finally {
  await rm(temporary, { recursive: true });
}
for (const license of rust.licenses) {
  const dependencies = license.used_by
    .filter((usage) => usage.crate.name !== "sidelingo")
    .map((usage) => `${usage.crate.name} ${usage.crate.version}`);
  if (!dependencies.length) continue;
  if (!license.text.trim()) throw new Error(`Missing Rust license text: ${license.id}`);
  sections.push(
    `<section><h3>${escape(license.name)}</h3><p>${dependencies.map(escape).join(", ")}</p><pre>${escape(license.text)}</pre></section>`,
  );
}

const output = join(root, "src-tauri/resources/THIRD-PARTY-NOTICES.html");
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>sidelingo third-party notices</title>
<style>body{font:16px system-ui;max-width:80ch;margin:2rem auto;padding:0 1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{border-top:1px solid #aaa;margin-top:2rem}</style>
<h1>sidelingo third-party notices</h1>
<p>Generated from the installed frontend production dependency graph and the locked Rust dependency graph. These notices include the dependency license texts and packaged notices.</p>
${sections.join("\n")}
</html>\n`,
  "utf8",
);
console.log(
  `Generated third-party notices (${frontend.length} frontend packages, ${rust.licenses.length} Rust license texts).`,
);
