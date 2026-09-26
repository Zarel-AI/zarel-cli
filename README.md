# zarel-cli

The command-line interface for the [Zarel](https://zarel.ai) API, and the offline verifier for
its audit evidence.

| package | what it is |
|---|---|
| [`@zarel-ai/cli`](packages/cli) | The `zarel` command. Talks to the API through [`@zarel-ai/sdk`](https://www.npmjs.com/package/@zarel-ai/sdk), and verifies an audit-evidence bundle offline — hash chain, signed checkpoints, and RFC 3161 anchoring — with [`@zarel-ai/audit-chain`](https://www.npmjs.com/package/@zarel-ai/audit-chain) and [`@zarel-ai/audit-tsa`](https://www.npmjs.com/package/@zarel-ai/audit-tsa). |

The package's README shows how to use it.

## Building and testing

```bash
cd packages/cli
npm install
npm test
npm run build
```

## Test fixtures

The bundle-verification tests read signed bundles from `packages/cli/tests/fixtures/`, committed
rather than built at test time. Producing one needs the signer that writes the evidence, which is
not part of this repository — so the fixtures are produced upstream and travel with the release.
Verifying them needs nothing but what is here, which is the property the tests are about.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Every commit needs a `Signed-off-by:` line, under the
[Developer Certificate of Origin](DCO).

## License

MIT © 2026 Nicolas Moreno. See [LICENSE](LICENSE).
