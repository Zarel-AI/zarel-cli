// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
// `entities recompute` is a RUNTIME-plane command.
//
// The rest of the `entities` family (list/get/create/put/patch/delete and the
// field sub-commands) authors CONTRACT state and stays under `zarel contract`.
// Recompute rewrites `runtime.records`, so it answers to the runtime plane —
// the same plane that has always hosted the MCP `recompute_entity` tool.
import { Command } from 'commander';
import { createClient } from '../client';
import { handleCommandError } from '../error-handler';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

export function registerRuntimeEntitiesCommands(program: Command): void {
    const entitiesCmd = program
        .command('entities')
        .description('Runtime-plane entity operations');

    entitiesCmd
        .command('recompute <name>')
        .description('Recompute all computed fields for an entity')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (name: string, opts: { format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const response = await client.runtime.entities.recompute(name);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
