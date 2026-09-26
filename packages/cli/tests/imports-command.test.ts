// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import * as fs from 'node:fs';
import { Command } from 'commander';
import { registerImportCommands } from '../src/commands/imports';

jest.mock('node:fs', () => ({
    readFileSync: jest.fn(),
}));

const mockImports = {
    snapshot: jest.fn().mockResolvedValue({ success: true }),
};

jest.mock('../src/client', () => ({
    createClient: jest.fn(() => ({
        runtime: { imports: mockImports },
    })),
}));

jest.mock('../src/printers/output', () => ({
    printOutput: jest.fn(),
}));

describe('imports command', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('imports a tenant snapshot file', async () => {
        const readFileSyncMock = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
        readFileSyncMock.mockReturnValue('{"metadata":{"format_version":"1.0","tenant":"support"},"users":[],"records":{}}');
        const program = new Command();
        registerImportCommands(program);

        await program.parseAsync(['imports', 'snapshot', 'support.data.json'], { from: 'user' });

        expect(mockImports.snapshot).toHaveBeenCalledWith({
            data: { metadata: { format_version: '1.0', tenant: 'support' }, users: [], records: {} },
            mode: 'clean',
            validation_mode: 'fail-fast',
        });
    });

    it('does not expose a bootstrap subcommand', () => {
        const program = new Command();
        registerImportCommands(program);
        const importsCmd = program.commands.find((c) => c.name() === 'imports');
        expect(importsCmd).toBeDefined();
        const subcommands = importsCmd?.commands.map((c) => c.name()) ?? [];
        expect(subcommands).toContain('snapshot');
        expect(subcommands).not.toContain('bootstrap');
    });
});
