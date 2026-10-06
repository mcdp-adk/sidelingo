// Checks a published release the way an installed sidelingo and a careful user meet it (CONTRIBUTING.md → releasing):
// titled by its tag and Latest, its installer matching its `.sha256`, its `.sig` verifying against the updater
// public key in `tauri.conf.json`, and its `latest.json` naming this version, that signature, and the tag's own
// download link rather than a rate-limited api.github.com URL. Usage: pnpm verify:release vX.Y.Z
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  console.error("Usage: pnpm verify:release vX.Y.Z");
  process.exit(2);
}

const gh = (...args) => execFileSync("gh", args, { cwd: root, encoding: "utf8" });
const problems = [];
const check = (ok, passed, failed) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${ok ? passed : failed}`);
  if (!ok) problems.push(failed);
};

const repository = gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner").trim();
const release = JSON.parse(gh("release", "view", tag, "--json", "name,isDraft,isPrerelease"));
const latest = gh("release", "list", "--json", "tagName,isLatest", "--jq", ".[] | select(.isLatest) | .tagName").trim();
check(release.name === tag, `titled ${tag}`, `titled "${release.name}", not ${tag}`);
check(
  !release.isDraft && !release.isPrerelease && latest === tag,
  "published as Latest, so the updater endpoint serves it",
  `not the Latest published release (Latest is ${latest || "none"})`,
);

const folder = mkdtempSync(join(tmpdir(), `sidelingo-${tag}-`));
try {
  gh("release", "download", tag, "--dir", folder);
  const installers = readdirSync(folder).filter((name) => name.endsWith("-setup.exe"));
  if (installers.length !== 1) throw new Error(`expected one *-setup.exe, found ${installers.length}`);
  const [installer] = installers;
  const file = (name) => readFileSync(join(folder, name));
  const bytes = file(installer);

  const hash = createHash("sha256").update(bytes).digest("hex");
  const published = file(`${installer}.sha256`).toString("utf8").split(/\s+/)[0].toLowerCase();
  check(hash === published, `${installer} matches its .sha256`, `${installer} hashes to ${hash}, not ${published}`);

  const signature = file(`${installer}.sig`).toString("utf8").trim();
  const publicKey = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")).plugins.updater.pubkey;
  check(
    minisignVerifies(publicKey, bytes, signature),
    `${installer}.sig verifies against the updater public key`,
    `${installer}.sig does not verify against the updater public key`,
  );

  const updater = JSON.parse(file("latest.json").toString("utf8"));
  const downloadUrl = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(installer)}`;
  check(
    updater.version === tag.slice(1),
    `latest.json offers ${updater.version}`,
    `latest.json offers ${updater.version}`,
  );
  for (const [platform, entry] of Object.entries(updater.platforms)) {
    check(
      entry.url === downloadUrl,
      `latest.json ${platform} downloads from the tag`,
      `latest.json ${platform} URL is ${entry.url}`,
    );
    check(
      entry.signature === signature,
      `latest.json ${platform} carries the .sig`,
      `latest.json ${platform} signature differs from the .sig`,
    );
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`\n${tag}: ${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`\n${tag}: every check passed.`);

/**
 * Tauri's updater signatures are minisign signatures, base64-encoded once more: an Ed25519 signature over the
 * BLAKE2b-512 of the file (algorithm `ED`), then a global signature over that signature and its trusted comment.
 */
function minisignVerifies(publicKeyBase64, bytes, signatureBase64) {
  const lines = (base64) => Buffer.from(base64, "base64").toString("utf8").split(/\r?\n/).filter(Boolean);
  const keyBytes = Buffer.from(lines(publicKeyBase64)[1], "base64");
  const [, signatureLine, trustedLine, globalLine] = lines(signatureBase64);
  const signatureBytes = Buffer.from(signatureLine, "base64");
  if (keyBytes.subarray(0, 2).toString() !== "Ed" || !signatureBytes.subarray(2, 10).equals(keyBytes.subarray(2, 10))) {
    return false;
  }
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), keyBytes.subarray(10, 42)]),
    format: "der",
    type: "spki",
  });
  const prehashed = signatureBytes.subarray(0, 2).toString() === "ED";
  const message = prehashed ? createHash("blake2b512").update(bytes).digest() : bytes;
  const fileSignature = signatureBytes.subarray(10, 74);
  const trustedComment = Buffer.from(trustedLine.replace(/^trusted comment: /, ""));
  return (
    verify(null, message, key, fileSignature) &&
    verify(null, Buffer.concat([fileSignature, trustedComment]), key, Buffer.from(globalLine, "base64"))
  );
}
