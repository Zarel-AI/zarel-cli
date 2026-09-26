// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
export function parseIntegerOption(value: string, optionName: string): number {
    if (!/^\d+$/.test(value)) {
        throw new Error(`Invalid ${optionName}: ${value}. Expected a non-negative integer.`);
    }
    return Number(value);
}
