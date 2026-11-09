# Hugging Face Hub — draft assessment

**Status:** Pending vendor-owner review. No SOC report is attached.

**Used by:** `app/services/forecast_kronos.py`, to download the pinned `NeoQuasar/Kronos-small` model and `NeoQuasar/Kronos-Tokenizer-base` tokenizer weights when `settings.forecast_kronos_enabled` is `True`. The default is `False`. This app makes zero live calls to Hugging Face Hub unless an operator explicitly turns this on. A download, when that switch is on and the wrapper runs, is cached under `forecast_kronos_cache_dir`.

**Data shared:** None. The request carries a model-name string only. No account, order, or customer data is sent.

**Criticality:** None today. The setting defaults off, and this unit adds no route and no job that would call the Hub.

**Exit:** Leave `forecast_kronos_enabled` off and delete the local cache under `forecast_kronos_cache_dir`. No Hub account is held by this app.

**Approval:** Pending vendor-owner review.
