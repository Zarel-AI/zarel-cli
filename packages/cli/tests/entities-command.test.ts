// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerEntitiesCommands } from '../src/commands/entities';
import { registerRuntimeEntitiesCommands } from '../src/commands/runtime-entities';

const mockEntities = {
    list: jest.fn().mockResolvedValue({ success: true, data: [] }),
    get: jest.fn().mockResolvedValue({ success: true, data: { name: 'tickets' } }),
    create: jest.fn().mockResolvedValue({ success: true, data: { name: 'tasks' } }),
};

// `recompute` is a RUNTIME-plane verb — it rewrites runtime.records.
// The rest of the family authors contract state. Two namespaces, deliberately.
const mockRuntimeEntities = {
    recompute: jest.fn().mockResolvedValue({ success: true, data: { recomputed: 5 } }),
};

jest.mock('../src/client', () => ({
    createClient: jest.fn(() => ({
        contract: { entities: mockEntities },
        runtime: { entities: mockRuntimeEntities },
    })),
}));

jest.mock('../src/printers/output', () => ({
    printOutput: jest.fn(),
}));

describe('entities command', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
    });

    afterEach(() => {
        process.exitCode = undefined;
    });

    it('list calls entities.list()', async () => {
        const program = new Command();
        registerEntitiesCommands(program);

        await program.parseAsync(['entities', 'list'], { from: 'user' });

        expect(mockEntities.list).toHaveBeenCalled();
    });

    it('get passes entity name', async () => {
        const program = new Command();
        registerEntitiesCommands(program);

        await program.parseAsync(['entities', 'get', 'tickets'], { from: 'user' });

        expect(mockEntities.get).toHaveBeenCalledWith('tickets');
    });

    it('create passes name and extra data', async () => {
        const program = new Command();
        registerEntitiesCommands(program);

        await program.parseAsync(
            ['entities', 'create', '--name', 'tasks', '--data', '{"description":"Task entity"}'],
            { from: 'user' },
        );

        expect(mockEntities.create).toHaveBeenCalledWith({ name: 'tasks', description: 'Task entity' });
    });

    it('recompute passes entity name — via the RUNTIME namespace', async () => {
        const program = new Command();
        registerRuntimeEntitiesCommands(program);

        await program.parseAsync(['entities', 'recompute', 'orders'], { from: 'user' });

        expect(mockRuntimeEntities.recompute).toHaveBeenCalledWith('orders');
    });

    // The contract-plane family must NOT carry the verb any more; if it did, the
    // route it targets no longer exists and every call would 404.
    it('the contract-plane entities family no longer exposes recompute', () => {
        const program = new Command();
        registerEntitiesCommands(program);
        const entities = program.commands.find(c => c.name() === 'entities');
        expect(entities?.commands.map(c => c.name())).not.toContain('recompute');
    });
});
