// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerRoleAssignmentsCommands } from '../src/commands/role-assignments';

const mockRoleAssignments = {
    list: jest.fn().mockResolvedValue({ success: true, data: [] }),
    create: jest.fn().mockResolvedValue({ success: true }),
    delete: jest.fn().mockResolvedValue({ success: true }),
};

jest.mock('../src/client', () => ({
    createClient: jest.fn(() => ({
        runtime: { roles: { assignments: mockRoleAssignments } },
    })),
}));

jest.mock('../src/printers/output', () => ({
    printOutput: jest.fn(),
}));

describe('role-assignments command', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
    });

    it('create forwards user + role', async () => {
        const program = new Command();
        registerRoleAssignmentsCommands(program);

        await program.parseAsync(
            ['role-assignments', 'create', '--user', 'alice', '--role', 'admin'],
            { from: 'user' },
        );

        expect(mockRoleAssignments.create).toHaveBeenCalledWith(expect.objectContaining({
            target_user_name: 'alice',
            role_name: 'admin',
        }));
    });

    it('delete uses composite natural key', async () => {
        const program = new Command();
        registerRoleAssignmentsCommands(program);

        await program.parseAsync(
            ['role-assignments', 'delete', 'alice', 'admin'],
            { from: 'user' },
        );

        expect(mockRoleAssignments.delete).toHaveBeenCalledWith('alice', 'admin');
    });

    it('list has no required args', async () => {
        const program = new Command();
        registerRoleAssignmentsCommands(program);

        await program.parseAsync(['role-assignments', 'list'], { from: 'user' });

        expect(mockRoleAssignments.list).toHaveBeenCalled();
    });
});
