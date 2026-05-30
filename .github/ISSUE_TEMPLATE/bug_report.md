---
name: Bug report
about: Something in Arch behaves incorrectly
title: "[bug] "
labels: bug
---

## What happened

<!-- A clear description of the bug. -->

## Minimal reproduction

<!-- Ideally a minimal `backend.arch` and the exact `arch` commands you ran.
     The smaller the spec, the faster we can fix it. -->

```arch
# backend.arch
```

```sh
# commands
arch parse backend.arch
arch plan
arch apply
```

## Expected vs actual

- **Expected:**
- **Actual:** (include exit codes and any `.arch/drift.json` or run report)

## Environment

- Arch commit / branch:
- Node version (`node -v`):
- pnpm version (`pnpm -v`):
- OS:

## Trust-boundary impact?

<!-- If this lets generated/agent code escape allowlists, overwrite human-owned
     files, or bypass verification, please report privately per SECURITY.md
     instead of opening a public issue. -->
