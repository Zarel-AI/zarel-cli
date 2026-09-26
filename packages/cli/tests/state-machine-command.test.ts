// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerStateMachineCommands } from '../src/commands/state-machine';

const mockListEvents = jest.fn().mockResolvedValue({ success: true, data: { count: 0, events: [] } });
const mockListPending = jest.fn().mockResolvedValue({ success: true, data: { count: 0, transition_requests: [] } });
const mockResolve = jest.fn().mockResolvedValue({ success: true, data: {} });
const mockReplay = jest.fn().mockResolvedValue({ success: true, data: { total_events: 0, diverged_count: 0, events: [] } });
const mockStateMachine = {
    listEvents: mockListEvents,
    listPendingTransitions: mockListPending,
    resolveTransitionRequest: mockResolve,
    replay: mockReplay,
};

jest.mock('../src/client', () => ({
    createClient: jest.fn(() => ({
        runtime: {
            stateMachine: {
                events: { list: mockListEvents, get: jest.fn() },
                instances: { list: jest.fn(), get: jest.fn() },
                transitions: {
                    list: jest.fn(),
                    listPending: mockListPending,
                    get: jest.fn(),
                    create: jest.fn(),
                    resolve: mockResolve,
                },
                replay: mockReplay,
            },
        },
    })),
}));

jest.mock('../src/printers/output', () => ({
    printOutput: jest.fn(),
}));

describe('state-machine command', () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        errorSpy.mockRestore();
        process.exitCode = undefined;
    });

    it('events rejects missing selector', async () => {
        const program = new Command();
        registerStateMachineCommands(program);

        await program.parseAsync(['state-machine', 'events'], { from: 'user' });

        expect(process.exitCode).toBe(2);
        expect(errorSpy).toHaveBeenCalledWith('Error: provide exactly one of --entity or --instance');
    });

    it('events forwards entity filter', async () => {
        const program = new Command();
        registerStateMachineCommands(program);

        await program.parseAsync(['state-machine', 'events', '--entity', 'tickets'], { from: 'user' });

        expect(mockStateMachine.listEvents).toHaveBeenCalledWith(expect.objectContaining({ entity_name: 'tickets' }));
    });

    it('pending forwards role filter', async () => {
        const program = new Command();
        registerStateMachineCommands(program);

        await program.parseAsync(['state-machine', 'pending', '--role', 'manager'], { from: 'user' });

        expect(mockStateMachine.listPendingTransitions).toHaveBeenCalledWith(expect.objectContaining({ roles: ['manager'] }));
    });

    it('approve passes ID and notes', async () => {
        const program = new Command();
        registerStateMachineCommands(program);

        await program.parseAsync(
            ['state-machine', 'approve', 'apr-001', '--notes', 'looks good'],
            { from: 'user' },
        );

        expect(mockStateMachine.resolveTransitionRequest).toHaveBeenCalledWith(
            'apr-001',
            // `status`, not `decision` — the key `patchTransition` reads. This pinned a body
            // the route drops, which is how `zarel state-machine approve` shipped resolving nothing.
            expect.objectContaining({ status: 'approved', decision_notes: 'looks good' }),
        );
    });

    it('reject passes ID', async () => {
        const program = new Command();
        registerStateMachineCommands(program);

        await program.parseAsync(['state-machine', 'reject', 'apr-002'], { from: 'user' });

        expect(mockStateMachine.resolveTransitionRequest).toHaveBeenCalledWith(
            'apr-002',
            expect.objectContaining({ status: 'rejected' }),
        );
    });

    // `replay` moved here from the deleted `zarel workflows replay`.
    it('replay forwards instance id + parsed config', async () => {
        const program = new Command();
        registerStateMachineCommands(program);

        const configJson = JSON.stringify({
            field: 'status',
            initial: 'requested',
            transitions: [{ from: 'requested', to: 'approved' }],
        });

        await program.parseAsync(
            ['state-machine', 'replay', '--instance', 'inst-42', '--config', configJson],
            { from: 'user' },
        );

        expect(mockStateMachine.replay).toHaveBeenCalledWith(expect.objectContaining({
            instance_id: 'inst-42',
            new_config: expect.objectContaining({ field: 'status', initial: 'requested' }),
        }));
    });
});
