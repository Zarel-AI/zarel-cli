// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { formatTable } from '../src/formatters/table';
import { formatJson } from '../src/formatters/json';
import { formatYaml } from '../src/formatters/yaml';

describe('formatTable', () => {
    it('returns (empty) for null', () => {
        expect(formatTable(null)).toBe('(empty)');
    });

    it('returns (empty) for undefined', () => {
        expect(formatTable(undefined)).toBe('(empty)');
    });

    it('returns string directly', () => {
        expect(formatTable('hello')).toBe('hello');
    });

    it('stringifies numbers', () => {
        expect(formatTable(42)).toBe('42');
    });

    it('stringifies booleans', () => {
        expect(formatTable(true)).toBe('true');
    });

    it('returns (empty) for empty array', () => {
        expect(formatTable([])).toBe('(empty)');
    });

    it('returns (empty) for empty object', () => {
        expect(formatTable({})).toBe('(empty)');
    });

    it('formats array of primitives one per line', () => {
        expect(formatTable([1, 2, 3])).toBe('1\n2\n3');
    });

    it('formats array of objects as columnar table', () => {
        const result = formatTable([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
        ]);
        const lines = result.split('\n');
        expect(lines[0]).toContain('ID');
        expect(lines[0]).toContain('NAME');
        expect(lines[1]).toMatch(/^-+/);
        expect(lines[2]).toContain('1');
        expect(lines[2]).toContain('Alice');
        expect(lines[3]).toContain('2');
        expect(lines[3]).toContain('Bob');
    });

    it('formats single object as key-value', () => {
        const result = formatTable({ status: 'ok', version: '1.0' });
        expect(result).toContain('status');
        expect(result).toContain('ok');
        expect(result).toContain('version');
        expect(result).toContain('1.0');
    });

    it('handles nested objects via JSON.stringify', () => {
        const result = formatTable({ id: 1, meta: { nested: true } });
        expect(result).toContain('{"nested":true}');
    });

    it('handles null values in table cells', () => {
        const result = formatTable([{ a: 1, b: null }]);
        const lines = result.split('\n');
        expect(lines.length).toBe(3);
    });
});

describe('formatJson', () => {
    it('pretty-prints object', () => {
        const result = formatJson({ a: 1 });
        expect(JSON.parse(result)).toEqual({ a: 1 });
        expect(result).toContain('\n');
    });

    it('pretty-prints array', () => {
        const result = formatJson([1, 2]);
        expect(JSON.parse(result)).toEqual([1, 2]);
    });

    it('handles null', () => {
        expect(formatJson(null)).toBe('null');
    });
});

describe('formatYaml', () => {
    it('formats scalar string', () => {
        expect(formatYaml('hello')).toBe('hello');
    });

    it('formats number', () => {
        expect(formatYaml(42)).toBe('42');
    });

    it('formats boolean', () => {
        expect(formatYaml(true)).toBe('true');
    });

    it('formats null', () => {
        expect(formatYaml(null)).toBe('null');
    });

    it('formats empty array as []', () => {
        expect(formatYaml([])).toBe('[]');
    });

    it('formats flat object', () => {
        const result = formatYaml({ name: 'test', count: 5 });
        expect(result).toContain('name: test');
        expect(result).toContain('count: 5');
    });

    it('formats nested object', () => {
        const result = formatYaml({ outer: { inner: 'val' } });
        expect(result).toContain('outer:');
        expect(result).toContain('  inner: val');
    });

    it('formats array of objects with dash prefix', () => {
        const result = formatYaml([{ id: 1 }, { id: 2 }]);
        const lines = result.split('\n');
        expect(lines[0]).toBe('- id: 1');
        expect(lines[1]).toBe('- id: 2');
    });

    it('handles multi-key array items with nested objects', () => {
        const result = formatYaml([{ a: 1, b: { c: 2 } }]);
        const lines = result.split('\n');
        expect(lines[0]).toBe('- a: 1');
        expect(lines[1]).toBe('  b:');
        expect(lines[2]).toBe('    c: 2');
    });

    it('formats array of scalars', () => {
        const result = formatYaml([1, 'two', true]);
        expect(result).toContain('- 1');
        expect(result).toContain('- two');
        expect(result).toContain('- true');
    });

    it('handles empty object in array', () => {
        const result = formatYaml([{}]);
        expect(result).toBe('- {}');
    });

    it('quotes strings with special characters', () => {
        const result = formatYaml({ note: 'has: colon' });
        expect(result).toContain('"has: colon"');
    });
});
