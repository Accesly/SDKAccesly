# NFC fare terminal for public transport (Instaward #3, November 2026)

Documentation for Accesly's 30-day sprint: collecting public transport fares in Mexico with an NFC terminal on the driver's phone, settled in USDC on Stellar mainnet directly to the unit owner.

- [`ARCHITECTURE.md`](./ARCHITECTURE.md): system overview, fare flows (NFC card and QR), offline behaviour, account and key model, trust model. With diagrams.
- [`fare-collection-research-morelos.md`](./fare-collection-research-morelos.md): research, regulatory analysis and design of the fare collection system (August 2026), the basis of the Ruta 9 pilot.

## Evidence from the Ruta 9 pilot (30 August 2026, Stellar mainnet)

Four fares of 13 MXN settled on-chain with the closed-loop token MXNT, vehicle U-42, Temixco (Morelos):

- https://stellar.expert/explorer/public/tx/c0e47a8ba406f70e34653ab9aaa4e0fdfdd010899ba1077fef855312dd482e39
- https://stellar.expert/explorer/public/tx/e6481b5815be370d62abca4b4cff1a94b8b3668b2a7b57193c27edcb4268919a
- https://stellar.expert/explorer/public/tx/6abfc85f860f4145a479c8561ff950280994508fd79d1c4eac51b95d22e09469
- Token: https://stellar.expert/explorer/public/asset/MXNT-GAL45E3RPF2PY63JBQPPEFZLUNZY6X7B6CKL5IW7SERYH6YI2J5IZHE6
