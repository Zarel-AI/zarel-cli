// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerTraceQueryCommand } from '../src/commands/trace/query';
import { printOutput } from '../src/printers/output';

const mockTraces = {
    list: jest.fn().mockResolvedValue({ traces: [], next_cursor: null }),
};

jest.mock('../src/client', () => ({
    createClient: jest.fn(() => ({
        runtime: { traces: mockTraces },
    })),
}));

jest.mock('../src/printers/output', () => ({
    printOutput: jest.fn(),
}));

function buildProgram(): Command {
    const program = new Command();
    const traceCmd = program.command('trace');
    registerTraceQueryCommand(traceCmd);
    return program;
}

describe('trace query command', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
    });

    it('queries a single page (awaits) by default', async () => {
        mockTraces.list.mockResolvedValueOnce({ traces: [{ trace_id: 'a' }], next_cursor: 'c1' });
        await buildProgram().parseAsync(['trace', 'query', '--limit', '10'], { from: 'user' });

        expect(mockTraces.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
        expect(printOutput).toHaveBeenCalledWith({ traces: [{ trace_id: 'a' }], next_cursor: 'c1' }, 'table');
    });

    it('--all auto-paginates across cursors and prints the full set', async () => {
        mockTraces.list.mockReturnValueOnce({

            async *[Symbol.asyncIterator]() {
                yield { trace_id: 'a' };
                yield { trace_id: 'b' };
            },
        });
        await buildProgram().parseAsync(['trace', 'query', '--all'], { from: 'user' });

        expect(printOutput).toHaveBeenCalledWith(
            { traces: [{ trace_id: 'a' }, { trace_id: 'b' }], next_cursor: null },
            'table',
        );
    });
});
