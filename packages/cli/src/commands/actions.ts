// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { createClient } from '../client';
import { handleCommandError } from '../error-handler';
import { parseJsonObject } from '../parsers/json-input';
import { parseIntegerOption } from '../parsers/numeric-options';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

/**
 * `zarel actions ...` — canonical runtime action surface.
 *
 * Faithful-layer wrapper around `client.runtime.actions.dispatch()`. Resolves the
 * named YAML action server-side and dispatches through the existing entity-
 * intent path, preserving authorization + validation + state-machine gates.
 * The response carries `resolved_via_action: <name>` for telemetry attribution.
 */
export function registerActionsCommands(program: Command): void {
    const actionsCmd = program
        .command('actions')
        .description('Dispatch YAML-declared actions');

    actionsCmd
        .command('dispatch <name>')
        .description('Dispatch the action whose YAML name is <name>')
        .option('-r, --record-id <id>', 'Record id (required for read/update/delete verbs)')
        .option('-n, --notes <text>', 'Free-form notes captured server-side')
        .option('-p, --payload <json>', 'Payload as JSON object (forwarded to the entity intent)')
        .option('-k, --idempotency-key <key>', 'Idempotency key (V1 wire-format pass-through)')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (name: string, opts: {
            recordId?: string;
            notes?: string;
            payload?: string;
            idempotencyKey?: string;
            format: string;
        }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const payload = opts.payload !== undefined
                    ? parseJsonObject<Record<string, unknown>>(opts.payload, 'Action payload')
                    : undefined;
                const recordIdParsed = opts.recordId !== undefined
                    ? parseIntegerOption(opts.recordId, '--record-id')
                    : undefined;

                const client = createClient();
                const response = await client.runtime.actions.dispatch(name, {
                    ...(recordIdParsed !== undefined ? { record_id: recordIdParsed } : {}),
                    ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
                    ...(payload !== undefined ? { payload } : {}),
                    ...(opts.idempotencyKey !== undefined ? { idempotency_key: opts.idempotencyKey } : {}),
                });
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
