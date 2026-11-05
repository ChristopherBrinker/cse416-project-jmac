# Settlement acceptance evidence

Chain 31337, contract `0x5FbDB2315678afecb367f032d93F642f64180aa3`, backend `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, creator `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`, provider A `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`, provider B `0x90F79bf6EB2c4f870365E785982E1f101E93b906`. Price 1000001 wei, 3 items, spec `0x831c1f4ae32818a75a55e189f09737189e7cf386beed356bb850b486b008baa5`.

## 1. Matching results are accepted and paid

| Step | Transaction / result |
| --- | --- |
| fundJob | `0x2dcc48e501883843094a7140afddf86efca2a8b0f75683c7466c38a15b8dd731` |
| assignProviders | `0x30c634f6a208e54d4e41ea1b150b15f496b8d7ccbe5a522cacb87077807e8b29` |
| commit A | `0x655d2979abdb7b02729f2cff67e385c7f7939794093d3fc830fab6178f2c09f8` |
| commit B | `0x7160b84b73a754586bb3f0a6786f787add08641abe5ebb6ff73ab756a8fe865b` |
| reveal A | `0x6097de24f667788c99580fdd95621bf071c1581bd84784b8bf6071a32f8aa6cf` |
| reveal B | `0x9d76e5f2681a9d279db5df95e4c566fdbbdc17b3f4d8fb6c6b89da61964e452a` |
| claim A | `0xdd342d1619429e222fc9b7326f03e61924e99eb14e8b11f76e114437bc9c68d7` |
| claim B | `0x1e4394d55a133209f60b53555df0f7db3df5247d12fc5f2657fbcb703ed8e8ff` |
| claim A again | reverted: Already claimed |
| refund completed job | reverted: Job not refundable |
| reveal A again | reverted: Already revealed |

Status Complete. Accepted digest `0x3826528d73cc18491a8a814b91cf328574faccda4a928a4a2beb434ee4a880e1` with a provider-claimed score of 2/3 (no answer key is involved; the contract only checks that the count does not exceed the item count). Contract transfers (balance change plus the claimant's own gas): A 500000 wei, B 500001 wei (B takes the odd wei). Each account's balance rose by its transfer minus claim gas. Contract balance 0 wei.

## 2. Disagreement (same claimed 2/3 score, different order) refunds the creator

| Step | Transaction / result |
| --- | --- |
| fundJob | `0x369be11eda04db326b04a0f6c390dafbd8ba063859d741e574f74944225224d8` |
| assignProviders | `0x6e3275965be6456215a0b854f45b883d23a070381933d8246b1b522b552f540d` |
| commit A | `0x4ea292cb4f8dc33fc6d3cd328dcb2ac95f77c34bcf4ca2e5caafd5a6425fa481` |
| commit B | `0x8d94174a1c9bc0a0b4da77826230346d01c43c8cef5c4c79a36935f6b1262927` |
| reveal A | `0x76ca3f2d166687dc4ef8db0a6d1d5b21f5dd8100c0440b5ead3932443821d508` |
| reveal B | `0x2edb7d8ccba97d4c1abf16bb7affa435e4b82c867da85a16360d7432f89e1e36` |
| claim A | reverted: Job not complete |
| refund | `0xb4ec68b129e565e74b8ab7a9428877b0f003e83080140f26223a2586e1d3ac9b` |
| refund again | reverted: Job not refundable |
| claim B after refund | reverted: Job not complete |

Status Refunded. Refund transfer 1000001 wei (balance change plus refund gas); no provider was paid.

## 3. Missing provider: refund after the commit deadline

| Step | Transaction / result |
| --- | --- |
| fundJob | `0xecfc6fb08edbcc723ca9568e869068468d1588ee7f21e206b473c5f0caef36d1` |
| assignProviders | `0x41bba483c0e40148bd8cc9a0da731e688ab41ff95591eb913f03ab07cbcbcb80` |
| commit A | `0x5cdeab3d8988618b1bd032157210437a6a77313429da6a755e807fd859db058e` |
| refund before deadline | reverted: Job not refundable |
| advance time 301 s | commit window closed |
| late commit B | reverted: Commit deadline passed |
| refund | `0xf5563fdad176fbb6c61e26ed32ed933ddad4189b358e5df5662d5596869d2ad5` |
| refund again | reverted: Job not refundable |
| claim A | reverted: Job not complete |

Status Refunded. Refund transfer 1000001 wei (balance change plus refund gas); provider A was not paid.

All scenarios passed; the contract holds 0 wei.
