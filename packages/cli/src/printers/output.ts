// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { formatJson } from '../formatters/json';
import { formatTable } from '../formatters/table';
import { formatYaml } from '../formatters/yaml';
import type { OutputFormat } from '../output-format';
import { printStdout } from './stdout';

export function printOutput(data: unknown, format: OutputFormat): void {
    if (format === 'json') {
        printLines(formatJson(data));
        return;
    }
    if (format === 'yaml') {
        printLines(formatYaml(data));
        return;
    }
    printLines(formatTable(data));
}

function printLines(text: string): void {
    const lines = text.split('\n');
    const trimmed = lines.at(-1) === '' ? lines.slice(0, -1) : lines;
    for (const line of trimmed) {
        printStdout(line);
    }
}
