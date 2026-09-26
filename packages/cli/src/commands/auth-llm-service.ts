// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
/**
 * `zarel auth-llm-service ...` commands.
 *
 * CRUD-ish over `authorization.{contract|runtime}.llm_services[].policies[]`.
 * Policies are immutable rows — `set` is idempotent CREATE, `unset` is
 * idempotent DELETE.
 */

import { Command } from 'commander';
import { grantQualifiers } from '@zarel-ai/sdk';
import { createClient } from '../client';
import { handleCommandError } from '../error-handler';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

const VALID_ACTIONS = new Set(['use']);

export function registerAuthLlmServiceCommands(program: Command): void {
    const cmd = program
        .command('auth-llm-service')
        .description('Manage per-LLM-service authorization policies');

    cmd
        .command('list')
        .description('List policies for an LLM service in a given scope')
        .requiredOption('--scope <scope>', '"runtime" or "contract"')
        .requiredOption('--service <name>', 'LLM service name')
        .option('-f, --format <format>', 'Output format', 'table')
        .action(async (opts: { scope: string; service: string; format: string }) => {
            try {
                if (opts.scope !== 'runtime' && opts.scope !== 'contract') {
                    throw new Error('--scope must be "runtime" or "contract"');
                }
                const format = parseOutputFormat(opts.format);
                const client = createClient();
                // `scope` is a QUALIFIER on the grant now, not a separate
                // surface: one on-path, `llm/services/<name>`, addressed per role.
                const onPath = `llm/services/${opts.service}`;
                const roles = await client.contract.roles.list();
                const rows = [];
                for (const role of roles) {
                    const grants = await client.contract.authorization.list(role.name);
                    const grant = grants.grants.find((g) => g.on === onPath);
                    if (!grant) continue;
                    for (const action of grant.actions) {
                        const scopes = grantQualifiers(action)?.scope ?? ['runtime'];
                        if (scopes.includes(opts.scope as 'contract' | 'runtime')) {
                            rows.push({ role: role.name, action: 'use', scope: opts.scope });
                        }
                    }
                }
                printOutput(rows, format);
            } catch (err) {
                handleCommandError(err);
            }
        });

    cmd
        .command('set')
        .description('Grant a (role, action) policy on an LLM service')
        .requiredOption('--scope <scope>', '"runtime" or "contract"')
        .requiredOption('--service <name>', 'LLM service name')
        .requiredOption('--role <role>', 'Role granted by the policy')
        .requiredOption('--action <action>', '"use"')
        .action(async (opts: { scope: string; service: string; role: string; action: string }) => {
            try {
                if (opts.scope !== 'runtime' && opts.scope !== 'contract') {
                    throw new Error('--scope must be "runtime" or "contract"');
                }
                if (!VALID_ACTIONS.has(opts.action)) {
                    throw new Error('--action must be "use"');
                }
                const client = createClient();
                // Merge the requested scope into any existing `use` grant so a
                // contract-plane grant never silently drops the runtime one.
                const onPath = `llm/services/${opts.service}`;
                const existing = (await client.contract.authorization.list(opts.role))
                    .grants.find((g) => g.on === onPath);
                const current = existing?.actions[0];
                const scopes = new Set<'contract' | 'runtime'>(
                    current === undefined ? [] : grantQualifiers(current)?.scope ?? ['runtime'],
                );
                scopes.add(opts.scope);
                await client.contract.authorization.put(opts.role, onPath, [
                    { use: { scope: [...scopes].sort() } },
                ]);
                console.log(`Granted ${opts.role}:${opts.action} on ${opts.scope}/${opts.service}.`);
            } catch (err) {
                handleCommandError(err);
            }
        });

    cmd
        .command('unset')
        .description('Revoke a (role, action) policy on an LLM service')
        .requiredOption('--scope <scope>', '"runtime" or "contract"')
        .requiredOption('--service <name>', 'LLM service name')
        .requiredOption('--role <role>', 'Role whose policy is being revoked')
        .requiredOption('--action <action>', '"use"')
        .action(async (opts: { scope: string; service: string; role: string; action: string }) => {
            try {
                if (opts.scope !== 'runtime' && opts.scope !== 'contract') {
                    throw new Error('--scope must be "runtime" or "contract"');
                }
                if (!VALID_ACTIONS.has(opts.action)) {
                    throw new Error('--action must be "use"');
                }
                const client = createClient();
                // Remove only the requested scope; the grant survives if the
                // other plane still holds it.
                const onPath = `llm/services/${opts.service}`;
                const existing = (await client.contract.authorization.list(opts.role))
                    .grants.find((g) => g.on === onPath);
                const current = existing?.actions[0];
                const scopes = new Set<'contract' | 'runtime'>(
                    current === undefined ? [] : grantQualifiers(current)?.scope ?? ['runtime'],
                );
                scopes.delete(opts.scope);
                if (scopes.size === 0) {
                    await client.contract.authorization.del(opts.role, onPath);
                } else {
                    await client.contract.authorization.put(opts.role, onPath, [
                        { use: { scope: [...scopes].sort() } },
                    ]);
                }
                console.log(`Revoked ${opts.role}:${opts.action} on ${opts.scope}/${opts.service}.`);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
