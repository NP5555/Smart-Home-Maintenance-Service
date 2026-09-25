# Smart Home Maintenance Services — Engineering Documentation Pack

| # | File | What it is | Primary reader |
|---|---|---|---|
| 01 | `01_SRS_v2.1.md` | Build-baseline SRS. Carries every v2.0 requirement, resolves 25 ambiguities (CL-01…25), adds the full transition table (T1–T26), acceptance criteria for every requirement, and the configuration catalogue (BR-xx). | Everyone |
| 02 | `02_TRD.md` | Technical design: architecture, stack, repo layout, state machine, ledger & posting recipes, verification engine, API catalogue, security, testing, CI/CD, delivery plan, ADRs, risks. | Engineers, QA, DevOps |
| 03 | `03_ERD.md` | Entity-relationship diagrams (Mermaid, by domain) + data dictionary and integrity rules. | Engineers, DB designer, QA |
| 04 | `04_schema.sql` | Canonical PostgreSQL 16 + PostGIS schema: 72 tables, enums, constraints, triggers, views. Source of truth for the data model. | Engineers |
| 05 | `05_CURSOR_BUILD_PROMPT.md` | Master context prompt + six phase prompts + review and bug-fix prompts for Cursor Agent. | Whoever drives the build |
| 06 | `06_cursor_rules/*.mdc` | Always-on Cursor project rules (copy into `.cursor/rules/`). | Cursor |

## Quick start with Cursor
1. New repo → copy files 01–05 into `docs/`, and `06_cursor_rules/*.mdc` into `.cursor/rules/`.
2. Cursor Agent mode → paste *Prompt 0* from `05_CURSOR_BUILD_PROMPT.md` → review its understanding.
3. Run Phase 0 … Phase 5 one at a time; run the Review Prompt after each; tag `phase-N` when exit checks pass.

## Decisions awaiting the product owner
See SRS §3.1 (OQ-01…OQ-06): cash collection model, breach categories, payment gateway, telephony vendor, real fee/threshold values, security deposit. The build proceeds on the stated defaults with mock adapters until these are answered.

Mermaid diagrams render in GitHub/GitLab, Cursor/VS Code Markdown preview, and Obsidian.
