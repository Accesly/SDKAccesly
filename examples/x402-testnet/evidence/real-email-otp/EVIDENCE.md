# Evidence — x402 on Stellar testnet

Generated 2026-10-25T03:12:42.301Z. Every row was re-checked against the network when this file
was generated.

- x402 spending policy: [CBWNUGXOJWNNQ5FGLRD3HCREU7XD2RTZNFPZDDRKE3RL4JEH3N75VZZV](https://stellar.expert/explorer/testnet/contract/CBWNUGXOJWNNQ5FGLRD3HCREU7XD2RTZNFPZDDRKE3RL4JEH3N75VZZV)
- Customer Smart Account (v3.2.0, same WASM as mainnet): [CBZHNU3CWXVPAPOUJUOWZG26MHEDW7WDFTFJ2QKYTX3CT4WZLLOGKK5G](https://stellar.expert/explorer/testnet/contract/CBZHNU3CWXVPAPOUJUOWZG26MHEDW7WDFTFJ2QKYTX3CT4WZLLOGKK5G)
- Payments: 3 (3 succeeded on-chain), 3 of them to the Opportuni agent
- On-chain policy rejections: 0/0 confirmed with the expected contract error

## Setup, deploy and policy

| UTC | What | On-chain | Tx |
|---|---|---|---|
| 2026-10-25 03:06 | deploy customer Smart Account v3 | SUCCESS | [e6ac7adb88…](https://stellar.expert/explorer/testnet/tx/e6ac7adb884f7d5fae6bfb497165c0682f08bcecf8333135b1c97a03941e52e6) |
| 2026-10-25 03:06 | bootstrap Smart Account (owner = MPC 2-of-3 key) | SUCCESS | [fd22b8262e…](https://stellar.expert/explorer/testnet/tx/fd22b8262ef900311fa8b67536d0f0c9faa24519384427bb707116251d24ccae) |
| 2026-10-25 03:06 | fund Smart Account with 5 test USDC | SUCCESS | [c842393817…](https://stellar.expert/explorer/testnet/tx/c8423938178ec1fca90e708c9e582f0166618a427e3981a581f6ad6a0e1dd194) |
| 2026-10-25 03:06 | install x402 rule 3 for session key: cap $0.05/payment, $5/month, allowlist = merchant; signed by the owner under MPC 2-of-3 after email OTP | SUCCESS | [540b3fd847…](https://stellar.expert/explorer/testnet/tx/540b3fd847ec1f5e592da53e4bd80f9b7c026cd6042f8e7f778fdb3e88e8cfda) |

## On-chain rejections

| UTC | What | On-chain | Tx |
|---|---|---|---|



## Payments

| UTC | What | On-chain | Tx |
|---|---|---|---|
| 2026-10-25 03:07 | x402 payment #1 ($0.01 USDC, signer=session) for "ventas en CDMX" | SUCCESS | [def4ea5959…](https://stellar.expert/explorer/testnet/tx/def4ea5959a80532b94dc7036c2b1a1e483d302a70bb3c7a264d16a6d56c8e22) |
| 2026-10-25 03:07 | x402 payment #2 ($0.01 USDC, signer=session) for "community manager" | SUCCESS | [ae261e8a7d…](https://stellar.expert/explorer/testnet/tx/ae261e8a7dbb1cce21a84fd45992d8a86fa1eda39cceca01bda5dac4c00bf9fc) |
| 2026-10-25 03:07 | x402 payment #3 ($0.01 USDC, signer=session) for "analista de datos" | SUCCESS | [4ddceac2cf…](https://stellar.expert/explorer/testnet/tx/4ddceac2cfbcca92fc3fc404bfd50b96a4935332124575fe5185d2edcc655e66) |
