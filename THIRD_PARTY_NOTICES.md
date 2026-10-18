# Dependency and fixture review notes

No third-party packages, binaries, image archive, or external dataset is bundled. Test source imports first-party modules and external development packages including Vitest, Supertest, Express, pg-mem, and PostgreSQL clients. Obtain dependencies separately under their own terms.

The source selection holds account/auth/session paths and named auth-secret fixtures pending safe live-auth treatment. This is a bounded technical hold, not a guarantee that every retained fixture is synthetic or that the tests can run independently.
