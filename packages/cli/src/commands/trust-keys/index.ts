// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerTrustKeysFetchCommand } from './fetch';

/**
 * `zarel trust-keys ...` — trust-keys management.
 */
export function registerTrustKeysCommands(program: Command): void {
    const trustKeysCmd = program
        .command('trust-keys')
        .description('Manage deployment trust-keys for offline bundle verification');

    registerTrustKeysFetchCommand(trustKeysCmd);
}
