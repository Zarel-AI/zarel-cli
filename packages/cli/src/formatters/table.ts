// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
export function formatTable(data: unknown): string {
    if (data === null || data === undefined) {
        return '(empty)';
    }

    if (typeof data === 'string') {
        return data;
    }

    if (typeof data === 'number' || typeof data === 'boolean' || typeof data === 'bigint') {
        return String(data);
    }

    if (typeof data === 'symbol') {
        return data.toString();
    }

    if (typeof data === 'function') {
        return '[Function]';
    }

    if (Array.isArray(data)) {
        if (data.length === 0) {
            return '(empty)';
        }

        const firstItem: unknown = data[0];
        if (typeof firstItem === 'object' && firstItem !== null && !Array.isArray(firstItem)) {
            return formatObjectTable(data as Record<string, unknown>[]);
        }

        return data.map(item => displayValue(item)).join('\n');
    }

    return formatKeyValue(data as Record<string, unknown>);
}

function formatObjectTable(rows: Record<string, unknown>[]): string {
    const keys = new Set<string>();
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            keys.add(key);
        }
    }
    const columns = Array.from(keys);

    const widths = new Map<string, number>();
    for (const col of columns) {
        widths.set(col, col.length);
    }
    for (const row of rows) {
        for (const col of columns) {
            const value = displayValue(row[col]);
            const current = widths.get(col) ?? 0;
            if (value.length > current) {
                widths.set(col, value.length);
            }
        }
    }

    const lines: string[] = [];
    lines.push(columns.map(col => col.toUpperCase().padEnd(widths.get(col) ?? 0)).join('  '));
    lines.push(columns.map(col => '-'.repeat(widths.get(col) ?? 0)).join('  '));

    for (const row of rows) {
        lines.push(columns.map(col => displayValue(row[col]).padEnd(widths.get(col) ?? 0)).join('  '));
    }

    return lines.join('\n');
}

function formatKeyValue(obj: Record<string, unknown>): string {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
        return '(empty)';
    }
    const maxKeyLen = Math.max(...keys.map(key => key.length));
    return Object.entries(obj)
        .map(([key, value]) => `${key.padEnd(maxKeyLen)}  ${displayValue(value)}`)
        .join('\n');
}

function displayValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    if (typeof value === 'symbol') {
        return value.toString();
    }
    if (typeof value === 'function') {
        return '[Function]';
    }
    return '';
}

