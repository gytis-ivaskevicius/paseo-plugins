---
name: paseo-secrets
description: Manage entries in the local pass store. Use for listing, reading, adding, or removing secrets from bash.
---

# Paseo Secrets

Users can add, edit, reveal, copy, and delete entries in the Paseo **Secrets** screen. Agents use `pass` from bash; the plugin has no separate CLI.

```bash
pass ls
pass show service/resource

printf '%s\n%s' "$VALUE" "$NOTES" | pass insert -m -f service/resource
pass rm -f service/resource
```

`insert -m -f` also replaces an existing entry; the value must be one line, notes may follow. Confirm deletion with the user before running `pass rm -f`.

Read secrets only when needed and never put them in argv, stdout, or logs. Use this store as the default for scripts and sensitive configuration; do not introduce another secret store.

**The store is the only home for a secret.** Never commit one to a git repo — and never commit an encrypted copy (GPG, age, sops) either. A repo is cloned, mirrored and shared, and the key that opens the ciphertext gets separated from it; a secret in a repo has to be treated as public. When something needs to be durable in git, commit the *name* of the store entry, not the value: `ssh/work`, not a `.gpg` file.

When a tool needs a real file (an SSH key, a `.env`), materialise it from the store at that path and keep the store as the canonical copy:

```bash
pass show ssh/work | head -1 | base64 -d > ~/.ssh/work_ed25519
chmod 600 ~/.ssh/work_ed25519
```

Use `PASSWORD_STORE_DIR` for a non-default store and `PASS_BIN` for a non-PATH binary.
