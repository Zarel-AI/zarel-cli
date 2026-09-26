// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import {
    isValidConfigKey,
    getConfigValue,
    setConfigValue,
    deleteConfigValue,
    listConfig,
    getConfigPath,
} from '../config';
import type { ZarelConfig } from '../config';
import { parseOutputFormat } from '../parsers/output-format';
import { printError } from '../printers/stderr';
import { printOutput } from '../printers/output';

const TOKEN_KEYS = new Set<string>(['runtimeToken', 'contractToken']);

function maskToken(value: string): string {
    if (value.length <= 8) return '*'.repeat(value.length);
    return `${value.slice(0, 8)}...`;
}

function displayValue(key: string, value: string): string {
    return TOKEN_KEYS.has(key) ? maskToken(value) : value;
}

export function registerConfigCommands(program: Command): void {
    const configCmd = program
        .command('config')
        .description('Manage CLI configuration');

    configCmd
        .command('set <key> <value>')
        .description('Set a config value')
        .action((key: string, value: string) => {
            if (!isValidConfigKey(key)) {
                printError(`Invalid config key: ${key}.`);
                process.exitCode = 2;
                return;
            }
            setConfigValue(key, value);
            console.log(`Set ${key} = ${displayValue(key, value)}`);
        });

    configCmd
        .command('get <key>')
        .description('Get a config value')
        .action((key: string) => {
            if (!isValidConfigKey(key)) {
                printError(`Invalid config key: ${key}.`);
                process.exitCode = 2;
                return;
            }
            const value = getConfigValue(key);
            if (value === undefined) {
                console.log('(not set)');
            } else {
                console.log(displayValue(key, value));
            }
        });

    configCmd
        .command('delete <key>')
        .description('Remove a config value')
        .action((key: string) => {
            if (!isValidConfigKey(key)) {
                printError(`Invalid config key: ${key}.`);
                process.exitCode = 2;
                return;
            }
            deleteConfigValue(key);
            console.log(`Deleted ${key}`);
        });

    configCmd
        .command('list')
        .description('List all config values')
        .option('-f, --format <format>', 'Output format (table, json, yaml)', 'table')
        .action((opts: { format: string }) => {
            const format = parseOutputFormat(opts.format);
            const config = listConfig();
            const display: Record<string, string> = {};
            for (const [key, value] of Object.entries(config) as [keyof ZarelConfig, string | undefined][]) {
                if (value !== undefined) {
                    display[key] = displayValue(key, value);
                }
            }
            if (Object.keys(display).length === 0) {
                console.log(`No configuration set. Config path: ${getConfigPath()}`);
                return;
            }
            printOutput(display, format);
        });
}
