// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
// `zarel audit list <log>`.
import { Command } from 'commander';
import { registerAuditListCommand } from '../src/commands/audit/list';
import { printOutput } from '../src/printers/output';

const mockAudit = {
    list: jest.fn().mockResolvedValue({ items: [], next_cursor: null }),
};

jest.mock('../src/client', () => ({
    createClient: jest.fn(() => ({
        runtime: { audit: mockAudit },
    })),
}));

jest.mock('../src/printers/output', () => ({
    printOutput: jest.fn(),
}));

function buildProgram(): Command {
    const program = new Command();
    program.exitOverride();
    const auditCmd = program.command('audit');
    registerAuditListCommand(auditCmd);
    return program;
}

describe('zarel audit list <log>', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
    });

    it('binding_violations: maps filters and prints the single page', async () => {
        mockAudit.list.mockResolvedValueOnce({ items: [{ id: 'a', entity: 'Account' }], next_cursor: 'c1' });
        await buildProgram().parseAsync(
            ['audit', 'list', 'binding_violations', '--entity', 'Account', '--binding-mode', 'immutable', '--limit', '10'],
            { from: 'user' },
        );
        expect(mockAudit.list).toHaveBeenCalledWith(
            'binding_violations',
            expect.objectContaining({ entity: 'Account', bindingMode: 'immutable', limit: 10 }),
        );
        expect(printOutput).toHaveBeenCalledWith({ items: [{ id: 'a', entity: 'Account' }], next_cursor: 'c1' }, 'table');
    });

    it('topic_refusals: maps category/reason/verdict + --format json', async () => {
        mockAudit.list.mockResolvedValueOnce({ items: [{ id: 't' }], next_cursor: null });
        await buildProgram().parseAsync(
            ['audit', 'list', 'topic_refusals', '--category', 'investment_advice', '--reason', 'matched', '--format', 'json'],
            { from: 'user' },
        );
        expect(mockAudit.list).toHaveBeenCalledWith(
            'topic_refusals',
            expect.objectContaining({ category: 'investment_advice', reason: 'matched' }),
        );
        expect(printOutput).toHaveBeenCalledWith({ items: [{ id: 't' }], next_cursor: null }, 'json');
    });

    it('--all auto-paginates across cursors and prints the full set', async () => {
        mockAudit.list.mockReturnValueOnce({

            async *[Symbol.asyncIterator]() {
                yield { id: 'a' };
                yield { id: 'b' };
            },
        });
        await buildProgram().parseAsync(['audit', 'list', 'binding_violations', '--all'], { from: 'user' });
        expect(printOutput).toHaveBeenCalledWith({ items: [{ id: 'a' }, { id: 'b' }], next_cursor: null }, 'table');
    });

    it('rejects an unknown log (the evidence-only state_machine) without calling the SDK', async () => {
        await buildProgram().parseAsync(['audit', 'list', 'state_machine'], { from: 'user' });
        expect(mockAudit.list).not.toHaveBeenCalled();
        expect(process.exitCode).not.toBe(0);
    });

    it('rejects a bad --binding-mode without calling the SDK', async () => {
        await buildProgram().parseAsync(['audit', 'list', 'binding_violations', '--binding-mode', 'nope'], { from: 'user' });
        expect(mockAudit.list).not.toHaveBeenCalled();
        expect(process.exitCode).not.toBe(0);
    });
});
