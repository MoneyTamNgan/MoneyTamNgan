# Browser checks

`auth-username-browser.mjs` checks issue #108 in a real browser: register with and without a username, log in with the email and with an upper-case username, wrong username, wrong password, a taken username, and that `passwordHash` is never returned.

It is not part of `npm test` or vitest. It creates users, so run it only against a throwaway database (the bundled `mongo` service is fine).

```bash
cp .env.example .env        # set JWT_SECRET, APP_ORIGIN=http://localhost:3000
docker compose up -d mongo app
docker run --rm --network host -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.49.1-noble \
  sh -c 'npm i --no-save --no-audit --no-fund playwright@1.49.1 && node tests/e2e/auth-username-browser.mjs'
docker compose down -v
```

Screenshots go to `./shots` (`SHOTS_DIR` to change, `BASE_URL` to point at another host).
