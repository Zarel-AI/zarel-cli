// SPDX-License-Identifier: MIT
// Copyright 2026 Nicolas Moreno
// `zarel audit evidence` and `zarel trace bundle` write the bytes the API answered.
//
// Nothing here mocks the SDK: `createClient()` builds the real `Zarel` from env, and `fetch` is
// stubbed at the network edge. The placeholder this replaces was a `describe.skip` of
// `expect(true)`, while both commands threw inside the SDK on every call.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { registerAuditCommands } from '../src/commands/audit';
import { registerTraceCommands } from '../src/commands/trace';

jest.mock('../src/config', () => ({
    ...jest.requireActual('../src/config'),
    loadConfig: jest.fn().mockReturnValue({}),
}));

// Not valid UTF-8 (0x8b continues nothing), so a transport that decodes text cannot write it intact.
const BUNDLE = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xfe, 0x80, 0xc3, 0x28, 0x00]);

const ENV: Record<string, string> = {
    ZAREL_TENANT: 'acme',
    ZAREL_RUNTIME_TOKEN: 'runtime.jwt',
    ZAREL_BASE_URL: 'https://acme.zarel.test/v1',
};
const savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let dir: string;
let calls: Array<{ url: string; init: RequestInit | undefined }>;

function answer(response: () => Response): void {
    globalThis.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init });
        return response();
    }) as typeof fetch;
}

async function run(args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerAuditCommands(program);
    registerTraceCommands(program);
    await program.parseAsync(args, { from: 'user' });
}

beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zarel-bundle-'));
    calls = [];
    process.exitCode = undefined;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    for (const k of Object.keys(ENV)) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
    process.exitCode = undefined;
    jest.restoreAllMocks();
});

describe.each([
    { command: ['audit', 'evidence', 'flows'], url: 'https://acme.zarel.test/v1/runtime/audit/flows/evidence' },
    { command: ['trace', 'bundle', 'trc_01'], url: 'https://acme.zarel.test/v1/runtime/traces/trc_01/bundle' },
])('zarel $command.0 $command.1', ({ command, url }) => {
    it('writes the answered bytes unchanged', async () => {
        answer(() => new Response(BUNDLE, { status: 200, headers: { 'Content-Type': 'application/gzip' } }));
        const out = path.join(dir, 'bundle.tar.gz');

        await run([...command, '--output', out]);

        expect(process.exitCode).toBeUndefined();
        expect(calls.map((c) => c.url)).toEqual([url]);
        expect((calls[0]?.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer runtime.jwt');
        expect(fs.readFileSync(out).equals(BUNDLE)).toBe(true);
    });

    it('writes nothing and exits non-zero on a refusal', async () => {
        answer(() => new Response(
            JSON.stringify({ error: { type: 'not_found', code: 'not_found', message: 'no such chain' } }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
        ));
        const out = path.join(dir, 'bundle.tar.gz');

        await run([...command, '--output', out]);

        expect(process.exitCode).toBe(1);
        expect(fs.existsSync(out)).toBe(false);
    });
});
