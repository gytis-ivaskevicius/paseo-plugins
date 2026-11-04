---
name: paseo-secrets
description: Manage pass entries through the Paseo Secrets screen. Use for listing, adding, revealing, editing, copying, or removing secrets and notes.
---

# Paseo Secrets

Use the **Secrets** screen in the Paseo sidebar. Values stay masked until **Reveal**; **Copy** copies them.

## UI

- **List/filter**: open Secrets; type in the filter.
- **Add**: Add → name `service/resource`, value, notes → Save. Duplicate names ask before replacing.
- **Edit**: select an entry → Edit → change value or notes → Save changes.
- **Delete**: select an entry → Delete → confirm.

## Examples

Add `proton/bridge`:

1. Secrets → Add
2. Name `proton/bridge`; enter the value and notes
3. Save

Remove `proton/bridge`:

1. Select `proton/bridge`
2. Delete → confirm

## Scripts

The plugin has no CLI wrapper. For scripts, use `pass` directly and keep values off argv:

```bash
pass ls
pass show proton/bridge
printf '%s\n%s' "$VALUE" "$NOTES" | pass insert -m -f proton/bridge
pass rm -f proton/bridge
```

Set `PASSWORD_STORE_DIR` for a non-default store and `PASS_BIN` for a binary outside PATH.
