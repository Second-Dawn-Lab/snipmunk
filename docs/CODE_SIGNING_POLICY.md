# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).
(Not active yet: until SignPath has accepted the project, releases are not Windows code signed; see
[releasing.md](releasing.md), section 7.)

This policy applies to **Snipmunk** ([github.com/Second-Dawn-Lab/snipmunk](https://github.com/Second-Dawn-Lab/snipmunk)), a free
screenshot, screen recording and guide app for Windows, MIT licensed.

## What is signed

Only artifacts built by the **Release workflow** ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) on GitHub
Actions, from the public source code in this repository, at the commit of a release tag:

- the Windows installer (`Snipmunk_x.y.z_x64-setup.exe`), and
- the application program inside it (`snipmunk.exe`).

Never signed: local builds on a developer's computer, builds of other branches or pull requests, and anything that is not built
from this repository. The Microsoft Store package is signed by the Store.

The release build reads one pinned version of the shared [`dawn-core`](https://github.com/Second-Dawn-Lab/dawn-core) repository
(named in [`dawn-core.ref`](../dawn-core.ref)), which is also open source (MIT). Snipmunk contains no closed-source or
proprietary components.

Separately from Windows code signing, update files are signed with Snipmunk's own updater key (see
[releasing.md](releasing.md)); that signature is checked by the app before it installs an update.

## Roles

| Role | Who |
|---|---|
| **Committers and reviewers** | The maintainer: [GitHub `engrali93`](https://github.com/engrali93) |
| **Approvers** (approve every signing request) | The maintainer: [GitHub `engrali93`](https://github.com/engrali93) |

The same person holds both roles today. Anyone who is added later is listed here before they can approve a signing request.
Every contributor's change is reviewed by a committer before it is merged into `main`.

## Approval

**Every signing request is approved manually** by an Approver in SignPath. There is no automatic approval. Before approving, the
Approver checks that the request comes from the Release workflow run of a release tag in this repository, that the draft release
was tested (see the manual test list in [releasing.md](releasing.md)), and that the release notes match the changes.

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person
installing or operating it. The one network access is the update check and download: see [PRIVACY.md](../PRIVACY.md).

## Contact

Report problems with this policy, or a suspected misuse of a signed file, as described in [SECURITY.md](../SECURITY.md).
