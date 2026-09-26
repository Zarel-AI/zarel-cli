// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import type { OutputFormat } from '../src/output-format';
import { printOutput } from '../src/printers/output';

describe('output', () => {
    let consoleSpy: jest.SpyInstance;
    let output: string[];

    beforeEach(() => {
        output = [];
        consoleSpy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            output.push(args.map(String).join(' '));
        });
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    describe('json format', () => {
        it('prints JSON with indentation', () => {
            printOutput({ name: 'test', value: 42 }, 'json');
            const parsed = JSON.parse(output.join('\n')) as Record<string, unknown>;
            expect(parsed).toEqual({ name: 'test', value: 42 });
        });

        it('handles arrays', () => {
            printOutput([1, 2, 3], 'json');
            const parsed = JSON.parse(output.join('\n')) as number[];
            expect(parsed).toEqual([1, 2, 3]);
        });
    });

    describe('table format', () => {
        it('prints empty for null', () => {
            printOutput(null, 'table');
            expect(output[0]).toBe('(empty)');
        });

        it('prints scalar directly', () => {
            printOutput('hello', 'table');
            expect(output[0]).toBe('hello');
        });

        it('prints empty for empty array', () => {
            printOutput([], 'table');
            expect(output[0]).toBe('(empty)');
        });

        it('prints empty for empty object (Bug 2 regression)', () => {
            printOutput({}, 'table');
            expect(output[0]).toBe('(empty)');
        });

        it('prints columnar table for array of objects', () => {
            printOutput([
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' },
            ], 'table');

            // Header should contain ID and NAME
            expect(output[0]).toContain('ID');
            expect(output[0]).toContain('NAME');
            // Separator
            expect(output[1]).toMatch(/^-+/);
            // Data rows
            expect(output[2]).toContain('1');
            expect(output[2]).toContain('Alice');
            expect(output[3]).toContain('2');
            expect(output[3]).toContain('Bob');
        });

        it('prints key-value for single object', () => {
            printOutput({ status: 'ok', version: '1.0' }, 'table');
            expect(output.join('\n')).toContain('status');
            expect(output.join('\n')).toContain('ok');
            expect(output.join('\n')).toContain('version');
            expect(output.join('\n')).toContain('1.0');
        });
    });

    describe('yaml format', () => {
        it('prints object as YAML-like', () => {
            printOutput({ name: 'test', count: 5 }, 'yaml');
            expect(output).toContain('name: test');
            expect(output).toContain('count: 5');
        });

        it('prints array with dashes', () => {
            printOutput([
                { id: 1, name: 'A' },
                { id: 2, name: 'B' },
            ], 'yaml');
            expect(output[0]).toMatch(/^- id: 1/);
            expect(output[2]).toMatch(/^- id: 2/);
        });

        it('uses consistent indentation for multi-key array items with nested objects (Bug 5 regression)', () => {
            printOutput([{ a: 1, b: { c: 2 } }], 'yaml');
            const joined = output.join('\n');
            expect(joined).toContain('- a: 1');
            expect(joined).toContain('  b:');
            const bLine = output.findIndex(l => l.trimStart().startsWith('b:'));
            const cLine = output[bLine + 1] ?? '';
            expect(cLine).toBe('    c: 2');
        });
    });

    describe('format dispatch', () => {
        const formats: OutputFormat[] = ['json', 'table', 'yaml'];
        for (const fmt of formats) {
            it(`does not throw for format: ${fmt}`, () => {
                expect(() => printOutput({ ok: true }, fmt)).not.toThrow();
            });
        }
    });

    describe('printLines trailing blank (Bug 6 regression)', () => {
        it('does not emit a trailing empty line when formatter output ends with newline', () => {
            printOutput({ key: 'value' }, 'yaml');
            expect(output[output.length - 1]).not.toBe('');
        });

        it('does not emit a trailing empty line for json format', () => {
            printOutput({ x: 1 }, 'json');
            expect(output[output.length - 1]).not.toBe('');
        });
    });
});
