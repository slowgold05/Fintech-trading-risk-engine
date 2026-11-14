# SM-IR-01 — Customer notice stays inside 30 days

**Date:** 2026-11-04
**Control owner:** Security Operations
**Status:** Design tested. No hosted incident population exists yet.

## Risk and control

Customer notice that lands after 30 days from discovery is R-22. The due time is `discovered_at` plus 30 days, which is the amended Regulation S-P outer bound used by this plan. SM-IR-01 fails when notice is missing after that time, or when the notice timestamp is later than the due time. Zero incidents is `no_sample`.

## Test of design

`tests/test_phase5_aml.py` scores an empty book as `no_sample`. The opener cannot record notice. Close without notice is HTTP 409. A different reviewer records notice and then closes the incident. A row discovered 31 days earlier, with notice due yesterday and no notice, scores `violation_count` 1 and status `fail`.

## Test of operating effectiveness

There is no hosted incident table. The Alpha Vantage exposure note was not converted into a timed case. The 2026-11-04 tabletop did not open an incident.

## Sample

The design sample is one overdue row inserted in sqlite. It was not selected from production.

## Limits and follow-up

The control does not send the notice. It records whether a second person stored a timestamp. Service-provider notice under amended Regulation S-P is not automated. Deploy migration `c4d8e1a7b936` before hosted rows can exist.
