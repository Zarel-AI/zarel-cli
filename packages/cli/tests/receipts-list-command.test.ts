// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
// `zarel receipts list`. Mirrors the audit-list command test.
import { Command } from 'commander';
import { registerReceiptsCommands } from '../src/commands/receipts';
import { printOutput } from '../src/printers/output';

const mockReceipts = {
    list: jest.fn().mockResolvedValue({ items: [], next_cursor: null }),
};

jest.mock('../src/client', () => ({
    createClient: jest.fn(() => ({
        runtime: { receipts: mockReceipts },
    })),
}));

jest.mock('../src/printers/output', () => ({
    printOutput: jest.fn(),
}));

function buildProgram(): Command {
    const program = new Command();
    program.exitOverride();
    registerReceiptsCommands(program);
    return program;
}

describe('zarel receipts list', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
    });

    it('maps signal/trace-id/limit and prints the single page', async () => {
        mockReceipts.list.mockResolvedValueOnce({ items: [{ id: 'refusal:a' }], next_cursor: 'c1' });
        await buildProgram().parseAsync(
            ['receipts', 'list', '--signal', 'refusal', '--trace-id', 'trc_1', '--limit', '10'],
            { from: 'user' },
        );
        expect(mockReceipts.list).toHaveBeenCalledWith(
            expect.objectContaining({ signal: 'refusal', trace_id: 'trc_1', limit: 10 }),
        );
        expect(printOutput).toHaveBeenCalledWith({ items: [{ id: 'refusal:a' }], next_cursor: 'c1' }, 'table');
    });

    it('no filters + --format json lists everything for the caller', async () => {
        mockReceipts.list.mockResolvedValueOnce({ items: [{ id: 'binding_violation:b' }], next_cursor: null });
        await buildProgram().parseAsync(['receipts', 'list', '--format', 'json'], { from: 'user' });
        expect(mockReceipts.list).toHaveBeenCalledWith({});
        expect(printOutput).toHaveBeenCalledWith({ items: [{ id: 'binding_violation:b' }], next_cursor: null }, 'json');
    });

    it('--all auto-paginates across cursors and prints the full set', async () => {
        mockReceipts.list.mockReturnValueOnce({

            async *[Symbol.asyncIterator]() {
                yield { id: 'refusal:a' };
                yield { id: 'validation_violation:c' };
            },
        });
        await buildProgram().parseAsync(['receipts', 'list', '--all'], { from: 'user' });
        expect(printOutput).toHaveBeenCalledWith(
            { items: [{ id: 'refusal:a' }, { id: 'validation_violation:c' }], next_cursor: null },
            'table',
        );
    });

    it('rejects a bad --signal without calling the SDK', async () => {
        await buildProgram().parseAsync(['receipts', 'list', '--signal', 'nope'], { from: 'user' });
        expect(mockReceipts.list).not.toHaveBeenCalled();
        expect(process.exitCode).not.toBe(0);
    });
});
