# Releasing Snipmunk

Releases are automated with [release-please](https://github.com/googleapis/release-please). You never edit version numbers, the changelog or tags by hand. You write commit messages with a short prefix, merge a pull request when you want a release, test a draft, and click Publish.

Snipmunk reaches the network in exactly one way: the **update check** and the update's download (`latest.json` and the installer on the latest GitHub release). Capturing, annotating, recording, guides, saving and copying never touch the network. No other code may open a connection. See "Network access" at the end and [PRIVACY.md](../PRIVACY.md).

**First release?** Do section 2, then section 5.

## 1. How it works

```text
you commit "fix: ..." / "feat: ..." to main
        |
        v
release-please opens (and keeps updating) a "Release PR":  chore: release 0.1.1
   - bumps the version in package.json, Cargo.toml and Cargo.lock
   - adds the new section to CHANGELOG.md
        |   you merge it when you want a release
        v
release-please creates the tag v0.1.1 and a DRAFT GitHub Release (notes = the changelog section)
        |   same workflow run, next job
        v
the build job builds the installer, signs the updater files, uploads
   Snipmunk_0.1.1_x64-setup.exe, ...setup.exe.sig and latest.json to the draft
        |
        v
you test the installer from the draft, then click "Publish release"
        |
        v
installed copies find latest.json and offer the update
```

**One version source.** `package.json` holds the version. `src-tauri/tauri.conf.json` reads it (`"version": "../package.json"`). release-please keeps `Cargo.toml` (`[workspace.package] version`) and the `snipmunk` and `snipmunk-pixels` entries in `Cargo.lock` in step, so CI never sees a drift. The release build still checks that all of them match the tag.

**Tools of the workflows:** `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7` with Node 24, `actions/upload-artifact@v7`, Rust stable (`dtolnay/rust-toolchain`), `Swatinem/rust-cache@v2`, release-please-action pinned to v5.0.0; pnpm from `packageManager` in `package.json`; dawn-core checked out at the ref in `dawn-core.ref`. CI also runs `cargo fmt -p snipmunk --check` and clippy for the normal and the Store variant.

**Why the build is a job of the same workflow.** A tag or release created with the default `GITHUB_TOKEN` does not start other workflows (a GitHub rule against loops). A separate "on tag push" workflow would therefore never run for a tag release-please made. So `.github/workflows/release.yml` has two jobs: `release-please` (opens the PR, creates the draft and the tag) and `build` (runs only when the first job created a release, and uploads to that draft).

**Why a draft, and the tag.** The draft keeps your review step: nothing reaches users until you publish. GitHub only creates a draft's tag when it is published, so the config sets `"force-tag-creation": true`: release-please creates the tag `v0.1.1` right away. Without it, the next run would not see the release and could open a duplicate Release PR.

**If the build fails** (for example a missing secret): fix the cause, then open Actions, Release, "Run workflow", and enter the tag (for example `v0.1.1`). It rebuilds and uploads to the existing draft; no new release is created.

## 2. One-time setup

### GitHub settings (both `snipmunk` and `dawn-core`)

1. Settings, Actions, General, **Workflow permissions**: choose "Read and write permissions" and tick **"Allow GitHub Actions to create and approve pull requests"**. Without this release-please cannot open the Release PR.
2. The default branch must be `main` and must allow the Actions bot to push the release branch and tags (no rule that blocks it; if you protect `main`, the Release PR is merged like any other PR).
3. Labels: release-please creates `autorelease: pending` and `autorelease: tagged` itself the first time. Do not remove or rename them (they are how it knows a Release PR was already released).
4. Optional: **CI on the Release PR.** Pull requests made with the default token do not run CI. If you want CI checks on the Release PR, create a fine-grained personal access token (Contents and Pull requests: read and write, only for these two repositories) and add it as the repository secret `RELEASE_PLEASE_TOKEN`; the workflows use it automatically when present. Never put a token in a file or in a chat.

### The updater signing key (`snipmunk` only)

The updater only installs updates signed with your key. **Never create the private key in this repository, never commit it, and never paste it into a chat or an issue.** Do these steps on your own machine:

Snipmunk has its **own** key pair, not Owl-L's.

1. Generate it in PowerShell, from the `snipmunk` folder (choose a strong password when asked). Use this form: PowerShell does not expand `~` for the tool, which would then create a folder named `~` **inside the repository**.

   ```powershell
   pnpm tauri signer generate -w "$env:USERPROFILE\.tauri\snipmunk-updater.key"
   ```

   This writes the private key to `%USERPROFILE%\.tauri\snipmunk-updater.key` (outside any repository) and the public key to `snipmunk-updater.key.pub` next to it.

2. Copy the **public** key (one long line):

   ```powershell
   Get-Content "$env:USERPROFILE\.tauri\snipmunk-updater.key.pub" | Set-Clipboard
   ```

   Paste it into `src-tauri/tauri.conf.json` as `plugins.updater.pubkey`, replacing the whole text `REPLACE_WITH_UPDATER_PUBLIC_KEY (see docs/releasing.md, section 2)`. The release workflow refuses to run while the placeholder is there, and an installed app can only install updates signed with the matching private key.

3. Add two **GitHub Actions secrets** to the `snipmunk` repository (Settings, Secrets and variables, Actions):

   | Secret | Value |
   |---|---|
   | `TAURI_SIGNING_PRIVATE_KEY` | the full content of `%USERPROFILE%\.tauri\snipmunk-updater.key` (copy it with `Get-Content "$env:USERPROFILE\.tauri\snipmunk-updater.key" \| Set-Clipboard`) |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password you chose |

4. Back up the private key and password somewhere safe (a password manager). **If you lose the key, installed copies of Snipmunk can never update themselves again.** If it leaks, generate a new pair, release a version that carries the new public key signed with the old key, and rotate the secrets.

If a secret is missing when a release is built, the `build` job stops immediately with an error that names it. It never uploads unsigned updater files. The job also refuses to run when `dawn-core.ref` is `main` (put a dawn-core tag or commit SHA there first).

## 3. Commit messages (what you type in GitHub Desktop)

release-please reads your commit messages, so the first line of each commit must start with a **prefix**. In GitHub Desktop that first line is the **Summary** box at the bottom left (the "Description" box below it is optional and is not used for the version). Format: `prefix: short description`, all lowercase prefix, a colon and a space.

| Prefix | Use it for | Example Summary | Version while below 1.0 | In the changelog |
|---|---|---|---|---|
| `fix:` | a bug fix | `fix: keep the window position on a second monitor` | patch (0.1.1 to 0.1.2) | Bug Fixes |
| `feat:` | something users can now do | `feat: show capture results in the main window` | patch too (we configured it so; see below) | Features |
| `perf:` | faster, same behavior | `perf: start translating before the model is warm` | patch | Performance |
| `feat!:` or `fix!:` (or a `BREAKING CHANGE:` line in the Description) | a change that breaks settings, data or shortcuts | `feat!: rename the settings file` | **minor** (0.1.x to 0.2.0) | Features, marked as breaking |
| `docs:` | documentation only | `docs: explain the release steps` | none | hidden |
| `chore:` | maintenance, dependencies | `chore: update vitest` | none | hidden |
| `ci:` | workflows | `ci: pin the release action` | none | hidden |
| `test:` / `refactor:` / `style:` / `build:` | no visible change | `refactor: split the updater module` | none | hidden |

Optional scope in brackets: `fix(updater): say "no update information" when there is no release`.

Rules of thumb:

- One commit, one purpose. Several `fix:` and `feat:` commits since the last release collapse into **one** version bump: the biggest one wins (`feat!` over `feat`/`fix`).
- **While the version is below 1.0** we use `bump-minor-pre-major` and `bump-patch-for-minor-pre-major`: `fix` and `feat` both give a patch (0.1.0 to 0.1.1), only a breaking change gives a minor (0.2.0), and 1.0.0 is a release you choose on purpose by adding a commit whose Description contains the line `Release-As: 1.0.0`.
- Commits without a prefix, or with `docs:`/`chore:`/`ci:`/..., never make a release by themselves and are not listed.
- A pushed commit message cannot be changed in GitHub Desktop without rewriting history, so add a correct follow-up commit instead. If a wrong prefix would give the wrong version, add a commit whose Description contains the line `Release-As: x.y.z` for the version you want (editing the Release PR's title does not change it).
- If you merge pull requests with "Squash and merge", the **PR title** is the commit message, so it needs the prefix. With "Create a merge commit", the individual commits count.

`dawn-core` works the same way (its tags are what you put into `dawn-core.ref`), but it uses the standard rule: `feat:` bumps the minor (0.1.1 to 0.2.0), `fix:` the patch. Its manifest starts at `0.1.1`, the tag `dawn-core.ref` points at today; if that is not dawn-core's newest tag, set the manifest to the newest one before merging the first Release PR.

## 4. Releasing Snipmunk, step by step

1. **Commit** your changes with prefixed Summaries (section 3) and **push** to `main` in GitHub Desktop (Push origin).
2. CI runs. A minute later, in the `snipmunk` repository on GitHub, a pull request **"chore: release 0.1.1"** appears (Pull requests tab). Each further push to `main` updates it. Open it to see the new version and the changelog it will write. If nothing appears, no `fix:`/`feat:`/`perf:` commit has landed since the last release.
3. If `dawn-core.ref` still says `main`, change it to a dawn-core tag first (see section 6) and push that as `chore: pin dawn-core v0.1.0`.
4. **Merge the Release PR** when you want to release (Merge pull request, then Confirm).
5. Open the Actions tab: the **Release** run now has two jobs. `release-please` creates the tag and a **draft release**; `build` (about 20 to 90 minutes, depending on the cache) uploads three files to it:
   - `Snipmunk_x.y.z_x64-setup.exe`, the installer
   - `Snipmunk_x.y.z_x64-setup.exe.sig`, its updater signature
   - `latest.json`, what the updater reads
6. **Test the draft.** In Releases, open the draft ("Draft" label), download the installer and run the manual test list in section 7. Drafts are only visible to you.
7. **Publish.** Edit the draft, check the notes, click **Publish release**. From then on `https://github.com/Second-Dawn-Lab/snipmunk/releases/latest/download/latest.json` exists and installed copies offer the update.

To withdraw a bad release before or after publishing, delete the release or turn it back into a draft (`latest` then points at the previous published release), fix the problem with `fix:` commits and release the next patch version. Do not reuse a version number.

## 5. The first release, 0.1.0

`.release-please-manifest.json` says `0.0.0` (nothing is released yet) while `package.json` and `Cargo.toml` already say `0.1.0`. The first release is named by a footer in the commit, not guessed: **`Release-As: 0.1.0`**. Do not edit the manifest by hand; the Release PR sets it to `0.1.0`.

Do this in order:

1. **Key and secrets** (section 2): generate the key, paste the public key into `src-tauri/tauri.conf.json`, add `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to the repository, and set the workflow permissions.
2. Check that `dawn-core.ref` names a tag that exists on GitHub (`v0.7.0`).
3. In **GitHub Desktop**, repository `snipmunk`: look through the Changes list (no `.key` file, no `target` folder, no `identity.json` unless you mean to). Commit **everything as one commit** with
   - **Summary:** `feat: first release of Snipmunk for Windows`
   - **Description** (exactly this one line): `Release-As: 0.1.0`

   Do not start the Summary with `chore: release`: that is the title of release-please's own pull request.
4. **Commit to main**, then **Push origin**.
5. On GitHub, **Actions**: wait for **CI** to be green. The **Release** run's first job opens a pull request **"chore: release 0.1.0"** (Pull requests tab). It changes `CHANGELOG.md` (all earlier `feat:` / `fix:` commits are listed) and the manifest. If it names another version, do not merge it: check the commit's description.
6. **Merge pull request** → **Confirm merge**.
7. **Actions → Release**: `release-please` creates the tag `v0.1.0` and a draft release; `build` uploads `Snipmunk_0.1.0_x64-setup.exe`, its `.sig` and `latest.json`. If it fails, fix the cause and use **Run workflow** with the tag `v0.1.0`.
8. **Releases → the draft**: download the installer and test it (section 8). You may shorten the notes. Then **Publish release**.

## 5a. The update test, 0.1.0 → 0.1.1

1. Keep the published **0.1.0** installed (from the release, not a local build).
2. Make a small real fix (or a harmless one, for example a spelling correction in the app) and commit it with the Summary `fix: ...`; push. Wait for CI, merge **"chore: release 0.1.1"**, test the draft's files exist, **Publish release**.
3. Start the installed 0.1.0: **Settings → About → Check for updates**. It must say "Snipmunk 0.1.1 is available". (The quiet check after a start also finds it, at most once a day; if you checked in the last 24 hours it waits until tomorrow.)
4. Press **Update and restart**: progress, then Snipmunk closes, the installer runs without questions, and 0.1.1 starts. **About** shows 0.1.1; settings, screenshots and the Start menu shortcut are as before.
5. Repeat once with unsaved work (an unsaved recording): the question **Update now?** comes first; **Later** keeps 0.1.0 running and the notice stays; **Update and restart** again asks again, and **Update without saving** (or **Save…**) installs it.
6. With the network off, a start shows nothing; **Check for updates** says the server could not be reached.

## 6. dawn-core releases

`dawn-core` has the same flow without an installer: `.github/workflows/release-please.yml` keeps a Release PR open; merging it creates the tag (for example `v0.1.0`) and a GitHub release with the changelog. Put that tag in `snipmunk/dawn-core.ref` so release builds are reproducible. The Cargo crates inside dawn-core keep their internal version `0.0.0`; the tag is the version.

## 7. Windows code signing (SmartScreen)

The updater signature above protects the update channel; it is **not** a Windows code-signing certificate. Without one, Windows SmartScreen shows "Windows protected your PC / Unknown publisher" on a fresh download until the file earns reputation. The README tells users how to continue ("More info", then "Run anyway").

| Option | Cost | What it takes | Notes |
|---|---|---|---|
| **SignPath Foundation** | Free for open-source projects | An application, review by SignPath; the project must be public and OSI-licensed, with a code signing policy and no malware or closed-source parts. Signing runs in CI through their GitHub Action; the certificate is issued to SignPath Foundation, so the publisher shows as "SignPath Foundation". | Best fit. Reputation still builds up over time. |
| **Azure Trusted Signing** | Paid (about 10 USD a month) | A verified identity, an Azure subscription. | Easy GitHub integration, publisher shows your verified name. |
| **Unsigned** | Free | Nothing | Users see the SmartScreen warning for a long time. Acceptable for a first, small release. |

We apply to SignPath Foundation. Ready in the repository: [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md) (link it from the README), [PRIVACY.md](../PRIVACY.md), [SECURITY.md](../SECURITY.md), [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md). The text for the application form is still to be written (Owl-L's `docs/signpath-application.md` is the model). Check SignPath Foundation's current conditions on their website before applying; they may have changed.

### Turning SignPath on (after the application is approved)

The signing steps are already in `.github/workflows/release.yml` but do nothing while the repository variable `SIGNPATH_ENABLED` is not `true`. With it off, the release is built exactly as before (unsigned installer, updater signature made by `tauri build`).

1. In SignPath: you get an organization, create (or are given) a project for Snipmunk, and a signing policy for release signing with **manual approval** (you are the Approver). Create an **artifact configuration** for each of the two things we send: one for a zip that contains `snipmunk.exe` (sign that file with the Authenticode method) and one that contains the NSIS installer `*-setup.exe`. Both come from a GitHub Actions artifact (the workflow uploads them with `actions/upload-artifact`), and the trusted build system must be linked to GitHub (SignPath asks for this; it verifies that the artifact was built by the workflow of this repository). If your SignPath project has one artifact configuration only, you can use two projects or an artifact configuration that signs `*.exe` files in the zip, and then set the slugs accordingly.
2. In SignPath create an **API token** for a CI user that may submit requests to that policy. Add it as the GitHub Actions secret **`SIGNPATH_API_TOKEN`** in the `snipmunk` repository (never in a file or a chat).
3. In `.github/workflows/release.yml` replace the three placeholders (each appears twice, once for snipmunk.exe and once for the installer; if you use different projects or policies for the two, set them separately):
   - `REPLACE_WITH_SIGNPATH_ORGANIZATION_ID` - the organization id (a GUID, in the SignPath URL)
   - `REPLACE_WITH_SIGNPATH_PROJECT_SLUG` - the project slug
   - `REPLACE_WITH_SIGNPATH_SIGNING_POLICY_SLUG` - the signing policy slug (for example `release-signing`)
4. In the `snipmunk` repository set the **variable** (Settings, Secrets and variables, Actions, Variables tab) `SIGNPATH_ENABLED` to `true`. Set it back to `false` (or delete it) to release unsigned again.
5. Release as usual. The `build` job now pauses twice for your approval in SignPath (once for `snipmunk.exe`, once for the installer; you get an e-mail), then continues. If the placeholders or the secret are missing it stops at once with a message that says so.

What the workflow does when enabled, in this order (the order matters):

1. `pnpm tauri build --no-bundle` builds `snipmunk.exe` only.
2. `snipmunk.exe` is signed by SignPath, and the signed file replaces the built one.
3. `pnpm tauri bundle --bundles nsis` builds the installer around the signed `snipmunk.exe`, without the updater config (so no `.sig` yet).
4. The installer is signed by SignPath.
5. `pnpm tauri signer sign` makes the updater signature (`.sig`) **of the signed installer**. The `.sig` covers the exact bytes of the file users download, so it must come last; `latest.json` and the upload follow unchanged.

Before the first signed release, try it on a throwaway tag via "Run workflow" and check: the installer's properties (Digital Signatures tab) show SignPath Foundation, the installed `snipmunk.exe` is signed too, and the in-app update from the previous version still works (the updater signature must verify). Two points were written from SignPath's and Tauri's documentation and not yet run, so check them in that first run: the folder layout of the signed zip that the SignPath action unpacks into `signed-exe` / `signed-installer`, and the artifact configuration slugs.

## 8. Manual test list for a release

Run on a clean Windows user profile (or a fresh VM), using the installer from the **draft release**:

1. Install from `Snipmunk_x.y.z_x64-setup.exe` (SmartScreen: More info, Run anyway). The install is per user (no admin prompt). The last page offers "Create desktop shortcut" (ticked). Check that a **Start menu shortcut and a desktop shortcut** exist, that Snipmunk starts, and that taskbar and Task Manager show one "Snipmunk". Double-click a `.snpr`, a `.snpd` and a `.snpt` file (own icons; the template asks before it is imported), also while Snipmunk runs.
2. Resize and move the window, close it (default: Snipmunk quits; no Snipmunk or WebView2 process stays), start it again: size and position are remembered.
3. Settings: set "When the window is closed" to "Keep running in the tray": the tray icon appears. Switch theme (system, light, dark) and language (English, German); the tray menu follows the language. Close the window, reopen it from the tray; set the setting back: the icon goes.
4. Settings: turn on "Start with Windows", sign out and in: Snipmunk starts minimized (only in the tray with "Keep running in the tray"). Turn it off again.
5. Start a second copy: the running window comes to the front.
6. Settings → About: the version; **Check for updates** says "up to date" while no newer release is published; with the network off, that the server could not be reached. With the network off a start shows no message.
7. Close the app, start it again: the kept session and its screenshots are still there (auto-keep). Settings, "Clear on exit" on: after quitting, the session is empty.
8. Uninstall (Settings, Apps): leave **Delete the application data** unticked and check that `%AppData%\SecondDawn\snipmunk` is still there, and that the shortcuts, the three file types and the "Start with Windows" entry are gone. Reinstall, uninstall again with the box **ticked**: `%AppData%\SecondDawn\snipmunk`, `%Temp%\Snipmunk` and `%LocalAppData%\lab.seconddawn.snipmunk` are gone; files you saved elsewhere and `%AppData%\SecondDawn\models` stay. (Do the ticked test on a test profile or after a backup: it deletes your screenshots.)
9. Update test: section 5a.

## 9. Network access

| Code | When | What is sent |
|---|---|---|
| `src-tauri/src/updates.rs` (`tauri-plugin-updater`; not in the Store build) | After a start, at most once a day while "Check for updates automatically" is on; and when the user presses "Check for updates" | An HTTPS GET for `latest.json` on GitHub |
| The same | Only after "Update and restart" | An HTTPS GET for the installer of that release; its signature is checked before it is run |

Screenshots, recordings, guides, sessions and settings never touch the network. Anything new that needs the network must be added to this table and to [PRIVACY.md](../PRIVACY.md) first.
