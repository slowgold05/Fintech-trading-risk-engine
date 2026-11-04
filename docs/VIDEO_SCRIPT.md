# Two-minute video — shot list

**Status:** Not recorded. There is no video file and no GIF in this repository.

The roadmap gate asks for a two-minute recording. This file is the shot list only. Do not link it as if the recording exists.

| Time | Line | What to show | What is true today |
| --- | --- | --- | --- |
| 0:00–0:15 | This is a mock brokerage run like a regulated firm. | Trading desk: an order ticket and positions. | The live demo can place a paper order. It does not run the Phase 5 or Phase 6 image. |
| 0:15–0:50 | Credential stuffing is denied. A wash-trading pattern is detected on a labeled scenario. | Compliance or a local test run, not the public site. | `python -m app.scripts.run_tabletop` caught both on 2026-11-04 against a private sqlite database. It did not attack the public demo. |
| 0:50–1:20 | Open a case. The trader cannot close their own alert. | Surveillance or AML case screen. | The rule exists in the working tree. No rule is active on the hosted service. The subject-close block is covered by tests. |
| 1:20–1:45 | A direct ledger update fails. | Database trigger or SM-LD-01. | Hosted ledger reconciliation was checked earlier. Do not tamper with the hosted database for the video. |
| 1:45–2:00 | Control matrix and a model report. | `grc/control_matrix.csv` and `grc/models/reports/SM-AML-01.md`. | The matrix has 23 controls. The aim of 30 to 40 was not met. The AML report is a labeled result, pending model owner review. |

Record the video only after the working tree is deployed, or say on screen that the shots are from the working tree and the public site is older.
