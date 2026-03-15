#!/usr/bin/env node

import { Command } from 'commander';
import { browseServer } from './browser';
import { startTUI } from './tui';

const program = new Command();

program
  .name('opcua-browser')
  .description('CLI-based OPC-UA browser with optional interactive TUI')
  .version('1.0.0')
  .argument('<endpoint>', 'OPC-UA server endpoint URL')
  .option('-t, --tui', 'start interactive TUI mode')
  .action(async (endpoint: string, options: { tui: boolean }) => {
    if (options.tui) {
      await startTUI(endpoint);
    } else {
      await browseServer(endpoint);
    }
  });

program.parse();