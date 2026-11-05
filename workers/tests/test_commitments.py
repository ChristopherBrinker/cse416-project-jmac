"""Verify encoding, signer authorization, and crash-safe transaction reconciliation."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from eth_account import Account
from web3.exceptions import TransactionNotFound

from jmac_worker.commitments import (
    ChainConfig,
    CommitmentClient,
    output_digest,
    result_commitment,
    spec_hash,
)

# Public deterministic test key; never use this wallet for real funds.
KEY = "0x" + "01" * 32
ADDRESS = Account.from_key(KEY).address
CONTRACT = "0x" + "22" * 20
OTHER = "0x" + "33" * 20
SCORES = [True, False, True]
PREDICTIONS = [1, 0, 1]
CORRECT = 2
OUTPUT_KEY = bytes.fromhex("33" * 32)
SALT_22 = bytes.fromhex("22" * 32)
DIGEST = output_digest(OUTPUT_KEY, "job", PREDICTIONS)
SPEC = spec_hash("a" * 64, "model")


class EncodingTests(unittest.TestCase):
    # Same vectors as contracts/test/EvaluationSettlement.t.sol, cross-checked with
    # `cast abi-encode ... | cast keccak`.
    def commitment(self, correct=CORRECT, salt=SALT_22, items=3):
        return result_commitment(
            31337,
            "0x5FbDB2315678afecb367f032d93F642f64180aa3",
            "job1",
            "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
            bytes.fromhex("11" * 32),
            items,
            bytes.fromhex("44" * 32),
            correct,
            salt,
        )

    def test_matches_contract_and_cast_commitment_vector(self):
        self.assertEqual(
            self.commitment().hex(),
            "94ad75828f321d8d12966fe4a06da72ede443a49c008ef121b0d78d394230e48",
        )
        for correct in (-1, 4, True, None):
            with self.subTest(correct=correct), self.assertRaises(ValueError):
                self.commitment(correct=correct)
        for items in (0, -3, "3"):
            with self.subTest(items=items), self.assertRaises(ValueError):
                self.commitment(items=items)
        with self.assertRaises(ValueError):
            self.commitment(salt=b"short")

    def test_matches_contract_and_cast_output_digest_vector(self):
        self.assertEqual(
            output_digest(OUTPUT_KEY, "job1", PREDICTIONS).hex(),
            "be98b0fae94f54c5eb150fd42db717921e510f3a7b5f869cbc3ed808c1035898",
        )
        for predictions in ([], [1, -1], [True, 0], [1.0], "101", None):
            with self.subTest(predictions=predictions), self.assertRaises(ValueError):
                output_digest(OUTPUT_KEY, "job1", predictions)
        with self.assertRaises(ValueError):
            output_digest(b"short", "job1", PREDICTIONS)

    def test_digest_compares_ordered_predictions_not_accuracy(self):
        # answer key [1, 2, 1]: both of these score [True, False, True]
        other_wrong = output_digest(OUTPUT_KEY, "job", [1, 1, 1])
        self.assertNotEqual(DIGEST, other_wrong)
        # same accuracy (2 of 3) in a different order
        reordered = output_digest(OUTPUT_KEY, "job", [0, 2, 1])
        self.assertNotEqual(DIGEST, reordered)
        self.assertEqual(DIGEST, output_digest(OUTPUT_KEY, "job", list(PREDICTIONS)))

    def test_digest_is_keyed_and_scoped_to_the_job(self):
        self.assertNotEqual(
            DIGEST, output_digest(bytes.fromhex("44" * 32), "job", PREDICTIONS)
        )
        self.assertNotEqual(DIGEST, output_digest(OUTPUT_KEY, "job2", PREDICTIONS))

    def test_matches_contract_and_cast_spec_vector(self):
        self.assertEqual(
            spec_hash("0123456789abcdef" * 4, "model1").hex(),
            "051bd1fbac43750c77bbe2acd55022b45b4bf7a726ca55289f5021298470a342",
        )

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
                    "schema_version": "3.0.0",
                    "predictions": [1, 0, 1],
                    "item_ids": ["a", "b", "c"],
                    "choice_counts": [2, 2, 2],
                    "total": 3,
                    "correct": 2,
                    "accuracy": 2 / 3,
                    "benchmark": {
                        "name": "example",
                        "version": "1",
                        "content_hash": "a" * 64,
                        "output_key": OUTPUT_KEY.hex(),
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
            0,
            1000,
            SPEC,
            len(SCORES),
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

    def salt(self):
        saved = json.loads(self.path.with_suffix(".salt.json").read_bytes())
        return bytes.fromhex(saved["salt"])

    def commitment(self, address=ADDRESS, digest=DIGEST, correct=CORRECT):
        return result_commitment(
            31337, CONTRACT, "job", address, SPEC, 3, digest, correct, self.salt()
        )

    def save_salt(self):
        self.client._salt(
            self.path, json.loads(self.path.read_bytes())["assignment"], create=True
        )

    def test_signs_registered_wallet_and_persists_before_broadcast(self):
        journal_path = self.path.with_suffix(".commit.json")

        def send(raw):
            self.assertTrue(journal_path.exists())
            self.assertEqual(Account.recover_transaction(raw), ADDRESS)

        self.eth.send_raw_transaction.side_effect = send
        self.assertFalse(self.client.submit(self.path))
        self.functions.commitResult.assert_called_once_with("job", self.commitment())
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
        self.save_salt()
        self.provider[2] = self.commitment()
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
        self.save_salt()
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

    def test_changed_predictions_do_not_reuse_journal(self):
        self.client.submit(self.path)
        result = json.loads(self.path.read_bytes())
        result["predictions"] = [1, 1, 1]
        self.path.write_text(json.dumps(result))
        with self.assertRaisesRegex(ValueError, "identity"):
            self.client.submit(self.path)
        self.eth.send_raw_transaction.assert_called_once()

    def test_salt_is_secret_random_and_reused_after_restart(self):
        self.client.submit(self.path)
        salt = self.salt()
        self.assertEqual(len(salt), 32)
        self.assertNotEqual(salt, bytes(32))
        journal = json.loads(self.path.with_suffix(".commit.json").read_bytes())
        self.assertNotIn(salt.hex(), json.dumps(journal))
        restarted = CommitmentClient(self.config)
        restarted.web3 = self.client.web3
        restarted.contract = self.client.contract
        restarted.submit(self.path)
        self.assertEqual(self.salt(), salt)
        self.functions.commitResult.return_value.build_transaction.assert_called_once()

    def test_commitment_binds_this_provider(self):
        self.client.submit(self.path)
        self.assertNotEqual(self.commitment(), self.commitment(address=OTHER))

    def test_wrong_item_count_cannot_be_committed(self):
        self.job[9] = len(SCORES) + 1
        with self.assertRaisesRegex(ValueError, "item count"):
            self.client.submit(self.path)
        self.eth.send_raw_transaction.assert_not_called()
        self.assertFalse(self.path.with_suffix(".salt.json").exists())

    def test_wrong_spec_cannot_be_committed(self):
        self.job[8] = spec_hash("b" * 64, "model")
        with self.assertRaisesRegex(ValueError, "spec"):
            self.client.submit(self.path)
        self.eth.send_raw_transaction.assert_not_called()

    def test_missing_salt_for_existing_commit_is_an_error(self):
        self.provider[2] = bytes.fromhex("01" * 32)
        with self.assertRaisesRegex(ValueError, "salt"):
            self.client.submit(self.path)

    def test_commit_and_journal_never_contain_predictions_or_key(self):
        self.client.submit(self.path)
        committed = self.functions.commitResult.call_args.args
        self.assertEqual(committed, ("job", self.commitment()))
        journal = self.path.with_suffix(".commit.json").read_text()
        self.assertNotIn(OUTPUT_KEY.hex(), journal)
        self.assertNotIn("predictions", journal)

    def test_commitment_without_output_key_is_invalid(self):
        result = json.loads(self.path.read_bytes())
        del result["benchmark"]["output_key"]
        self.path.write_text(json.dumps(result))
        with self.assertRaisesRegex(ValueError, "invalid"):
            self.client.submit(self.path)

    def test_truncated_scores_cannot_be_committed(self):
        result = json.loads(self.path.read_bytes())
        result["scores"] = [True]
        self.path.write_text(json.dumps(result))
        with self.assertRaisesRegex(ValueError, "invalid"):
            self.client.submit(self.path)
        self.eth.send_raw_transaction.assert_not_called()


class SettlementTests(unittest.TestCase):
    salt = TransactionTests.salt
    commitment = TransactionTests.commitment
    save_salt = TransactionTests.save_salt

    def setUp(self):
        TransactionTests.setUp(self)
        self.provider.extend([False, False])
        self.job[4].extend([False, False])
        self.save_salt()
        self.provider[2] = self.commitment()
        self.job[4][2] = self.commitment(address=OTHER)
        self.eth.get_block.return_value = {
            "number": 10,
            "timestamp": 900,
            "hash": bytes.fromhex("ab" * 32),
        }
        self.functions.REVEAL_WINDOW.return_value.call.return_value = 900
        self.events = self.client.contract.events
        self.events.CommitComplete.return_value.get_logs.return_value = []
        self.events.JobComplete.return_value.get_logs.return_value = []
        build = self.functions.commitResult.return_value.build_transaction.side_effect
        self.functions.revealResult.return_value.build_transaction.side_effect = build
        self.functions.claimPayment.return_value.build_transaction.side_effect = build

    def emit(self, name, job_id="job"):
        getattr(self.events, name).return_value.get_logs.return_value = [
            {"args": {"jobId": job_id}}
        ]

    def save_historical_specification(self, **overrides):
        from jmac_worker.specification import supported_settings

        document = json.loads(self.path.read_bytes())
        spec = {
            **supported_settings(),
            "worker_sha256": "0" * 64,
            "benchmark_id": "benchmark",
            "benchmark_version": "1",
            "benchmark_sha256": "a" * 64,
            "item_count": 3,
            "commit_deadline": 1000,
            "reveal_deadline": 1900,
            "chain_id": 31337,
            "contract_address": CONTRACT,
            **overrides,
        }
        document["assignment"]["specification"] = json.dumps(spec)
        self.path.write_text(json.dumps(document))

    def test_historical_artifact_can_reveal_after_upgrade(self):
        self.save_historical_specification()
        self.emit("CommitComplete")
        self.client.settle(self.path)
        self.functions.revealResult.assert_called_once_with(
            "job", DIGEST, CORRECT, self.salt()
        )
        self.assertTrue(self.path.with_suffix(".reveal.json").exists())

    def test_historical_artifact_can_claim_after_upgrade(self):
        self.save_historical_specification()
        self.job[6] = 1
        self.provider[5] = True
        self.emit("JobComplete")
        self.client.settle(self.path)
        self.functions.claimPayment.assert_called_once_with("job")
        self.assertTrue(self.path.with_suffix(".claim.json").exists())

    def test_historical_specification_still_enforces_chain_and_contract(self):
        for overrides in ({"chain_id": 1}, {"contract_address": OTHER}):
            with self.subTest(overrides=overrides):
                self.save_historical_specification(**overrides)
                with self.assertRaisesRegex(ValueError, "chain identity mismatch"):
                    self.client.settle(self.path)
        self.eth.send_raw_transaction.assert_not_called()

    def test_both_commits_without_event_do_not_reveal(self):
        self.assertFalse(self.client.advance(self.path))
        self.functions.revealResult.assert_not_called()
        self.eth.send_raw_transaction.assert_not_called()

    def test_commit_complete_reveals_exact_saved_result(self):
        self.emit("CommitComplete")
        self.assertFalse(self.client.advance(self.path))
        self.functions.revealResult.assert_called_once_with(
            "job", DIGEST, CORRECT, self.salt()
        )
        self.assertTrue(self.path.with_suffix(".reveal.json").exists())
        self.functions.claimPayment.assert_not_called()

    def test_other_jobs_events_do_not_trigger_reveal(self):
        self.emit("CommitComplete", "another-job")
        self.client.advance(self.path)
        self.functions.revealResult.assert_not_called()

    def test_complete_state_without_job_complete_event_does_not_claim(self):
        self.job[6] = 1
        self.provider[5] = True
        self.client.advance(self.path)
        self.functions.claimPayment.assert_not_called()

    def test_job_complete_claims_only_once_and_uses_own_journal(self):
        self.job[6] = 1
        self.provider[5] = True
        self.emit("JobComplete")
        self.client.advance(self.path)
        self.functions.claimPayment.assert_called_once_with("job")
        self.assertTrue(self.path.with_suffix(".claim.json").exists())
        self.provider[6] = True
        self.assertTrue(self.client.advance(self.path))
        self.functions.claimPayment.assert_called_once()

    def test_repeated_event_reconciles_pending_reveal_without_new_signature(self):
        self.emit("CommitComplete")
        self.client.advance(self.path)
        self.eth.get_transaction.side_effect = None
        self.eth.get_transaction.return_value = {"pending": True}
        restarted = CommitmentClient(self.config)
        restarted.web3 = self.client.web3
        restarted.contract = self.client.contract
        restarted.advance(self.path)
        self.functions.revealResult.return_value.build_transaction.assert_called_once()
        self.eth.send_raw_transaction.assert_called_once()

    def test_dropped_reveal_rebroadcasts_identical_signed_transaction(self):
        self.emit("CommitComplete")
        self.client.advance(self.path)
        raw = self.eth.send_raw_transaction.call_args.args[0]
        self.client.advance(self.path)
        self.assertEqual(self.eth.send_raw_transaction.call_args.args[0], raw)
        self.functions.revealResult.return_value.build_transaction.assert_called_once()

    def test_recovered_job_can_claim_after_assignment_removed(self):
        self.job[6] = 1
        self.provider[5] = True
        self.emit("JobComplete")
        self.client.settle(self.path)
        self.functions.claimPayment.assert_called_once_with("job")

    def test_recovered_uncommitted_result_does_not_start_commit(self):
        self.provider[2] = bytes(32)
        self.assertFalse(self.client.settle(self.path))
        self.functions.commitResult.assert_not_called()
        self.eth.send_raw_transaction.assert_not_called()

    def test_failed_and_refunded_jobs_never_claim(self):
        for status in (2, 3):
            self.job[6] = status
            self.assertTrue(self.client.advance(self.path))
        self.functions.claimPayment.assert_not_called()
        self.functions.revealResult.assert_not_called()

    def test_expired_reveal_never_broadcasts(self):
        self.eth.get_block.return_value["timestamp"] = 1901
        self.emit("CommitComplete")
        self.assertTrue(self.client.advance(self.path))
        self.functions.revealResult.assert_not_called()

    def test_reorg_discards_old_event_checkpoint(self):
        self.emit("CommitComplete")
        self.client.advance(self.path)
        self.functions.revealResult.reset_mock()
        self.eth.get_block.return_value["hash"] = bytes.fromhex("cd" * 32)
        self.events.CommitComplete.return_value.get_logs.return_value = []
        self.client.advance(self.path)
        self.functions.revealResult.assert_not_called()

    def test_event_backfill_is_bounded(self):
        self.eth.get_block.return_value["number"] = 5000
        self.client.advance(self.path)
        self.events.CommitComplete.return_value.get_logs.assert_called_with(
            from_block=0, to_block=1999, argument_filters={"jobId": "job"}
        )
        self.client.advance(self.path)
        self.events.CommitComplete.return_value.get_logs.assert_called_with(
            from_block=2000, to_block=3999, argument_filters={"jobId": "job"}
        )

    def test_event_backfill_starts_at_mined_commit(self):
        self.provider[2] = bytes(32)
        self.client.submit(self.path)
        self.provider[2] = self.commitment()
        self.eth.get_block.return_value["number"] = 10000
        self.eth.get_transaction_receipt.side_effect = None
        self.eth.get_transaction_receipt.return_value = {
            "status": 1,
            "blockNumber": 9000,
        }
        self.client.advance(self.path)
        self.events.CommitComplete.return_value.get_logs.assert_called_with(
            from_block=9000, to_block=10000, argument_filters={"jobId": "job"}
        )

    def test_reorg_during_scan_does_not_persist_or_reveal(self):
        self.emit("CommitComplete")
        original = self.eth.get_block.return_value
        replacement = {**original, "hash": bytes.fromhex("cd" * 32)}
        self.eth.get_block.side_effect = [original, original, replacement]
        self.client.advance(self.path)
        self.functions.revealResult.assert_not_called()
        self.assertFalse(self.path.with_suffix(".events.json").exists())

    def test_other_job_cannot_reuse_journaled_reveal_nonce(self):
        self.emit("CommitComplete")
        self.client.advance(self.path)
        old_raw = self.eth.send_raw_transaction.call_args.args[0]
        document = json.loads(self.path.read_bytes())
        document["assignment"]["job_id"] = "next-job"
        next_path = self.path.with_name("next.json")
        next_path.write_text(json.dumps(document))
        self.provider[2] = bytes(32)
        self.client.submit(next_path)
        self.functions.commitResult.return_value.build_transaction.assert_not_called()
        self.assertEqual(self.eth.send_raw_transaction.call_args.args[0], old_raw)
        self.assertFalse(next_path.with_suffix(".commit.json").exists())

    def test_removed_assignment_rebroadcasts_existing_commit_journal(self):
        self.provider[2] = bytes(32)
        self.client.submit(self.path)
        raw = self.eth.send_raw_transaction.call_args.args[0]
        self.client.settle(self.path)
        self.assertEqual(self.eth.send_raw_transaction.call_args.args[0], raw)
        self.functions.commitResult.return_value.build_transaction.assert_called_once()
        self.assertEqual(self.eth.send_raw_transaction.call_count, 2)
