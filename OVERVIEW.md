# Secrets

Browse, add, reveal, copy, edit, and delete entries in an existing `pass` password store.

The plugin reads the store directory directly to list entries, so opening the screen does not decrypt anything. Selecting an entry runs `pass show`; Reveal displays the value and Copy puts it on the clipboard. Add and edit send the value to `pass insert -m -f` on stdin, so it never appears in a command line.

Setup comes from the environment. `PASSWORD_STORE_DIR` selects the store, defaulting to `~/.password-store`. `PASS_BIN` selects the `pass` binary; otherwise the plugin looks on PATH and then in the Nix profile. Entries are written with `pass`, so the store layout, `.gpg-id`, and GPG keys stay unchanged.

Names are validated before writing. Existing entries created by other `pass` tooling can still be opened, edited, and removed. The plugin does not rename, move, import, or export entries, and it does not generate or sync passwords.
