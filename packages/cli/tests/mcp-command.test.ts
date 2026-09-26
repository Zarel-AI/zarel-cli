// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerMcpCommands } from '../src/commands/runtime/mcp';
import { printOutput } from '../src/printers/output';

const mockMcp = {
    call: jest.fn().mockResolvedValue({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
};

jest.mock('../src/client', () => ({
    createClient: jest.fn(() => ({
        runtime: { mcp: mockMcp },
    })),
}));

jest.mock('../src/printers/output', () => ({
    printOutput: jest.fn(),
}));

describe('runtime mcp call command', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
    });
    afterEach(() => {
        process.exitCode = undefined;
    });

    it('parses --message and calls runtime.mcp.call with the JSON-RPC message', async () => {
        const program = new Command();
        registerMcpCommands(program);
        await program.parseAsync(
            ['mcp', 'call', '--message', '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'],
            { from: 'user' },
        );
        expect(mockMcp.call).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
        expect(printOutput).toHaveBeenCalledWith(
            { jsonrpc: '2.0', id: 1, result: { tools: [] } },
            'json',
        );
    });

    it('reports an error and sets a non-zero exit on invalid JSON', async () => {
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const program = new Command();
        registerMcpCommands(program);
        await program.parseAsync(['mcp', 'call', '--message', 'not-json'], { from: 'user' });
        expect(mockMcp.call).not.toHaveBeenCalled();
        expect(process.exitCode).not.toBe(0);
        errSpy.mockRestore();
    });
});
