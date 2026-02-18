#!/usr/bin/env node
/**
 * bin/tollgate.js — Tollgate CLI
 *
 * Usage:
 *   tollgate start [--port <n>] [--dashboard-port <n>] [--routing] [--warning-threshold <n>]
 */

import { parseArgs } from 'util';
import chalk from 'chalk';
import { applyFlags } from '../src/config.js';
import { start } from '../src/index.js';

const USAGE = `
${chalk.bold.green('🛂 Tollgate')} — Anthropic API proxy with token monitoring

${chalk.bold('Usage:')}
  tollgate start [options]

${chalk.bold('Options:')}
  --port <n>               Proxy port (default: 4243)
  --dashboard-port <n>     Dashboard port (default: 4244)
  --routing                Enable smart model downgrade routing
  --warning-threshold <n>  Token warning percent (default: 80)
  --help                   Show this help

${chalk.bold('Quick start:')}
  tollgate start
  export ANTHROPIC_BASE_URL=http://localhost:4243

  ${chalk.gray('# Or for Claude Code:')}
  ${chalk.gray('# Add to ~/.claude/settings.json:')}
  ${chalk.gray('# { "env": { "ANTHROPIC_BASE_URL": "http://localhost:4243" } }')}
`;

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port:                { type: 'string'  },
      'dashboard-port':    { type: 'string'  },
      routing:             { type: 'boolean' },
      'warning-threshold': { type: 'string'  },
      help:                { type: 'boolean' },
    },
    allowPositionals: true,
    strict: false,
  });

  const command = positionals[0] || 'start';

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (command === 'start') {
    const flags = {
      port:             values.port,
      dashboardPort:    values['dashboard-port'],
      routing:          values.routing,
      warningThreshold: values['warning-threshold'],
    };

    const config = applyFlags(flags);

    try {
      await start(config);
      // stay alive — servers are running
    } catch (err) {
      console.error(chalk.red(`\n❌ Tollgate couldn't start: ${err.message}`));
      if (err.code === 'EADDRINUSE') {
        console.error(chalk.yellow(`   Port already in use. Is Tollgate already running?`));
        console.error(chalk.yellow(`   Try: kill $(lsof -ti:${config.proxy.port})`));
      }
      process.exit(1);
    }

  } else {
    console.error(chalk.red(`Unknown command: ${command}`));
    console.log(USAGE);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red('Fatal:', err.message));
  process.exit(1);
});
