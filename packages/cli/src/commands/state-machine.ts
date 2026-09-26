// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import type { WorkflowStateMachineConfig } from '@zarel-ai/sdk';
import { createClient } from '../client';
import { resolveLocale } from '../auth';
import { handleCommandError } from '../error-handler';
import { parseJsonObject } from '../parsers/json-input';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

const LOCALE_HELP = 'Locale for labels/descriptions (en|es). Falls back to ZAREL_LOCALE → config → server default.';

/**
 * `zarel state-machine ...` — canonical runtime state-machine surface.
 *
 * Absorbs the former `workflows timeline` and `transitions list/approve/reject`
 * commands, plus `workflows replay`, now reachable as
 * `zarel runtime state-machine replay`.
 */
export function registerStateMachineCommands(program: Command): void {
    const sm = program
        .command('state-machine')
        .description('Inspect state-machine events + manage transition requests');

    sm
        .command('events')
        .description('List state-machine events for an entity or instance')
        .option('-e, --entity <name>', 'Entity name')
        .option('-i, --instance <id>', 'State-machine instance ID')
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: { entity?: string; instance?: string; locale?: string; format: string }) => {
            try {
                if ((opts.entity === undefined && opts.instance === undefined)
                    || (opts.entity !== undefined && opts.instance !== undefined)) {
                    console.error('Error: provide exactly one of --entity or --instance');
                    process.exitCode = 2;
                    return;
                }
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const params = {
                    ...(opts.entity !== undefined ? { entity_name: opts.entity } : {}),
                    ...(opts.instance !== undefined ? { instance_id: opts.instance } : {}),
                };
                const response = locale
                    ? await client.runtime.stateMachine.events.list(params, { locale })
                    : await client.runtime.stateMachine.events.list(params);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    sm
        .command('pending')
        .description('List pending transition requests (filter by role[s])')
        .option(
            '-r, --role <role>',
            'Filter by role; may be repeated to match any of multiple roles',
            (value: string, prev: string[]) => prev.concat(value),
            [] as string[],
        )
        .option('--locale <code>', LOCALE_HELP)
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: { role: string[]; locale?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                const locale = resolveLocale(opts.locale);
                const params = opts.role.length > 0 ? { roles: opts.role } : undefined;
                const response = locale
                    ? await client.runtime.stateMachine.transitions.listPending(params, { locale })
                    : await client.runtime.stateMachine.transitions.listPending(params);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    // `approve` and `reject` are ONE command with one word changed, and writing them twice is
    // how the pair drifts: the tests assert each separately, so a change made to one and not
    // the other is invisible. They were byte-identical apart from the status literal, including
    // a duplicated four-line comment.
    //
    // `status`, not `decision` — the fix this pair exists to record. `patchTransition` reads
    // `status` and `decision_notes` and nothing else, so these commands never resolved
    // anything: with `--notes` they patched the note and left the request `pending`; without
    // one the route refused the body outright, *"patch body requires at least one mutable
    // field"*. Only `status` routes through the server's transition-resolution path.
    const RESOLUTIONS = [
        { verb: 'approve', status: 'approved', label: 'Approve' },
        { verb: 'reject', status: 'rejected', label: 'Reject' },
    ] as const;
    for (const { verb, status, label } of RESOLUTIONS) {
        sm
            .command(`${verb} <id>`)
            .description(`${label} a pending transition request`)
            .option('-n, --notes <notes>', 'Decision notes')
            .option('-f, --format <format>', 'Output format', 'json')
            .action(async (id: string, opts: { notes?: string; format: string }) => {
                try {
                    const format = parseOutputFormat(opts.format);
                    const client = createClient();
                    const response = await client.runtime.stateMachine.transitions.resolve(id, {
                        status,
                        ...(opts.notes !== undefined ? { decision_notes: opts.notes } : {}),
                    });
                    printOutput(response, format);
                } catch (err) {
                    handleCommandError(err);
                }
            });
    }

    sm
        .command('replay')
        .description('Replay a state-machine instance with a new configuration (reads JSON from --config)')
        .requiredOption('-i, --instance <id>', 'State-machine instance ID')
        .requiredOption('-c, --config <json>', 'New state-machine config as JSON')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (opts: { instance: string; config: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const newConfig = parseJsonObject<WorkflowStateMachineConfig>(opts.config, 'Workflow config');
                const client = createClient();
                const response = await client.runtime.stateMachine.replay({
                    instance_id: opts.instance,
                    new_config: newConfig,
                });
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
