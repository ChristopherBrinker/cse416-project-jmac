"""Verify encoding, signer authorization, and crash-safe transaction reconciliation."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from eth_account import Account
from web3.exceptions import TransactionNotFound

from jmac_worker.commitments import ChainConfig, CommitmentClient, score_commitment

# Public deterministic test key; never use this wallet for real funds.
KEY = "0x" + "01" * 32
ADDRESS = Account.from_key(KEY).address
CONTRACT = "0x" + "22" * 20
OTHER = "0x" + "33" * 20
SCORES = [True, False, True]


class EncodingTests(unittest.TestCase):
    def test_matches_independent_viem_abi_encoding_vector(self):
        self.assertEqual(
            score_commitment(SCORES).hex(),
            "82adde6ab39febe48ad5f5f17de582c728211b545b1e17ad56bf2bb040e7dc7e",
        )
        for scores in ([], [1, 0], [True, "false"], None):
            with self.subTest(scores=scores), self.assertRaises(ValueError):
                score_commitment(scores)

    def test_configuration_keeps_credentials_out_of_repr(self):
        config = ChainConfig(
            "https://example.com/private-api-token", 31337, CONTRACT, ADDRESS, KEY
        )
        self.assertNotIn(KEY, repr(config))
        self.assertNotIn("private-api-token", repr(config))
        with self.assertRaisesRegex(ValueError, "does not control"):
            CommitmentClient(
                ChainConfig("http://localhost:8545", 31337, CONTRACT, OTHER, KEY)
            )


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "result.json"
        self.path.write_text(
            json.dumps(
                {
                    "assignment": {
                        "job_id": "job",
                        "provider_id": "provider",
                        "model_id": "model",
                    },
                    "scores": SCORES,
                    "schema_version": "2.0.0",
                    "predictions": [1, 0, 1],
                    "item_ids": ["a", "b", "c"],
                    "total": 3,
                    "correct": 2,
                    "accuracy": 2 / 3,
                    "benchmark": {
                        "name": "example",
                        "version": "1",
                        "content_hash": "a" * 64,
                    },
                    "inference": {"revision": "pinned"},
                }
            )
        )
        self.config = ChainConfig(
            "http://localhost:8545", 31337, CONTRACT, ADDRESS, KEY
        )
        self.client = CommitmentClient(self.config)
        self.client.web3 = Mock()
        self.eth = self.client.web3.eth
        self.eth.chain_id = 31337
        self.eth.get_code.return_value = b"contract"
        self.eth.get_transaction_count.return_value = 7
        self.eth.get_transaction_receipt.side_effect = TransactionNotFound("not found")
        self.eth.get_transaction.side_effect = TransactionNotFound("not found")
        self.functions = Mock()
        self.client.contract = Mock(functions=self.functions)
        self.provider = [ADDRESS, "provider", bytes(32), [], True]
        self.job = [
            OTHER,
            "job",
            2500,
            self.provider,
            [OTHER, "other-provider", bytes(32), [], True],
            True,
        ]
        self.functions.jobs.return_value.call.return_value = self.job
        self.functions.commitResult.return_value.build_transaction.side_effect = (
            lambda args: {
                **args,
                "to": CONTRACT,
                "gas": 150000,
                "gasPrice": 1,
                "data": "0x",
            }
        )

    def test_signs_registered_wallet_and_persists_before_broadcast(self):
        journal_path = self.path.with_suffix(".commit.json")

        def send(raw):
            self.assertTrue(journal_path.exists())
            self.assertEqual(Account.recover_transaction(raw), ADDRESS)

        self.eth.send_raw_transaction.side_effect = send
        self.assertFalse(self.client.submit(self.path))
        self.functions.commitResult.assert_called_once_with(
            "job", score_commitment(SCORES)
        )
        journal = json.loads(journal_path.read_bytes())
        self.assertNotIn(KEY, json.dumps(journal))
        self.assertEqual(journal["identity"]["chain_id"], 31337)

    def test_restart_rebroadcasts_identical_transaction_after_lost_response(self):
        self.eth.send_raw_transaction.side_effect = TimeoutError("private RPC details")
        with self.assertRaises(TimeoutError):
            self.client.submit(self.path)
        raw = self.eth.send_raw_transaction.call_args.args[0]
        self.eth.send_raw_transaction.side_effect = None
        self.assertFalse(self.client.submit(self.path))
        self.assertEqual(self.eth.send_raw_transaction.call_args.args[0], raw)
        self.functions.commitResult.return_value.build_transaction.assert_called_once()

    def test_pending_transaction_is_not_broadcast_again(self):
        self.client.submit(self.path)
        self.eth.get_transaction.side_effect = None
        self.eth.get_transaction.return_value = {"pending": True}
        self.assertFalse(self.client.submit(self.path))
        self.eth.send_raw_transaction.assert_called_once()

    def test_existing_matching_commit_is_success_without_transaction(self):
        self.provider[2] = score_commitment(SCORES)
        self.assertTrue(self.client.submit(self.path))
        self.eth.send_raw_transaction.assert_not_called()

    def test_waits_for_onchain_assignment(self):
        self.provider[4] = False
        self.assertFalse(self.client.submit(self.path))
        self.functions.commitResult.assert_not_called()

    def test_wrong_provider_and_conflicting_commit_cannot_submit(self):
        self.provider[1] = "different-provider"
        with self.assertRaisesRegex(ValueError, "provider"):
            self.client.submit(self.path)
        self.provider[1] = "provider"
        self.provider[2] = bytes.fromhex("01" * 32)
        with self.assertRaisesRegex(ValueError, "conflicts"):
            self.client.submit(self.path)
        self.eth.send_raw_transaction.assert_not_called()

    def test_wrong_chain_and_missing_contract_cannot_submit(self):
        self.eth.chain_id = 1
        with self.assertRaisesRegex(ValueError, "chain ID"):
            self.client.submit(self.path)
        self.eth.chain_id = 31337
        self.eth.get_code.return_value = b""
        with self.assertRaisesRegex(ValueError, "No contract"):
            self.client.submit(self.path)
        self.eth.send_raw_transaction.assert_not_called()

    def test_reverted_receipt_does_not_build_replacement(self):
        self.client.submit(self.path)
        self.eth.get_transaction_receipt.side_effect = None
        self.eth.get_transaction_receipt.return_value = {"status": 0}
        with self.assertRaisesRegex(ValueError, "reverted"):
            self.client.submit(self.path)
        self.functions.commitResult.return_value.build_transaction.assert_called_once()

    def test_changed_scores_do_not_reuse_journal(self):
        self.client.submit(self.path)
        result = json.loads(self.path.read_bytes())
        result["scores"] = [False, False, True]
        result["correct"] = 1
        result["accuracy"] = 1 / 3
        self.path.write_text(json.dumps(result))
        with self.assertRaisesRegex(ValueError, "identity"):
            self.client.submit(self.path)
        self.eth.send_raw_transaction.assert_called_once()

    def test_truncated_scores_cannot_be_committed(self):
        result = json.loads(self.path.read_bytes())
        result["scores"] = [True]
        self.path.write_text(json.dumps(result))
        with self.assertRaisesRegex(ValueError, "invalid"):
            self.client.submit(self.path)
        self.eth.send_raw_transaction.assert_not_called()
