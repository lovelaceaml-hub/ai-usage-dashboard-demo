# AI usage dashboard demo

A static quota page with synthetic data. No account access, collector, or live usage is included. Serve this folder with `python3 -m http.server` and open http://localhost:8000.

The included projector and exporter can also generate a quota-only snapshot locally. Account usage and reset times are private. Use synthetic data for public hosting.

Run focused checks with `node --test tests/public-snapshot.test.js`.
