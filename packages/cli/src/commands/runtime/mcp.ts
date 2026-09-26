// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import type { McpJsonRpcRequest } from '@zarel-ai/sdk';
import { createClient } from '../../client';
import { handleCommandError } from '../../error-handler';
import { readJsonObjectInput } from '../../parsers/json-input';
import { printOutput } from '../../printers/output';
import { parseOutputFormat } from '../../parsers/output-format';

/**
 * `zarel runtime mcp call` — send one MCP JSON-RPC message to the tenant's
 * stateless MCP transport (POST /runtime/mcp) and print the typed response.
 * The message is read from `--message <json>` or, if omitted, stdin.
 */
export function registerMcpCommands(program: Command): void {
    const mcpCmd = program
        .command('mcp')
        .description('MCP JSON-RPC transport (POST /runtime/mcp)');

    mcpCmd
        .command('call')
        .description('Send one MCP JSON-RPC message (reads JSON from --message or stdin)')
        .option('-m, --message <json>', 'The MCP JSON-RPC message as a JSON object')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (opts: { message?: string; format: string }) => {
            try {
                const format = parseOutputFormat(opts.format);
                const message = readJsonObjectInput<McpJsonRpcRequest>(opts.message, '--message');
                const client = createClient();
                const response = await client.runtime.mcp.call(message);
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
