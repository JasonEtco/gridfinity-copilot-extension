# Security

Gridfinity Builder is experimental. Security fixes target the current `main`
branch; older snapshots do not have a separate support commitment.

## Reporting a vulnerability

Please do not publish exploit details, private designs, reference photos,
credentials, or panel tokens in an issue or pull request.

GitHub private vulnerability reporting is enabled for this repository. Use
**Security → Report a vulnerability**:

https://github.com/JasonEtco/gridfinity-copilot-extension/security/advisories/new

If that option is unavailable, open a minimal public issue asking the maintainer
to enable private reporting or arrange a private channel. Include **no technical
details or sensitive attachments** until a private channel is available.
This policy does not promise a response deadline.

In a private report, include the affected commit, Copilot and OS versions,
reproduction steps, expected impact, and a minimal synthetic example. Redact
tokens, local paths identifying people, and private image data.

## Local data and trust

- Designs and photos are stored outside the repository under
  `$COPILOT_HOME/extensions/gridfinity-builder/artifacts/`.
- Exported JSON may embed the reference photo. Review it before sharing.
- The workbench uses a loopback server with per-panel tokens and browser origin
  checks. A live panel URL contains a token and must not be shared.
- The viewer and photo editor work locally, but data Copilot reads through
  canvas actions should be treated like data shared in Copilot chat.
- Review extension code and repository scripts before trusting or installing
  them. Do not run unknown scripts with credentials you cannot risk exposing.

For installation and geometry limitations, see [README.md](README.md).
