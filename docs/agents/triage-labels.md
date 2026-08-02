# Triage Labels

The skills speak in terms of five canonical triage roles. This repo uses the
canonical names unchanged, so no translation is needed.

| Role              | Label in this repo | Meaning                                  |
| ----------------- | ------------------ | ---------------------------------------- |
| `needs-triage`    | `needs-triage`     | Maintainer needs to evaluate this issue  |
| `needs-info`      | `needs-info`       | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent`  | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human`  | Requires human implementation            |
| `wontfix`         | `wontfix`          | Will not be actioned                     |

All five exist in `taux-io/twse-mcp`. `wontfix` is a GitHub default that was
already present; the other four were created when this config was added.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
label of the same name.

If the vocabulary ever diverges from the canonical roles, change the middle
column — the skills read this table, not the label list on GitHub.
