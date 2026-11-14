# OpenSanctions / yente — not connected

**Status:** Pending vendor-owner review. This is a roadmap name. The application does not call OpenSanctions or a yente server.

`YENTE_URL` defaults to empty. Screening uses `grc/sanctions/fixture.yaml`, which contains the fake name `Test Sanctioned Person` and states that it is not an OFAC or OpenSanctions list. If `YENTE_URL` is set later, the API will post a name match to `{YENTE_URL}/match/default` and fail closed on error. That URL is not set. No Docker yente service was added. No customer list was uploaded.

**Exit:** Leave `YENTE_URL` empty. The fixture remains the only source.

**Approval:** Pending vendor-owner review.
