// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerRecordsCommands } from '../src/commands/records';
import { printOutput } from '../src/printers/output';

const mockRecords = {
    list: jest.fn().mockResolvedValue({ success: true, data: [] }),
    get: jest.fn().mockResolvedValue({ success: true, data: { id: 1 } }),
    create: jest.fn().mockResolvedValue({ success: true, data: { id: 99 } }),
    bulk: jest.fn().mockResolvedValue({ success: true, items: [] }),
    update: jest.fn().mockResolvedValue({ success: true, data: { id: 1 } }),
    delete: jest.fn().mockResolvedValue({ success: true }),
};

jest.mock('../src/client', () => ({
    createClient: jest.fn(() => ({
        runtime: { records: mockRecords },
    })),
}));

jest.mock('../src/printers/output', () => ({
    printOutput: jest.fn(),
}));

describe('records command', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
        consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleSpy.mockRestore();
        process.exitCode = undefined;
    });

    it('list passes entity and limit', async () => {
        const program = new Command();
        registerRecordsCommands(program);

        await program.parseAsync(['records', 'list', 'tickets', '--limit', '5'], { from: 'user' });

        expect(mockRecords.list).toHaveBeenCalledWith('tickets', expect.objectContaining({ limit: 5 }));
    });

    it('list --all auto-paginates and prints the full collected set', async () => {
        // With --all the command iterates the PagePromise instead of awaiting one page.
        mockRecords.list.mockReturnValueOnce({

            async *[Symbol.asyncIterator]() {
                yield { id: 1 };
                yield { id: 2 };
                yield { id: 3 };
            },
        });
        const program = new Command();
        registerRecordsCommands(program);

        await program.parseAsync(['records', 'list', 'tickets', '--all'], { from: 'user' });

        // limit (default 20) becomes the page size passed to the SDK.
        expect(mockRecords.list).toHaveBeenCalledWith('tickets', expect.objectContaining({ limit: 20 }));
        expect(printOutput).toHaveBeenCalledWith(
            { records: [{ id: 1 }, { id: 2 }, { id: 3 }], total: 3 },
            'table',
        );
    });

    it('get coerces numeric IDs', async () => {
        const program = new Command();
        registerRecordsCommands(program);

        await program.parseAsync(['records', 'get', 'tickets', '42'], { from: 'user' });

        expect(mockRecords.get).toHaveBeenCalledWith('tickets', 42);
    });

    it('get passes string IDs for display IDs', async () => {
        const program = new Command();
        registerRecordsCommands(program);

        await program.parseAsync(['records', 'get', 'tickets', 'TKT-1'], { from: 'user' });

        expect(mockRecords.get).toHaveBeenCalledWith('tickets', 'TKT-1');
    });

    it('create parses --data JSON', async () => {
        const program = new Command();
        registerRecordsCommands(program);

        await program.parseAsync(['records', 'create', 'tickets', '--data', '{"title":"bug"}'], { from: 'user' });

        expect(mockRecords.create).toHaveBeenCalledWith('tickets', { title: 'bug' });
    });

    it('bulk parses --items JSON array', async () => {
        const program = new Command();
        registerRecordsCommands(program);

        await program.parseAsync(
            ['records', 'bulk', 'tickets', '--items', '[{"data":{"title":"bug"}}]', '--mode', 'best_effort'],
            { from: 'user' },
        );

        expect(mockRecords.bulk).toHaveBeenCalledWith('tickets', {
            items: [{ data: { title: 'bug' } }],
            mode: 'best_effort',
        });
    });

    it('delete calls with entity and coerced ID', async () => {
        const program = new Command();
        registerRecordsCommands(program);

        await program.parseAsync(['records', 'delete', 'tickets', '7'], { from: 'user' });

        expect(mockRecords.delete).toHaveBeenCalledWith('tickets', 7);
    });
});
