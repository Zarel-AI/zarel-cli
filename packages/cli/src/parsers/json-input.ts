// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import * as fs from 'node:fs';

export function parseJsonObject<T>(value: string, label: string): T {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (e) {
        throw new Error(`Invalid ${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${label} must be a JSON object.`);
    }
    return parsed as T;
}

export function parseJsonArray<T>(value: string, label: string): T {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (e) {
        throw new Error(`Invalid ${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error(`${label} must be a JSON array.`);
    }
    return parsed as T;
}

export function readJsonObjectInput<T>(value: string | undefined, label: string): T {
    if (value !== undefined) {
        return parseJsonObject<T>(value, label);
    }

    return parseJsonObject<T>(readStdinInput(label, '--data'), label);
}

export function readJsonArrayInput<T>(value: string | undefined, label: string, sourceLabel = '--items'): T {
    if (value !== undefined) {
        return parseJsonArray<T>(value, label);
    }

    return parseJsonArray<T>(readStdinInput(label, sourceLabel), label);
}

export function readJsonFile<T>(file: string, label: string): T {
    return parseJsonValue<T>(readTextFile(file), label);
}

export function readTextFile(file: string): string {
    return fs.readFileSync(file, 'utf-8');
}

export function readStdinInput(label: string, sourceLabel: string): string {
    if (process.stdin.isTTY) {
        throw new Error(`${label} is required via ${sourceLabel} or stdin.`);
    }

    const stdin = fs.readFileSync(0, 'utf-8').trim();
    if (stdin.length === 0) {
        throw new Error(`${label} is required via ${sourceLabel} or stdin.`);
    }

    return stdin;
}

export function parseJsonValue<T>(value: string, label: string): T {
    try {
        return JSON.parse(value) as T;
    } catch {
        throw new Error(`Invalid ${label}: expected valid JSON.`);
    }
}
