// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { parseJsonValue } from './json-input';

export function parseStructuredValue(value: string): string | number | boolean | Record<string, unknown> | unknown[] {
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(value)) {
        return Number(value);
    }
    if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']')) || (value.startsWith('"') && value.endsWith('"'))) {
        return parseJsonValue<Record<string, unknown> | unknown[]>(value, 'parameter value');
    }
    return value;
}

export function parseKeyValuePairs<TValue>(
    pairs: string[],
    transformValue: (value: string) => TValue,
    implicitValue: TValue,
): Record<string, TValue> {
    const result: Record<string, TValue> = {};
    for (const pair of pairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) {
            result[pair] = implicitValue;
            continue;
        }
        result[pair.slice(0, eqIdx)] = transformValue(pair.slice(eqIdx + 1));
    }
    return result;
}
