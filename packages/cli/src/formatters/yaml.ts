// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
export function formatYaml(data: unknown): string {
    return toYamlLines(data).join('\n');
}

function toYamlLines(data: unknown, indent = 0): string[] {
    const prefix = '  '.repeat(indent);

    if (data === null || data === undefined) {
        return [`${prefix}null`];
    }

    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
        return [`${prefix}${formatScalar(data)}`];
    }

    if (Array.isArray(data)) {
        if (data.length === 0) {
            return [`${prefix}[]`];
        }

        const lines: string[] = [];
        for (const item of data) {
            if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                const entries = Object.entries(item as Record<string, unknown>);
                if (entries.length === 0) {
                    lines.push(`${prefix}- {}`);
                    continue;
                }

                const first = entries[0];
                if (first) {
                    if (typeof first[1] === 'object' && first[1] !== null) {
                        lines.push(`${prefix}- ${first[0]}:`);
                        lines.push(...toYamlLines(first[1], indent + 2));
                    } else {
                        lines.push(`${prefix}- ${first[0]}: ${formatScalar(first[1])}`);
                    }
                }

                for (let i = 1; i < entries.length; i++) {
                    const entry = entries[i];
                    if (!entry) {
                        continue;
                    }
                    if (typeof entry[1] === 'object' && entry[1] !== null) {
                        lines.push(`${prefix}  ${entry[0]}:`);
                        lines.push(...toYamlLines(entry[1], indent + 2));
                    } else {
                        lines.push(`${prefix}  ${entry[0]}: ${formatScalar(entry[1])}`);
                    }
                }
                continue;
            }

            lines.push(`${prefix}- ${formatScalar(item)}`);
        }

        return lines;
    }

    const lines: string[] = [];
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (typeof value === 'object' && value !== null) {
            lines.push(`${prefix}${key}:`);
            lines.push(...toYamlLines(value, indent + 1));
        } else {
            lines.push(`${prefix}${key}: ${formatScalar(value)}`);
        }
    }
    return lines;
}

function formatScalar(value: unknown): string {
    if (value === null || value === undefined) {
        return 'null';
    }
    if (typeof value === 'string') {
        if (value.includes('\n') || value.includes(': ') || value.includes('#')) {
            return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        }
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
