# Paseo Secrets

A Paseo plugin for browsing and managing a [`pass`](https://www.passwordstore.org/) store.

Agent usage: see [skills/paseo-secrets/SKILL.md](skills/paseo-secrets/SKILL.md).

## Features

- List every entry without decrypting it.
- Filter entries locally, case-insensitively.
- Reveal or copy an entry's value; notes are shown with the entry.
- Add an entry with a value and optional notes. Adding an existing name asks before replacing it.
- Edit an existing entry's value and notes.
- Delete an entry after confirmation. Empty parent directories are pruned by `pass`.

## Requirements

- Paseo 0.15 or later.
- `pass` 1.7 and a working GPG key. The store should already exist.
- `PASSWORD_STORE_DIR` if the store is not at `~/.password-store`.
- `PASS_BIN` if `pass` is not on PATH.

## Install

```bash
paseo plugin install ~/Projects/paseo-plugins/plugins/secrets
```

Then open **Secrets** in the sidebar.

## Configuration

| Variable | Meaning |
| --- | --- |
| `PASSWORD_STORE_DIR` | Store root. Defaults to `~/.password-store`. |
| `PASS_BIN` | Path to the `pass` binary. Otherwise PATH is searched, then `~/.nix-profile/bin/pass`. |

## Security

- The secret value is sent to `pass insert -m -f` on stdin and never in argv.
- Listing walks the store with filesystem calls; it does not run `pass` or `gpg`.
- The plugin logs neither values nor notes.
- Names that could escape the store or look like `pass` options are rejected before writing.

Existing entries with names created by other `pass` tooling can still be opened, edited, and removed. New names use the stricter add-form charset.

## Development

```bash
npm install
npm run typecheck
paseo plugin reload paseo-secrets
```

The plugin source is the directory itself. Reload after edits; do not restart the daemon.

## Limitations

No rename or move, OTP, password generation, import or export, sync, or multi-user support. Editing changes the value and notes, not the entry name.
