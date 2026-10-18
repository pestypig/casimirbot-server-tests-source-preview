# Dependency and fixture review notes

No third-party packages, binaries, image archive, or external dataset is bundled. Test source imports first-party modules and external development packages including Vitest, Supertest, Express, pg-mem, and PostgreSQL clients. Obtain dependencies separately under their own terms. The MIT license here covers selected first-party source, not separately obtained packages or data.

The source selection holds account/auth/session paths and named auth-secret fixtures pending safe live-auth treatment. This is a bounded technical hold, not a guarantee that every retained fixture is synthetic or that the tests can run independently.

The four-file addendum retains a scholarly article URL only as a test source reference. Six `jsessionid` values in that URL were replaced with a visibly synthetic fixture; no article text, publisher content, browser session, or authentication credential is bundled. The URL's publisher and referenced publication retain their own terms.
