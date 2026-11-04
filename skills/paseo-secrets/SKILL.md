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

Use `PASSWORD_STORE_DIR` for a non-default store and `PASS_BIN` for a non-PATH binary.
