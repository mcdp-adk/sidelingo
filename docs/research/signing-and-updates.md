# Code signing and updates for the portable build

Research for [#25](https://github.com/mcdp-adk/sidelingo/issues/25), under the map [#1](https://github.com/mcdp-adk/sidelingo/issues/1). Facts as of 2026-09-30. It gathers the outside facts needed to decide whether sidelingo's single portable exe ([ADR 0003](../adr/0003-build-on-tauri-2-with-react.md), [ADR 0004](../adr/0004-keep-state-in-appdata-not-beside-the-exe.md)) is code-signed, and how, and whether it updates itself, checks for updates, or does neither. It does not make the decision.

## Method and labels

- Sources are vendor documentation (Microsoft Learn, Microsoft Support, Azure's retail price API, SignPath Foundation's terms, Certum's shop and support pages, the CA/Browser Forum), GitHub's REST API docs, and source code: `tauri-plugin-updater` 2.13.1 at [`plugins-workspace@2fd4bed`](https://github.com/tauri-apps/plugins-workspace/blob/2fd4bedc8b9a57afbf6af5fd2be315adeeb857d7/plugins/updater/src/updater.rs) and `tauri-bundler` at [`tauri@f040897`](https://github.com/tauri-apps/tauri/blob/f04089769d8c6bcd1b8d31870e26390019715ebc/crates/tauri-bundler/src/bundle.rs). The current releases are `tauri` 2.12.0 and `tauri-plugin-updater` 2.13.1 (crates.io, 2026-09-26 and 2026-09-29).
- Each claim carries one label where it matters:
  - **Verified**: stated by the cited primary source.
  - **Derived**: an inference from the cited sources that no source states in so many words.
  - **Unverified**: could not be confirmed from a primary source; treat as a lead.

## Summary

| Question | Answer |
| --- | --- |
| Azure Artifact Signing | US$9.99/month (Basic). Individuals must be in the **US or Canada**, so an individual in China is not eligible. Official GitHub Action with OIDC. No instant SmartScreen reputation. **Verified** |
| SignPath Foundation | Free for OSS; the certificate names **"SignPath Foundation"** as publisher. Requires an existing release, a verifiable reputation, builds on GitHub-hosted runners, manual approval of each signing, MFA, and a published code signing policy. One condition ("without commercial dual-licensing for all components") may touch the Read Frog prompts. **Verified**, fit **Unverified** |
| Certum Open Source Code Signing | €49 (cloud, SimplySign) or €69 (card + reader set); issued to an individual as "Open Source Developer, <name>". Keys in an HSM or smart card. No official headless CI signer; third-party tools automate the TOTP. The cloud product showed "out of stock" on 2026-09-30. **Verified** (CI tools **Unverified**) |
| Standard OV / EV | Microsoft cites OV at $150–300/year and EV at $400+/year. **EV lost its instant SmartScreen reputation in 2024.** **Verified** |
| SmartScreen, unsigned | "Windows protected your PC"; the user must choose "Run anyway". Every new version starts again from zero reputation. **Verified** |
| SmartScreen, signed but new | Still warned until reputation accrues, but the verified publisher name is shown. Reputation can carry over to later releases signed with the same identity. **Verified** |
| Smart App Control | Blocks unsigned code outright, with no per-app override, when the cloud service can't vouch for it. It checks all executables, not just downloads. Microsoft publishes no adoption figures. **Verified** (prevalence **Unverified**) |
| Tauri updater on a bare exe | Not supported. Windows updates must be MSI or NSIS; any `.exe` payload is treated as an NSIS installer, launched, and the app exits. A minisign signature is mandatory and separate from Authenticode. **Verified** (source) |
| Portable alternatives | `self_update` 1.3.0 (GitHub backend, uses `self-replace`); `self-replace` 1.5.0 (rename-and-replace on Windows); or a notice-only check against `GET /repos/{owner}/{repo}/releases/latest`. **Verified** |
| GitHub rate limit | 60 unauthenticated requests per hour **per IP**; conditional `304`s only avoid the count when authenticated. **Verified** |
| AV false positives | A long-running, still-open Tauri issue; maintainers suspect WebView2 use, the updater, and Rust itself. The only remedy they offer is submitting the file to Microsoft. **Verified** (causes **Unverified**) |

## 1. Code signing options

### 1a. Azure Artifact Signing (formerly Trusted Signing)

**Eligibility.**

- The quickstart says: "Individual developers must be located in the United States or Canada." It lists Public Trust organizations in the US, Canada, the EU, the UK, Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway and Israel. "These geographic restrictions do not apply to Private Trust certificates" ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), updated 2026-09-29). **Verified.**
- Microsoft's [code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) page (2026-08-29) gives a narrower organization list (US, Canada, EU, UK) but the same individual rule. It sends individuals outside the US and Canada to OV certificates. **Verified.** The two pages disagree on organizations; both exclude China.
- Private Trust is useless for public distribution. It is for an organization's own devices and App Control policies. The quickstart also says "Private identity validation is only for Organizations." **Verified.**
- Other requirements:
  - A paid Azure subscription; free, trial and sponsored subscriptions are refused ([FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)).
  - For individuals, an Azure billing account of type Individual whose legal name and address match a government ID.
  - ID verification through AU10TIX and Microsoft Authenticator Verified ID ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)).
  - **Verified.**
- **Derived:** an individual maintainer in China is not eligible, and sidelingo has no organization to apply as.

**Price.** The Azure retail prices API lists meters under the old "Trusted Signing" service name ([query](https://prices.azure.com/api/retail/prices?$filter=contains(serviceName,'Signing'))). Microsoft's docs also say "~$9.99/month", and the [FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq) says billing is not pro-rated. **Verified.**

| SKU | Monthly | Included signatures |
| --- | --- | --- |
| Basic | US$9.99 | 5,000 |
| Premium | US$99.99 | 100,000 |

Signatures beyond the included amount cost US$0.005 each. The public [pricing page](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/) renders prices client-side and gave only the signature counts to a fetch.

**CI.**

- Microsoft maintains [`Azure/artifact-signing-action`](https://github.com/Azure/artifact-signing-action) (v2.0.0, 2026-05-14). It runs on `windows-2022` and `windows-2025` hosted runners and recommends OpenID Connect with federated credentials. Client secrets are the fallback ([integrations](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)). **Verified.**
- Certificates are valid for three days, so timestamping is essential. **Verified.**
- Tauri's docs cover Artifact Signing via `bundle.windows.signCommand` ([Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/), updated 2026-09-11). **Verified.**

**SmartScreen.**

- Artifact Signing "does **not** provide instant SmartScreen trust". Consecutive releases signed with one identity let publisher reputation build ([code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)). **Verified.**
- It issues no EV certificates and has no plan to ([FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)). **Verified.**

### 1b. SignPath Foundation

All from the [SignPath Foundation conditions](https://signpath.org/terms), which the page itself marks as a draft code of conduct, unless noted.

**What it gives.**

- A free SignPath.io subscription and use of a certificate issued to **SignPath Foundation**.
- "The code signing certificate is issued to SignPath Foundation. This means that SignPath Foundation is the publisher of the OSS project." The publisher shown to users is therefore SignPath Foundation, not sidelingo or its owner.
- Keys live on SignPath's HSM ([signpath.org](https://signpath.org/)).
- **Verified.**

**Eligibility conditions.** **Verified** unless marked.

- An OSI-approved license "without commercial dual-licensing for all components". GPL-3.0-only qualifies. But Read Frog, whose prompts sidelingo copies, says it is dual-licensed under GPLv3 and a commercial license (see [ADR 0001](../adr/0001-gpl-3-0-only-to-reuse-read-frog-prompts.md)). Whether that counts is **Unverified**: the clause more likely targets projects that sell commercial licenses themselves. Ask SignPath when applying.
- No proprietary components, but System Libraries (as defined in GPLv3 section 1) may be included. The WebView2 SDK is BSD-licensed per the [GPL runtime research](https://github.com/mcdp-adk/sidelingo/blob/research/gpl-runtime-compatibility/docs/research/gpl-runtime-compatibility.md).
- The project must be actively maintained and **already released in the form to be signed**, with its functionality described on its download page.
- **A reputation requirement:** "For executable programs that may be downloaded and executed based on our signature, we require a certain verifiable reputation." There is no numeric threshold, and acceptance is at SignPath's discretion with no arbitration. **Derived:** a pre-release hobby project is unlikely to qualify on day one.
- Team rules:
  - MFA on SignPath and GitHub for every member.
  - Named Authors, Reviewers and Approvers.
  - "Each signing request must be approved" by a trusted member, so every release needs a manual approval.
- A "Code signing policy" on the home page and release pages. It must include the sentence "Free code signing provided by SignPath.io, certificate by SignPath Foundation", the team roles, and a privacy statement.
- The privacy rule: software that sends user data "to systems not specified by the user" must disclose this and let users turn it off. **Derived:** sidelingo only sends text to the provider the user configures, so a plain privacy statement should suffice.
- Signed binaries must carry product name and version metadata. The source must not include hacking tools, malware or PUA.

**CI.**

- SignPath's [GitHub integration](https://docs.signpath.io/trusted-build-systems/github) uses [`SignPath/github-action-submit-signing-request`](https://github.com/SignPath/github-action-submit-signing-request) (v2).
- Artifacts are uploaded with `upload-artifact` and signed on SignPath's side.
- For OSS it verifies origin: the build must come from a GitHub workflow on **GitHub-hosted runners**. Branch-protection rules can also be enforced.
- **Verified.**

**SmartScreen.** Reputation would accrue to the shared "SignPath Foundation" publisher identity. SignPath publishes nothing about SmartScreen. **Unverified.**

### 1c. Certum Open Source Code Signing

**Price and form** ([Certum shop](https://shop.certum.eu/code-signing.html), prices as listed 2026-09-30). **Verified.**

| Product | Price | Form |
| --- | --- | --- |
| [Open Source Code Signing in the Cloud](https://shop.certum.eu/open-source-code-signing-on-simplysign.html) | from €49 | SimplySign cloud; no card or reader; **"Product is out of stock"** on 2026-09-30 |
| [Open Source Code Signing – set](https://shop.certum.eu/open-source-code-signing.html) | €69 | cryptoCertum card + reader |
| [Open Source Code Signing – code](https://shop.certum.eu/open-source-code-signing-code.html) | €25 | activation code for an existing card |

For comparison, Certum's Standard Code Signing in the Cloud is from €209 and EV Code Signing in the Cloud from €379.

**Subject and eligibility.**

- "Data in the certificate: natural person data prefixed with 'Open Source Developer' phrase".
- Certum's [required documents](https://support.certum.eu/en/code-signing-required-documents/) page says the certificates "are issued only for individuals" and require:
  - identity verification (automatic, notarial, or ID photos);
  - a utility bill;
  - the URL of the open-source project showing the subscriber's link to it.
- Certificates are revoked if used for commercially distributed software.
- No country restriction is stated.
- **Verified.** The publisher name would be the owner's legal name with the "Open Source Developer" prefix.

**Keys and validity.**

- Since 2023-06-01 the CA/Browser Forum [Code Signing Baseline Requirements](https://cabforum.org/working-groups/code-signing/requirements/) (v3.11.0, 2026-06-16) section 6.2.7.4 require the key to be "generated, stored, and used in a suitable Hardware Crypto Module". Cloud signing services run by a CA qualify. **Verified.**
- Certum's cloud product stores keys at "FIPS 140-2 level 3 or CC EAL 4+" and caps use at 5,000 signatures a month. **Verified.**
- Since [Ballot CSC-31](https://cabforum.org/2025/11/17/ballot-csc-31-maximum-validity-reduction/), code signing certificates issued on or after 2026-03-01 may be valid for at most 460 days. Multi-year products need reissues. **Verified.**

**CI.**

- SimplySign needs the SimplySign mobile app to generate access codes and SimplySign Desktop to mount a virtual card. Certum documents no headless or CI mode. **Verified.**
- Third-party projects automate it by storing the TOTP seed as a CI secret and calling Certum's cloud API over HTTPS. Examples are [`Le-Syl21/ssign`](https://github.com/Le-Syl21/ssign) and the "Super Simply Sign" action. They are unofficial, and their use of the API is not endorsed by Certum as far as could be found. **Unverified.**
- The card-and-reader variant cannot run on a GitHub-hosted runner. **Derived.**

### 1d. Standard OV and EV certificates

- Microsoft gives **OV at $150–300/year** and **EV at $400+/year**, both available worldwide ([code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)). **Verified.**
- Keys must sit on an HSM or token, as in 1c. Most CAs offer a USB token or cloud HSM. **Verified.**
- **EV no longer gives instant reputation:** "That behavior was removed in 2024. EV-signed files now go through the same reputation-building process as OV certificates" ([code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options); likewise [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) and [Tauri's docs](https://v2.tauri.app/distribute/sign/windows/)). **Verified.**
- Tauri's docs add that OV certificates are generally available to individuals. **Verified.**

### Signing a bare exe with Tauri's tooling

In `tauri-bundler`, `bundle_project` returns before any signing when no bundle targets are configured. It signs the main binary per package type and then restores the unsigned binary after each bundle ([`bundle.rs`](https://github.com/tauri-apps/tauri/blob/f04089769d8c6bcd1b8d31870e26390019715ebc/crates/tauri-bundler/src/bundle.rs)). **Verified** (source).

**Derived:** a portable build that skips bundling leaves `sidelingo.exe` unsigned. CI must sign the exe itself, with signtool, the Artifact Signing action, or SignPath's action.

## 2. SmartScreen, Mark of the Web and Smart App Control

**What users see.** From [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), updated 2026-08-17. **Verified.**

| Build | First-download behaviour |
| --- | --- |
| No signature | "Windows protected your PC"; the user must choose "Run anyway". "Enterprise policy can prevent continuation entirely." |
| Self-signed | Same as no signature |
| OV/EV/Artifact Signing, new | Flagged as unrecognized until reputation accumulates; the verified publisher name is shown |

- The dialog's first screen shows only a "More info" link. Selecting it reveals the app name, the publisher ("Unknown publisher" when unsigned) and the "Run anyway" button. Microsoft's docs name only the dialog title and "Run anyway", so the "More info" step comes from Microsoft Q&A threads and common observation. **Unverified** as a first-party statement.
- Edge warns at download time as well. Unknown files show a warning, and the user reaches the file through "... | Keep | Show More | Keep anyway" ([Edge SmartScreen](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-smartscreen)). **Verified.**

**How reputation accrues.** From the same reputation page. **Verified.**

- Two signals count: publisher (certificate) reputation and file-hash reputation.
- Unsigned files build reputation per version from zero. Reputation "cannot transfer from previous versions unless both were signed using the same publisher identity".
- There is "no exact threshold, but it can take several weeks and hundreds of clean installs from a wide audience".
- There is no manual submission for consumer reputation. The Microsoft Security Intelligence portal is for enterprise review and false positives.

**Mark of the Web.**

- Browsers write a `Zone.Identifier` alternate data stream on downloads; `ZoneId=3` means the Internet zone ([MS-FSCC](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fscc/6e3f7352-d11c-4d76-8c39-2516a9df36e8); [Unblock-File](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/unblock-file) removes it). Applications set it through Attachment Services ([IAttachmentExecute](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-iattachmentexecute)). **Verified.**
- Microsoft's reputation page contrasts SmartScreen with Smart App Control, whose checks "apply to all executable files, not just those downloaded from the Internet". That implies SmartScreen's run-time prompt is tied to downloaded (MOTW) files. **Derived.**
- **Derived:** an exe that sidelingo downloads with its own HTTP client carries no MOTW unless the app writes one, so a self-update would not trigger the SmartScreen dialog. Smart App Control still applies.

**Smart App Control (SAC).**

- How it decides:
  - If the cloud service confidently judges an app safe, it runs.
  - Otherwise it runs only if validly signed by a CA in the Trusted Root Program.
  - "If the app is unsigned, or the signature is invalid, Smart App Control will consider it untrusted and block it."
  - "There is currently no way to bypass Smart App Control protection for individual apps."
  - Sources: [SAC FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions) and [SAC for developers](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview). **Verified.**
- **Derived:** an unsigned, low-reputation sidelingo.exe is blocked outright on a PC with SAC in enforcement mode. The user's only way round it is turning SAC off.
- Availability:
  - SAC arrived in Windows 11 22H2 and starts in evaluation mode. It turns itself off for enterprise-managed or developer-mode devices, and when optional diagnostic data is off ([App Control overview](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/appcontrol), [SAC FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)).
  - The developer page (2025-11-18) says SAC needs a clean install and "is only enabled in certain regions". The newer support FAQ says recent updates allow turning it on, or back on, without a clean install.
  - **Verified.** The two pages disagree on the clean-install rule; the FAQ is newer.
- **How common SAC is: Unverified.**
  - Microsoft publishes no adoption figures.
  - Its list of regions is not public. Whether mainland China is included could not be confirmed from a first-party source; third-party write-ups say it launched only in North America and Europe.

## 3. Updates

### Tauri's updater (`tauri-plugin-updater`)

**Formats.**

- The [updater docs](https://v2.tauri.app/plugin/updater/) (updated 2025-11-28) list Windows update artifacts only as MSI (`.msi` + `.msi.sig`) and NSIS (`-setup.exe` + `.sig`). They say nothing about portable builds. **Verified.**
- The source confirms it ([`updater.rs`](https://github.com/tauri-apps/plugins-workspace/blob/2fd4bedc8b9a57afbf6af5fd2be315adeeb857d7/plugins/updater/src/updater.rs)):
  - The Windows `Installer` enum has only `Msi` and `Nsis`.
  - `extract_exe` classifies *any* PE file as `WindowsUpdaterType::nsis` and anything else non-MSI as `InvalidUpdaterFormat`.
  - `install_inner` launches the file with `ShellExecuteW`, passing NSIS flags such as `/UPDATE` and `/ARGS`, then calls `std::process::exit(0)`.
  - **Verified** (source).
- **Derived:** pointed at a bare exe, the plugin would start the new exe from a temp folder with installer flags and exit. It would never replace the exe the user launched. In practice it does not support portable builds.
- A Tauri maintainer said of portable builds in tauri-action#59 (2025-11-15) that "we do not directly support portable builds" ([comment](https://github.com/tauri-apps/tauri-action/issues/59)). **Verified.**

**Signatures.**

- "Tauri's updater needs a signature to verify that the update is from a trusted source. This cannot be disabled" ([updater docs](https://v2.tauri.app/plugin/updater/)). **Verified.**
- Keys come from `tauri signer generate`, and the build reads `TAURI_SIGNING_PRIVATE_KEY`. The plugin verifies with `minisign_verify` against the configured `pubkey`, and can also check the version in the signed trusted comment (`verify_signature` in `updater.rs`). **Verified.**
- This is independent of Authenticode. A signed release would need both an Authenticode certificate and the minisign key pair. **Verified.**

### Alternatives for a portable exe

- **`self_update` 1.3.0** ([repo](https://github.com/jaemk/self_update), 2026-09-02). "Self updates for standalone executables". **Verified.**
  - Backends: GitHub (the default feature), GitLab, Gitea, Gitee, S3, and a static manifest.
  - It depends on `self-replace`.
  - Integrity: the `checksums` feature checks the SHA-256 `digest` that GitHub publishes per release asset. The README notes this is "an *integrity* check only", because GitHub recomputes the digest if an asset is replaced.
  - Authenticity: the `signatures` feature uses zipsign, and only for `.zip`/`.tar.gz` artifacts.
  - Its defaults are interactive, printing to stdout and prompting on stdin. A GUI must set `no_confirm(true)` and `show_output(false)`.
- **`self-replace` 1.5.0** ([repo](https://github.com/mitsuhiko/self-replace)). **Verified.**
  - Windows lets a running exe be renamed but not deleted.
  - The crate moves the running exe aside and puts the new one at the original path.
  - The old file is deleted after exit by a helper copy opened with `FILE_FLAG_DELETE_ON_CLOSE`.
- **Derived:** self-replacement needs write access to the exe's folder. It works in Downloads or Desktop but fails if the user put the exe under `Program Files`. It also needs its own authenticity check, such as a minisign or Authenticode check before swapping, which neither crate provides for a bare exe.
- **Notice only.**
  - [`GET /repos/{owner}/{repo}/releases/latest`](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) returns the most recent non-prerelease, non-draft release, sorted by `created_at`, which is the date of the release's commit. Assets carry a `digest` field. **Verified.**
  - A stable download link is `https://github.com/{owner}/{repo}/releases/latest/download/{asset}` ([linking to releases](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)). **Verified.**
  - The web URL `https://github.com/{owner}/{repo}/releases/latest` answers with a `302` whose `Location` names the latest tag. This was observed on 2026-09-30 but is not documented as an API, so the REST endpoint is the supported path. **Unverified** as a contract.

### GitHub API rate limits

- "The primary rate limit for unauthenticated requests is 60 requests per hour", counted per originating IP ([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)). A live call on 2026-09-30 returned `X-RateLimit-Limit: 60`. Exceeding it returns `403` or `429` with `x-ratelimit-remaining: 0`. **Verified.**
- A conditional request (`If-None-Match` with the `ETag`) that returns `304` "does not count against your primary rate limit" **only** "if … the request was made while correctly authorized with an Authorization header" ([best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)). An app without a token gets no ETag discount. **Verified.**
- **Derived:** one check at startup or once a day is far below the limit for one user. Users behind a shared NAT or corporate egress share the 60, so a failed check must be silent and non-blocking.
- Reachability of `api.github.com` from mainland China was not researched.

## 4. Antivirus false positives

- Tauri's tracking issue [tauri#2486](https://github.com/tauri-apps/tauri/issues/2486), "Trojan alert from windows defender and other anti-virus providers", has been open since 2021-08-18, and maintainers point new reports to it ([#10649](https://github.com/tauri-apps/tauri/issues/10649), Defender, 2024). Related closed reports include [#10302](https://github.com/tauri-apps/tauri/issues/10302) (Kaspersky), [#7292](https://github.com/tauri-apps/tauri/issues/7292) (McAfee), [#4749](https://github.com/tauri-apps/tauri/issues/4749) (several VirusTotal engines, main exe included). **Verified.**
- The maintainers' view there, in 2023–2025 comments, is that AV engines dislike compiled languages and Rust. They name the WebView2 usage and Tauri's updater as further likely triggers, and say they have no insight into vendors' heuristics. These are the maintainers' guesses. **Unverified** as causes.
- Tauri's advice is to submit the file as a false positive to Microsoft ([#10649](https://github.com/tauri-apps/tauri/issues/10649)). Microsoft's guide says to dispute a detection by submitting the file "as a software developer" at the [WDSI portal](https://www.microsoft.com/wdsi/filesubmission), and that prevalent files and authenticated enterprise customers are prioritized ([submission guide](https://learn.microsoft.com/en-us/defender-xdr/submission-guide)). **Verified.**
- Even Tauri's own NSIS helper DLL has drawn detections after changes that went away later ([tauri#14882](https://github.com/tauri-apps/tauri/issues/14882), 2026-02). **Verified.**
- **Derived:** a portable build skips NSIS and the updater plugin, which removes two of the suspected triggers but not WebView2 or Rust.
- No primary source says signing prevents heuristic AV detections. Microsoft ties signing to SmartScreen and SAC, not to Defender's malware verdicts. **Unverified.**

## Open points for the decision

- Neither free route fits today:
  - Artifact Signing excludes individuals outside the US and Canada.
  - SignPath requires a released project with a verifiable reputation.
  - Certum's cheap open-source certificate needs a phone-generated TOTP, or a card, for each signing session, and its cloud variant was out of stock on 2026-09-30.
- Whether Read Frog's dual licensing trips SignPath's condition needs SignPath's answer.
- Any self-update needs two things: a signature check on the downloaded exe before swapping, and a writable exe folder. The Tauri updater provides neither for a portable build.
