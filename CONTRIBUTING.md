# Contributing to Tollgate 🛂

First off — thanks for wanting to help. Tollgate is a small, focused tool and we want to keep it that way.

## The One Rule

**Don't break the zero-config promise.** If contributing requires a user to do more than `npx tollgate start` + set one env var, it's too complex. Sniff's superpower is that it just works.

## Getting Started

```bash
git clone https://github.com/AlexandeCo/tollgate.git
cd tollgate
npm install
node bin/tollgate.js start
```

Set `ANTHROPIC_BASE_URL=http://localhost:4243` in your Claude client of choice and make a call. Watch the 🔍 logs appear.

## What We'd Love Help With

- **More model pricing** — keep `src/pricing.js` up to date as Anthropic releases models
- **Provider support** — OpenAI, Google, Mistral (same proxy pattern, different headers)
- **Dashboard improvements** — the `dashboard/` folder is vanilla HTML/JS, dig in
- **Tests** — `test/` folder, we use Node's built-in test runner
- **Bug fixes** — especially around streaming response edge cases

## What We're Not Adding (for now)

- Cloud sync / remote dashboards — local-first is the point
- Authentication — this runs on localhost, keep it simple
- Heavy dependencies — the dep list should stay short

## Submitting a PR

1. Fork it
2. Branch from `main`
3. Keep it focused — one thing per PR
4. Test that `tollgate start` still works end-to-end
5. Open the PR with a clear description of what and why

## Code Style

- Keep output clear and human-friendly (`chalk` for colors)
- Error messages should be clear, not cryptic
- Comments are welcome, especially in `src/proxy.js` (it's the tricky bit)

---

*"Beagles don't miss anything."* — Neither should Sniff.
