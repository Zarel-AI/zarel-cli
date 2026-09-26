// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { createClient } from '../client';
import { handleCommandError } from '../error-handler';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

/**
 * `zarel runtime authorizations ...` — effective-authorizations introspection
 * (GET /runtime/authorizations/effective ↔ client.runtime.authorizations.effective).
 */
export function registerAuthorizationsCommands(program: Command): void {
    const authorizationsCmd = program
        .command('authorizations')
        .description('Authorization introspection');

    authorizationsCmd
        .command('effective')
        .description('Show the effective authorizations of the authenticated actor (roles, manageable sections, system actions, entity permissions)')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (opts: { format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const response = await client.runtime.authorizations.effective();
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
