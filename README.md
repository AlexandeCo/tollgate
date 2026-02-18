# 🐕 Sniff

> *A beagle-nosed local proxy that sniffs your Anthropic API traffic before your token budget runs out.*

```
  / \__
 (    @\___       sniff sniff...
 /         O      something smells like a rate limit
/   (_____/       🔍 tokens_remaining: 12,400
/_____/   U
```

**You're burning through your Claude Max budget and you have no idea until it's too late.**

Sniff fixes that. It's a zero-config local proxy that sits between your AI tools and Anthropic's API, reads the rate limit headers on every response, and shows you exactly how close you are to the wall — before you hit it.

Works with Claude Code, Cursor, Continue.dev, Aider, raw API scripts — anything that uses `ANTHROPIC_BASE_URL`.

---

## Quickstart

```bash
npx sniff start
```

Then tell your tool to sniff the traffic:

```bash
export ANTHROPIC_BASE_URL=http://localhost:4243
```

For Claude Code, add to `~/.claude/settings.json`:
```json
{ "env": { "ANTHROPIC_BASE_URL": "http://localhost:4243" } }
```

Open your dashboard: **http://localhost:4244**

That's it. Sniff is on the trail. 🐕

---

## What Sniff Does

- **Live token budget gauge** — see `tokens_remaining` from every Anthropic response, in real time
- **Burn rate** — tokens/minute so you can project when you'll hit the wall
- **Reset countdown** — exactly when your rate limit window refreshes
- **Per-model breakdown** — how much Opus vs Sonnet vs Haiku
- **Cost estimator** — real $ per call and session total
- **Smart routing** *(optional)* — auto-downgrades Sonnet → Haiku at 80% budget
- **Budget alerts** — browser push notifications before you run out
- **Full call log** — every API call with tokens, cost, latency, model

---

## Why Not LangSmith / Helicone / AgentOps?

Those tools send your data to their cloud. Sniff is **local-first** — your API calls never leave your machine. It's also **zero-code** — no SDK, no instrumentation, no account. Just a proxy and one environment variable.

---

## Beagle Philosophy 🐕

Beagles don't miss anything. They follow the trail, they sound the alarm, and they never stop until the job is done.

That's Sniff. It watches every call. It knows when you're getting close. And it'll bark before you hit the wall.

*Good boy.*

---

## License

MIT © Cody
