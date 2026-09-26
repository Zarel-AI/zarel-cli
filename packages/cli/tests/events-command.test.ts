// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
import { Command } from 'commander';
import { registerEventsCommands } from '../src/commands/events';
import { printOutput } from '../src/printers/output';

function asyncFrom(items: unknown[]): AsyncIterableIterator<unknown> {
    let i = 0;
    const it: AsyncIterableIterator<unknown> = {

        async next(): Promise<IteratorResult<unknown>> {
            return i < items.length ? { value: items[i++], done: false } : { value: undefined, done: true };
        },
        [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
            return it;
        },
    };
    return it;
}

const mockEvents = {
    iterate: jest.fn(() => asyncFrom([{ event: 'record.updated', data: { n: 1 } }, { event: 'record.updated', data: { n: 2 } }])),
    subscriptions: {
        create: jest.fn().mockResolvedValue({ success: true, data: { id: 's1' } }),
        list: jest.fn().mockResolvedValue({ success: true, data: [] }),
        delete: jest.fn().mockResolvedValue({ success: true }),
    },
};

jest.mock('../src/client', () => ({
    createClient: jest.fn(() => ({
        runtime: { events: mockEvents },
    })),
}));

jest.mock('../src/printers/output', () => ({
    printOutput: jest.fn(),
}));

describe('events tail command', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
        mockEvents.iterate.mockReturnValue(
            asyncFrom([{ event: 'record.updated', data: { n: 1 } }, { event: 'record.updated', data: { n: 2 } }]),
        );
    });

    it('streams each event through printOutput', async () => {
        const program = new Command();
        registerEventsCommands(program);

        await program.parseAsync(['events', 'tail'], { from: 'user' });

        expect(printOutput).toHaveBeenCalledTimes(2);
        expect(printOutput).toHaveBeenNthCalledWith(1, { event: 'record.updated', data: { n: 1 } }, 'json');
        expect(printOutput).toHaveBeenNthCalledWith(2, { event: 'record.updated', data: { n: 2 } }, 'json');
    });

    it('passes the default buffer size and an abort signal', async () => {
        const program = new Command();
        registerEventsCommands(program);

        await program.parseAsync(['events', 'tail'], { from: 'user' });

        expect(mockEvents.iterate).toHaveBeenCalledWith(
            expect.objectContaining({
                bufferSize: 1024,
                signal: expect.any(AbortSignal),
                onDropped: expect.any(Function),
            }),
        );
    });

    it('forwards --buffer-size, --last-event-id, and --no-reconnect', async () => {
        const program = new Command();
        registerEventsCommands(program);

        await program.parseAsync(
            ['events', 'tail', '--buffer-size', '50', '--last-event-id', 'evt-9', '--no-reconnect'],
            { from: 'user' },
        );

        expect(mockEvents.iterate).toHaveBeenCalledWith(
            expect.objectContaining({ bufferSize: 50, lastEventId: 'evt-9', reconnect: false }),
        );
    });
});
