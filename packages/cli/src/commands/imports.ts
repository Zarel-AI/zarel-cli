// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import type { SnapshotImportFile } from '@zarel-ai/sdk';
import { createClient } from '../client';
import { handleCommandError } from '../error-handler';
import { readJsonFile } from '../parsers/json-input';
import { parseOutputFormat } from '../parsers/output-format';
import { printOutput } from '../printers/output';

export function registerImportCommands(program: Command): void {
    const importsCmd = program
        .command('imports')
        .description('Tenant snapshot import operations');

    importsCmd
        .command('snapshot <file>')
        .description('Import a snapshot file (*.data.json) through the public API')
        .option('-m, --mode <mode>', 'Import mode: clean|restore', 'clean')
        .option('-v, --validation-mode <mode>', 'Validation mode: fail-fast|collect-errors', 'fail-fast')
        .option('-f, --format <format>', 'Output format', 'json')
        .action(async (file: string, opts: { mode: string; validationMode: string; format: string }) => {
            try {
                const client = createClient();
                const format = parseOutputFormat(opts.format);
                const data = readJsonFile<SnapshotImportFile>(file, 'Snapshot import file');
                const response = await client.runtime.imports.snapshot({
                    data,
                    mode: opts.mode === 'restore' ? 'restore' : 'clean',
                    validation_mode: opts.validationMode === 'collect-errors' ? 'collect-errors' : 'fail-fast',
                });
                printOutput(response, format);
            } catch (err) {
                handleCommandError(err);
            }
        });
}
