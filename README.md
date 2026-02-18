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

Works with **Claude Code, Cursor, Continue.dev, Aider, raw API scripts** — anything that uses `ANTHROPIC_BASE_URL`. No code changes. No account. No data leaves your machine.

---

## Quickstart

```bash
npx sniff-proxy start
```

Then point your tool at the proxy:

```bash
export ANTHROPIC_BASE_URL=http://localhost:4243
```

For Claude Code, add to `~/.claude/settings.json`:
```json
{ "env": { "ANTHROPIC_BASE_URL": "http://localhost:4243" } }
```

Open your dashboard: **http://localhost:4244** 🐕

That's it. Sniff is on the trail.

---

## What You Get

| Feature | Details |
|---------|---------|
| 📊 **Live token gauge** | Big visual showing % of budget used, color shifts green→red |
| ⏱️ **Reset countdown** | Exact time until your rate limit window refreshes |
| 💰 **Cost per call** | Real $ estimated from Anthropic's pricing per model |
| 🔍 **Live call feed** | Every API call logged: model, tokens in/out, cost, latency |
| 📈 **Burn rate** | Tokens/min so you can project when you'll hit the wall |
| 🐾 **Smart routing** | Auto-downgrades Sonnet→Haiku at 80% budget *(opt-in)* |
| 🦴 **WOOF alerts** | Browser notifications before you run out |
| 💾 **Full history** | SQLite log of every call — query it yourself |

---

## Smart Routing (opt-in)

When you're approaching your limit, Sniff can automatically downgrade your model requests to save budget:

```bash
sniff start --routing
```

```
🐾 Rerouted: sonnet → haiku (tokens at 81%) — saving your biscuits
```

The downgrade ladder: `opus → sonnet → haiku`. Transparent to your client — we just swap the model field before forwarding.

---

## Why Not LangSmith / Helicone / AgentOps?

| | Sniff | Others |
|--|-------|--------|
| Local-first | ✅ Your machine only | ❌ Cloud/SaaS |
| Zero code changes | ✅ One env var | ❌ Requires SDK |
| Works with any tool | ✅ Proxy-based | ❌ Per-SDK instrumentation |
| Rate-limit focus | ✅ First-class | ❌ Afterthought |
| Free & open source | ✅ MIT | ❌ Paid tiers |

---

## Dashboard

<img alt="Sniff dashboard preview" src="https://github.com/AlexandeCo/sniff/raw/main/docs/preview.png" width="600">

*(screenshot coming soon — the beagle is working on it)*

---

## Install Globally

```bash
npm install -g sniff-proxy
sniff start
```

## CLI Options

```
sniff start              Start proxy + dashboard
sniff start --routing    Enable smart model routing at 80% budget
sniff start --port 4243  Custom proxy port (default: 4243)
sniff start --dash 4244  Custom dashboard port (default: 4244)
sniff status             Show current rate limit state
```

---

## Configuration

Config lives at `~/.config/sniff-proxy/config.json`:

```json
{
  "proxy": { "port": 4243 },
  "dashboard": { "port": 4244, "autoOpen": true },
  "routing": {
    "enabled": false,
    "threshold": 80,
    "ladder": {
      "claude-opus-4-6": "claude-sonnet-4-6",
      "claude-sonnet-4-6": "claude-haiku-4-6"
    }
  },
  "alerts": {
    "tokenWarningPercent": 80,
    "tokenCriticalPercent": 95
  }
}
```

---

## Beagle Philosophy 🐕

Beagles don't miss anything. They follow the trail, sound the alarm, and never stop until the job is done.

That's Sniff. It watches every call. It knows when you're getting close. And it'll bark before you hit the wall.

*Good boy.*

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The one rule: don't break the zero-config promise.

## License

MIT © [AlexandeCo](https://github.com/AlexandeCo)
