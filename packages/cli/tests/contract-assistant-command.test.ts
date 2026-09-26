// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerAssistantCommands } from '../src/commands/contract/assistant';

const mockAssistant = {
    createSession: jest.fn().mockResolvedValue({ session_key: 's-1' }),
    conversationSend: jest.fn().mockResolvedValue({ reply: 'ok', changeset_id: 'cs-1' }),
    getChangeset: jest.fn().mockResolvedValue({ id: 'cs-1', status: 'pending' }),
    applyChangeset: jest.fn().mockResolvedValue({ applied: true, applied_version: 6 }),
    discardChangeset: jest.fn().mockResolvedValue({ discarded: true }),
};

jest.mock('../src/client', () => ({
    createClient: jest.fn(() => ({ contract: { assistant: mockAssistant } })),
}));

jest.mock('../src/printers/output', () => ({
    printOutput: jest.fn(),
}));

function run(...argv: string[]): Promise<Command> {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
    registerAssistantCommands(program);
    return program.parseAsync(argv, { from: 'user' });
}

describe('contract assistant command', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
    });
    afterEach(() => {
        process.exitCode = undefined;
    });

    it('session create passes the optional llm-service', async () => {
        await run('assistant', 'session', 'create', '--llm-service', 'primary');
        expect(mockAssistant.createSession).toHaveBeenCalledWith({ llm_service: 'primary' });
    });

    it('conversation send passes session_key + message', async () => {
        await run('assistant', 'conversation', 'send', '--session', 's-1', '--message', 'add a field');
        expect(mockAssistant.conversationSend).toHaveBeenCalledWith({ session_key: 's-1', message: 'add a field' });
    });

    it('changeset get passes the id', async () => {
        await run('assistant', 'changeset', 'get', 'cs-1');
        expect(mockAssistant.getChangeset).toHaveBeenCalledWith('cs-1');
    });

    it('changeset apply REQUIRES and passes base_hash + gating', async () => {
        await run('assistant', 'changeset', 'apply', 'cs-1', '--base-hash', 'v5', '--reject-breaking', '--max-changes', '10');
        expect(mockAssistant.applyChangeset).toHaveBeenCalledWith('cs-1', {
            base_hash: 'v5',
            gating: { reject_breaking_changes: true, max_changes: 10 },
        });
    });

    it('changeset apply without --base-hash errors (consent over a known base)', async () => {
        await expect(run('assistant', 'changeset', 'apply', 'cs-1')).rejects.toBeTruthy();
        expect(mockAssistant.applyChangeset).not.toHaveBeenCalled();
    });

    it('changeset apply rejects a non-numeric --max-changes (no NaN to the SDK)', async () => {
        await expect(
            run('assistant', 'changeset', 'apply', 'cs-1', '--base-hash', 'v5', '--max-changes', 'abc'),
        ).rejects.toBeTruthy();
        expect(mockAssistant.applyChangeset).not.toHaveBeenCalled();
    });

    it('changeset discard passes the id', async () => {
        await run('assistant', 'changeset', 'discard', 'cs-1');
        expect(mockAssistant.discardChangeset).toHaveBeenCalledWith('cs-1');
    });
});
