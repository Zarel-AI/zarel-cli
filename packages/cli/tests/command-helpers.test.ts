// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
jest.mock('node:fs', () => {
    const actualFs: typeof import('node:fs') = jest.requireActual('node:fs');
    return {
        ...actualFs,
        readFileSync: jest.fn(),
    };
});

import * as fs from 'node:fs';
import { parseJsonObject, readJsonObjectInput } from '../src/parsers/json-input';
import { parseStructuredValue } from '../src/parsers/key-value';
import { parseIntegerOption } from '../src/parsers/numeric-options';
import { parseOutputFormat } from '../src/parsers/output-format';

describe('parsers', () => {
    describe('parseOutputFormat', () => {
        it('accepts supported formats', () => {
            expect(parseOutputFormat('table')).toBe('table');
            expect(parseOutputFormat('json')).toBe('json');
            expect(parseOutputFormat('yaml')).toBe('yaml');
        });

        it('rejects unsupported formats', () => {
            expect(() => parseOutputFormat('xml')).toThrow('Invalid output format');
        });
    });

    describe('parseIntegerOption', () => {
        it('parses non-negative integers', () => {
            expect(parseIntegerOption('0', '--limit')).toBe(0);
            expect(parseIntegerOption('42', '--limit')).toBe(42);
        });

        it('rejects invalid integers', () => {
            expect(() => parseIntegerOption('-1', '--limit')).toThrow('Invalid --limit');
            expect(() => parseIntegerOption('1.5', '--limit')).toThrow('Invalid --limit');
            expect(() => parseIntegerOption('abc', '--limit')).toThrow('Invalid --limit');
        });
    });

    describe('parseJsonObject', () => {
        it('parses JSON objects', () => {
            expect(parseJsonObject<Record<string, unknown>>('{"ok":true}', 'Payload')).toEqual({ ok: true });
        });

        it('rejects non-object JSON values', () => {
            expect(() => parseJsonObject('[]', 'Payload')).toThrow('Payload must be a JSON object.');
            expect(() => parseJsonObject('"x"', 'Payload')).toThrow('Payload must be a JSON object.');
        });

        it('throws a friendly error for malformed JSON (Bug 1 regression)', () => {
            expect(() => parseJsonObject('{invalid json', 'Config')).toThrow('Invalid Config:');
        });

        it('throws a friendly error for empty string input', () => {
            expect(() => parseJsonObject('', 'Config')).toThrow('Invalid Config:');
        });
    });

    describe('readJsonObjectInput', () => {
        const readSpy = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
        const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

        afterEach(() => {
            readSpy.mockReset();
            if (stdinDescriptor) {
                Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
            }
        });

        it('uses explicit --data input before stdin', () => {
            expect(readJsonObjectInput<Record<string, unknown>>('{"name":"a"}', 'Record data')).toEqual({ name: 'a' });
            expect(readSpy).not.toHaveBeenCalled();
        });

        it('reads stdin when --data is omitted', () => {
            Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
            readSpy.mockReturnValue('{"name":"stdin"}');

            expect(readJsonObjectInput<Record<string, unknown>>(undefined, 'Record data')).toEqual({ name: 'stdin' });
            expect(readSpy).toHaveBeenCalledWith(0, 'utf-8');
        });

        it('fails when neither --data nor stdin is available', () => {
            Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
            expect(() => readJsonObjectInput<Record<string, unknown>>(undefined, 'Record data')).toThrow(
                'Record data is required via --data or stdin.',
            );
        });
    });

    describe('parseStructuredValue', () => {
        it('coerces booleans and numbers', () => {
            expect(parseStructuredValue('true')).toBe(true);
            expect(parseStructuredValue('false')).toBe(false);
            expect(parseStructuredValue('12')).toBe(12);
            expect(parseStructuredValue('1.5')).toBe(1.5);
        });

        it('parses JSON objects and arrays', () => {
            expect(parseStructuredValue('{"a":1}')).toEqual({ a: 1 });
            expect(parseStructuredValue('[1,2]')).toEqual([1, 2]);
        });

        it('preserves plain strings', () => {
            expect(parseStructuredValue('high')).toBe('high');
        });
    });
});
