---
status: ready
target: pass 1.7.4 at `~/.nix-profile/bin/pass`, store `~/.password-store`
last_updated: 2026-11-04
---

# Story: Paseo "Secrets" screen for `pass`

A Paseo plugin that lets the operator browse, add, reveal, copy, and delete
secrets in the existing `pass` store. It is a UI over the `pass` binary — no new
storage format, no wrapper CLI, no encryption changes.

Existing state: `pass` is installed via home-manager, the store holds
`proton/bridge`, `sentient/license`, and one docker-credential entry. The GPG key
has no passphrase, so `pass show` works non-interactively. `mail.py` reads
`proton/bridge` and must keep working.

## Acceptance criteria

1. Installing the project directory as a plugin (`paseo plugin install ~/Projects/paseo-secrets`)
   adds a sidebar item labelled **Secrets**; activating it opens a screen with the
   same title.
2. Opening the screen lists every entry under the store, with `/`-separated names
   and no `.gpg` suffix. Nested directories appear as paths (`a/b/c`).
3. Listing does not decrypt: with `GNUPGHOME` pointed at an empty directory, the
   list still renders every entry.
4. The list is filterable by substring, case-insensitive, without a round trip to
   the daemon.
5. Selecting an entry shows its value masked. The value is only displayed after
   an explicit **Reveal** action, and a **Copy** action places it on the clipboard
   via the plugin SDK's `copyText` and shows a confirmation toast.
6. Notes (every line after the first) are displayed with the entry and preserved
   byte-for-byte on read.
7. **Add** writes a new entry: after saving via the UI, `pass show <name>` returns
   the value as its first line and the notes on the following lines.
8. Adding an existing name asks for confirmation first; declining leaves the old
   entry unchanged. Confirming replaces the whole entry (value and notes).
9. The value is never passed as a command-line argument: a `pass` shim on `PATH`
   that records `process.argv` sees `insert -m -f <name>` and nothing else.
10. Deleting asks for confirmation; on confirm the entry is gone from the store,
    its now-empty parent directories are pruned, and the list refreshes.
11. Invalid names are rejected before touching disk, with an inline error:
    empty, leading `/`, trailing `/`, `..` segments, names ending in `.gpg`, and
    characters outside `[A-Za-z0-9._@+-]` per path segment.
12. An empty value is rejected with an inline error and no file is written.
13. If the store directory is missing, or the `pass` binary cannot be resolved,
    the screen shows an actionable error naming the missing thing; the plugin
    does not crash and the rest of Paseo keeps working.
14. Values never appear in plugin/daemon logs: after a list, reveal, and add,
    `paseo plugin logs paseo-secrets` contains no secret value.
15. The plugin works when the daemon's `PATH` does not include the nix profile:
    with `PATH=/usr/bin:/bin`, starts, lists, and reads still work.

## Out of scope

- No `run`/`exec` wrapper, no environment injection, no new CLI.
- No changes to `~/.password-store` layout, `.gpg-id`, or GPG keys.
- No git automation (no `pass git init`, no commits).
- No sync, remotes, sharing, or multi-user support.
- No rename/move/import/export, no OTP, no password generation.
- No settings UI; configuration comes from `PASSWORD_STORE_DIR` and `PASS_BIN`.
- No changes outside `~/Projects/paseo-secrets/`.
- No new runtime dependencies beyond the scaffold's (`@getpaseo/plugin`,
  `react`, `react-native`, `@tanstack/react-query`, `zod`).
- No refactors of the generated scaffold beyond what the ACs require.

## Contract

Store root: `process.env.PASSWORD_STORE_DIR ?? path.join(os.homedir(), ".password-store")`.

Binary resolution, first match wins: `PASS_BIN` env, `pass` on `PATH`,
`/home/celty/.nix-profile/bin/pass`. None found → error `PASS_NOT_FOUND`.

RPCs (names are fixed):

```ts
secrets.list   input { query?: string }
               output { entries: Array<{ name: string; updatedAt: number; bytes: number }> }
secrets.get    input { name: string }
               output { name: string; value: string; notes: string }
secrets.set    input { name: string; value: string; notes?: string; overwrite?: boolean }
               output { name: string }
secrets.remove input { name: string }
               output { name: string }
```

- `secrets.list` walks the store with `fs` and must not invoke `pass` or `gpg`.
- `secrets.get` runs `pass show <name>`; exit 1 → error `NOT_FOUND`.
- `secrets.set` runs `pass insert -m -f <name>` and writes `value` then `notes`
  to stdin. `overwrite` false + entry exists → error `EXISTS`, no write.
- `secrets.remove` runs `pass rm -f <name>`.
- Errors are `Error` instances with a `CODE:` prefix the UI can display.

UI surface: `addScreen` id `secrets` + `addSidebarHeaderItem`; use `copyText`,
`useToast`, `Modal`, `FlatList`, `TextInput`, `Icon` from
`@getpaseo/plugin/client/ui`.

## Notes

- `pass insert -m -f` reads until EOF on stdin and prompts on stderr; the prompt
  is harmless but should not be surfaced as an error.
- `pass rm -f` prunes empty parent directories itself.
- `pass show` prints the whole entry: line 1 is the password, the rest is notes.
- Entry names are user-chosen; keep the store flat-ish (`service/resource`) but
  the plugin must not enforce a taxonomy beyond the validation in AC 11.
