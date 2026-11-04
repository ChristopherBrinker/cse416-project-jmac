"""Sign result commitments and reconcile durable transactions before resubmission."""

import json
import secrets
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from .output import atomic_output
from .provider_api import validate_deployment_url
from .scoring import is_valid_saved_evaluation

# v3: commit to a keyed digest of ordered predictions plus the correct count (docs/m4).
ENCODING = "keccak256-abi-bound-salted-output-digest-v3"
ZERO_COMMIT = bytes(32)
EVENT_BLOCK_RANGE = 2000
OPEN = 0
COMPLETE = 1
FAILED = 2
REFUNDED = 3
# Positions in the contract's jobs() tuple, which only ever appends fields.
JOB_SPEC_HASH = 8
JOB_ITEM_COUNT = 9


@dataclass(frozen=True)
class ChainConfig:
    rpc_url: str = field(repr=False)
    chain_id: int
    contract_address: str
    wallet_address: str
    private_key: str = field(repr=False)

    def __post_init__(self) -> None:
        # Reuse HTTPS/loopback and credential-free origin checks for this endpoint.
        parsed = urlsplit(self.rpc_url)
        if (
            parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
        ):
            raise ValueError("Invalid JMAC_RPC_URL")
        validate_deployment_url(
            urlunsplit((parsed.scheme, parsed.netloc, "", "", "")), http_actions=True
        )
        if self.chain_id <= 0:
            raise ValueError("JMAC_CHAIN_ID must be a positive integer")


def chain_config_from_environment(environment: Mapping[str, str]) -> ChainConfig:
    names = (
        "JMAC_RPC_URL",
        "JMAC_CHAIN_ID",
        "JMAC_CONTRACT_ADDRESS",
        "JMAC_WALLET_ADDRESS",
        "JMAC_WALLET_PRIVATE_KEY",
    )
    for name in names:
        if not environment.get(name):
            raise ValueError(f"Set {name} before enabling contract commitments")
    try:
        chain_id = int(environment["JMAC_CHAIN_ID"])
    except ValueError:
        raise ValueError("JMAC_CHAIN_ID must be a positive integer") from None
    return ChainConfig(
        environment[names[0]],
        chain_id,
        environment[names[2]],
        environment[names[3]],
        environment[names[4]],
    )


def spec_hash(content_hash: str, model_id: str) -> bytes:
    """Identify the evaluated benchmark file and model, as the scheduler records on-chain."""
    from eth_abi import encode
    from web3 import Web3

    return bytes(Web3.keccak(encode(["string", "string"], [content_hash, model_id])))


def output_digest(key: bytes, job_id: str, predictions: object) -> bytes:
    """Identify the ordered predicted choice indices without publishing them.

    Both honest providers derive the same key from the benchmark bytes, so equal digests mean
    equal ordered predictions. Without the benchmark, nobody can enumerate predictions.
    """
    from eth_abi import encode
    from web3 import Web3

    if (
        not isinstance(predictions, list)
        or not predictions
        or any(type(index) is not int or index < 0 for index in predictions)
    ):
        raise ValueError("Output digest requires nonempty ordered choice indices")
    if len(key) != 32:
        raise ValueError("Output digest key must be 32 bytes")
    return bytes(
        Web3.keccak(
            encode(["bytes32", "string", "uint256[]"], [key, job_id, predictions])
        )
    )


def result_commitment(
    chain_id: int,
    contract_address: str,
    job_id: str,
    provider_address: str,
    spec: bytes,
    item_count: int,
    digest: bytes,
    correct_count: int,
    salt: bytes,
) -> bytes:
    """Match Evaluation.resultCommitment: bind the result to chain, contract, job, provider, spec."""
    from eth_abi import encode
    from web3 import Web3

    if len(spec) != 32 or len(digest) != 32 or len(salt) != 32:
        raise ValueError("Commitment spec, digest and salt must be 32 bytes")
    if type(item_count) is not int or item_count <= 0:
        raise ValueError("Commitment requires a positive item count")
    if type(correct_count) is not int or not 0 <= correct_count <= item_count:
        raise ValueError("Commitment correct count must be within the item count")
    types = [
        "uint256",
        "address",
        "string",
        "address",
        "bytes32",
        "uint256",
        "bytes32",
        "uint256",
        "bytes32",
    ]
    values = [
        chain_id,
        contract_address,
        job_id,
        provider_address,
        spec,
        item_count,
        digest,
        correct_count,
        salt,
    ]
    return bytes(Web3.keccak(encode(types, values)))


class CommitmentClient:
    def __init__(self, config: ChainConfig) -> None:
        try:
            from web3 import Web3
        except ImportError:
            raise ValueError(
                "Install the worker chain extra to submit commitments"
            ) from None
        self.config = config
        try:
            self.account = Web3().eth.account.from_key(config.private_key)
            self.address = Web3.to_checksum_address(config.wallet_address)
            self.contract_address = Web3.to_checksum_address(config.contract_address)
        except Exception:
            raise ValueError(
                "Invalid worker signer or contract configuration"
            ) from None
        if self.account.address != self.address:
            raise ValueError("Worker signer does not control JMAC_WALLET_ADDRESS")
        self.web3 = Web3(
            Web3.HTTPProvider(config.rpc_url, request_kwargs={"timeout": 10})
        )
        abi = json.loads(Path(__file__).with_name("evaluation_abi.json").read_text())
        self.contract = self.web3.eth.contract(address=self.contract_address, abi=abi)

    def submit(self, result_path: Path) -> bool:
        """Return false while assignment/mining is pending; never rebuild an ambiguous tx."""
        if self.web3.eth.chain_id != self.config.chain_id:
            raise ValueError("RPC chain ID does not match JMAC_CHAIN_ID")
        if not self.web3.eth.get_code(self.contract_address):
            raise ValueError("No contract deployed at JMAC_CONTRACT_ADDRESS")
        result = json.loads(result_path.read_bytes())
        if not is_valid_saved_evaluation(result):
            raise ValueError(
                "Saved assignment result is invalid; inspect the results directory"
            )
        assignment = result["assignment"]
        job = self.contract.functions.jobs(assignment["job_id"]).call()
        if not job[5] or not job[3][4] or not job[4][4]:
            return False
        provider = next(
            (p for p in (job[3], job[4]) if p[0].lower() == self.address.lower()), None
        )
        if provider is None or provider[1] != assignment["provider_id"]:
            raise ValueError(
                "Registered on-chain provider does not match worker signer"
            )
        committed = bytes(provider[2]) != ZERO_COMMIT
        digest = self._commitment(result_path, result, job, create_salt=not committed)
        if committed:
            if bytes(provider[2]) != digest:
                raise ValueError("On-chain commitment conflicts with saved result")
            return True

        return self._transact(
            result_path,
            result,
            "commit",
            self.contract.functions.commitResult(assignment["job_id"], digest),
            digest,
        )

    def _commitment(
        self, result_path: Path, result: dict, job: list, *, create_salt: bool
    ) -> bytes:
        """Refuse to commit to a spec or length the worker did not evaluate."""
        assignment = result["assignment"]
        spec = bytes(job[JOB_SPEC_HASH])
        if job[JOB_ITEM_COUNT] != len(result["predictions"]):
            raise ValueError("Saved result does not match the on-chain item count")
        expected = spec_hash(
            result["benchmark"]["content_hash"], assignment["model_id"]
        )
        if spec != expected:
            raise ValueError(
                "On-chain evaluation spec does not match the evaluated benchmark and model"
            )
        return result_commitment(
            self.config.chain_id,
            self.contract_address,
            assignment["job_id"],
            self.address,
            spec,
            job[JOB_ITEM_COUNT],
            self._output_digest(result),
            result["correct"],
            self._salt(result_path, assignment, create=create_salt),
        )

    @staticmethod
    def _output_digest(result: dict) -> bytes:
        return output_digest(
            bytes.fromhex(result["benchmark"]["output_key"]),
            result["assignment"]["job_id"],
            result["predictions"],
        )

    def _salt(self, result_path: Path, assignment: dict, *, create: bool) -> bytes:
        """Keep one secret salt per result; it must survive restarts until the reveal."""
        path = result_path.with_suffix(".salt.json")
        identity = {
            "chain_id": self.config.chain_id,
            "contract_address": self.contract_address,
            "wallet_address": self.address,
            "job_id": assignment["job_id"],
            "provider_id": assignment["provider_id"],
        }
        if path.exists():
            saved = json.loads(path.read_bytes())
            if saved.get("identity") != identity:
                raise ValueError("Saved commitment salt belongs to another assignment")
            salt = bytes.fromhex(saved["salt"])
            if len(salt) != 32:
                raise ValueError("Saved commitment salt is invalid")
            return salt
        if not create:
            raise ValueError(
                "Missing commitment salt; the commitment cannot be revealed"
            )
        salt = secrets.token_bytes(32)
        # Persist before the commitment is signed, so a crash cannot strand a commit.
        with atomic_output(path) as output:
            output.write(json.dumps({"identity": identity, "salt": salt.hex()}) + "\n")
        return salt

    def _transact(
        self,
        result_path: Path,
        result: dict[str, object],
        phase: str,
        function,
        digest: bytes,
    ) -> bool:
        from eth_account import Account
        from web3 import Web3
        from web3.exceptions import TransactionNotFound

        assignment = result["assignment"]
        journal_path = result_path.with_suffix(f".{phase}.json")
        identity = {
            "chain_id": self.config.chain_id,
            "contract_address": self.contract_address,
            "wallet_address": self.address,
            "job_id": assignment["job_id"],
            "provider_id": assignment["provider_id"],
            "commitment": Web3.to_hex(digest),
            "encoding": ENCODING,
        }
        if phase != "commit":
            identity["phase"] = phase
        if journal_path.exists():
            journal = json.loads(journal_path.read_bytes())
            if journal.get("identity") != identity:
                raise ValueError(
                    "Saved transaction identity does not match this commitment"
                )
            raw = bytes.fromhex(journal["raw_transaction"])
            if Account.recover_transaction(raw) != self.address:
                raise ValueError("Saved transaction was signed by a different wallet")
            if Web3.to_hex(Web3.keccak(raw)) != journal["transaction_hash"]:
                raise ValueError("Saved transaction hash does not match signed bytes")
        else:
            if not self._reconcile_pending_transactions(result_path.parent):
                return False
            transaction = function.build_transaction(
                {
                    "from": self.address,
                    "chainId": self.config.chain_id,
                    "nonce": self.web3.eth.get_transaction_count(
                        self.address, "pending"
                    ),
                }
            )
            signed = self.account.sign_transaction(transaction)
            raw = bytes(signed.raw_transaction)
            journal = {
                "identity": identity,
                "transaction_hash": Web3.to_hex(Web3.keccak(raw)),
                "raw_transaction": raw.hex(),
            }
            # Persist before broadcast, so a crash/lost response can only rebroadcast
            # exactly the same signed transaction, never spend a second nonce.
            with atomic_output(journal_path) as output:
                output.write(json.dumps(journal, indent=2) + "\n")
        try:
            receipt = self.web3.eth.get_transaction_receipt(journal["transaction_hash"])
        except TransactionNotFound:
            try:
                self.web3.eth.get_transaction(journal["transaction_hash"])
            except TransactionNotFound:
                self.web3.eth.send_raw_transaction(raw)
            return False
        if receipt["status"] != 1:
            raise ValueError(
                f"{phase.capitalize()} transaction reverted; inspect its journal before retrying"
            )
        # Confirm contract state on the next pass rather than equating a receipt
        # alone with successful settlement.
        return False

    def _reconcile_pending_transactions(self, directory: Path) -> bool:
        """Recover reserved nonces before signing any new transaction for this wallet."""
        from eth_account import Account
        from web3 import Web3
        from web3.exceptions import TransactionNotFound

        for phase in ("commit", "reveal", "claim"):
            for path in sorted(directory.glob(f"*.{phase}.json")):
                journal = json.loads(path.read_bytes())
                identity = journal["identity"]
                if (
                    identity.get("chain_id"),
                    identity.get("contract_address"),
                    identity.get("wallet_address"),
                ) != (self.config.chain_id, self.contract_address, self.address):
                    continue
                raw = bytes.fromhex(journal["raw_transaction"])
                if (
                    Account.recover_transaction(raw) != self.address
                    or Web3.to_hex(Web3.keccak(raw)) != journal["transaction_hash"]
                ):
                    raise ValueError("Invalid pending transaction journal")
                try:
                    receipt = self.web3.eth.get_transaction_receipt(
                        journal["transaction_hash"]
                    )
                except TransactionNotFound:
                    try:
                        self.web3.eth.get_transaction(journal["transaction_hash"])
                    except TransactionNotFound:
                        self.web3.eth.send_raw_transaction(raw)
                    return False
                if receipt["status"] != 1:
                    raise ValueError(
                        "An earlier journaled transaction reverted; inspect its journal"
                    )
        return True

    def advance(self, result_path: Path) -> bool:
        """Commit active work, then reveal/claim only after observing the job's events."""
        return self._settle(result_path, allow_commit=True)

    def settle(self, result_path: Path) -> bool:
        """Recover settlement after backend assignment removal; never start a new commit."""
        return self._settle(result_path, allow_commit=False)

    def _settle(self, result_path: Path, *, allow_commit: bool) -> bool:
        if self.web3.eth.chain_id != self.config.chain_id:
            raise ValueError("RPC chain ID does not match JMAC_CHAIN_ID")
        if not self.web3.eth.get_code(self.contract_address):
            raise ValueError("No contract deployed at JMAC_CONTRACT_ADDRESS")
        result = json.loads(result_path.read_bytes())
        if not is_valid_saved_evaluation(result):
            raise ValueError("Saved assignment result is invalid")
        assignment = result["assignment"]
        block = self.web3.eth.get_block("latest")
        job = self.contract.functions.jobs(assignment["job_id"]).call(
            block_identifier=block["number"]
        )
        if not job[5] or not job[3][4] or not job[4][4]:
            return False
        provider = next(
            (p for p in (job[3], job[4]) if p[0].lower() == self.address.lower()), None
        )
        if provider is None or provider[1] != assignment["provider_id"]:
            raise ValueError(
                "Registered on-chain provider does not match worker signer"
            )
        if job[6] in (FAILED, REFUNDED) or provider[6]:
            return True
        if bytes(provider[2]) == ZERO_COMMIT:
            if block["timestamp"] > job[7]:
                return True
            if (
                not allow_commit
                and not result_path.with_suffix(".commit.json").exists()
            ):
                return False
            self.submit(result_path)
            return False
        digest = self._commitment(result_path, result, job, create_salt=False)
        if bytes(provider[2]) != digest:
            raise ValueError("On-chain commitment conflicts with saved result")
        events = self._job_events(result_path, assignment["job_id"], block["number"])
        if job[6] == COMPLETE:
            if events["JobComplete"] and provider[5]:
                self._transact(
                    result_path,
                    result,
                    "claim",
                    self.contract.functions.claimPayment(assignment["job_id"]),
                    digest,
                )
            return False
        if job[6] != OPEN:
            return False
        reveal_window = self.contract.functions.REVEAL_WINDOW().call()
        if block["timestamp"] > job[7] + reveal_window:
            return True
        if provider[5]:
            return False
        both_committed = all(bytes(p[2]) != ZERO_COMMIT for p in (job[3], job[4]))
        if events["CommitComplete"] and both_committed:
            self._transact(
                result_path,
                result,
                "reveal",
                self.contract.functions.revealResult(
                    assignment["job_id"],
                    self._output_digest(result),
                    result["correct"],
                    self._salt(result_path, assignment, create=False),
                ),
                digest,
            )
        return False

    def _first_event_block(self, result_path: Path, job_id: str) -> int:
        from web3.exceptions import TransactionNotFound

        path = result_path.with_suffix(".commit.json")
        if not path.exists():
            return 0
        journal = json.loads(path.read_bytes())
        identity = journal.get("identity", {})
        expected = {
            "chain_id": self.config.chain_id,
            "contract_address": self.contract_address,
            "wallet_address": self.address,
            "job_id": job_id,
        }
        if any(identity.get(key) != value for key, value in expected.items()):
            raise ValueError("Commit journal does not match the event recovery context")
        try:
            receipt = self.web3.eth.get_transaction_receipt(journal["transaction_hash"])
        except TransactionNotFound:
            return 0
        # CommitComplete cannot precede this provider's mined commitment.
        return receipt["blockNumber"]

    def _job_events(
        self, result_path: Path, job_id: str, latest: int
    ) -> dict[str, bool]:
        """Backfill bounded log ranges, persisting progress and checking for chain reorgs."""
        from web3 import Web3

        path = result_path.with_suffix(".events.json")
        identity = {
            "chain_id": self.config.chain_id,
            "contract": self.contract_address,
            "job_id": job_id,
        }
        state = {
            "identity": identity,
            "next_block": self._first_event_block(result_path, job_id)
            if not path.exists()
            else 0,
            "last_hash": None,
            "CommitComplete": False,
            "JobComplete": False,
        }
        if path.exists():
            state = json.loads(path.read_bytes())
            if (
                state.get("identity") != identity
                or type(state.get("next_block")) is not int
                or state["next_block"] < 0
            ):
                raise ValueError("Invalid saved contract event checkpoint")
            last = state["next_block"] - 1
            if last > latest or (
                last >= 0
                and Web3.to_hex(self.web3.eth.get_block(last)["hash"])
                != state["last_hash"]
            ):
                state = {
                    "identity": identity,
                    "next_block": self._first_event_block(result_path, job_id),
                    "last_hash": None,
                    "CommitComplete": False,
                    "JobComplete": False,
                }
        first = state["next_block"]
        if first <= latest:
            end = min(latest, first + EVENT_BLOCK_RANGE - 1)
            end_hash = Web3.to_hex(self.web3.eth.get_block(end)["hash"])
            observed = {}
            for name in ("CommitComplete", "JobComplete"):
                logs = getattr(self.contract.events, name)().get_logs(
                    from_block=first, to_block=end, argument_filters={"jobId": job_id}
                )
                observed[name] = any(log["args"]["jobId"] == job_id for log in logs)
            if Web3.to_hex(self.web3.eth.get_block(end)["hash"]) != end_hash:
                # Do not persist or act on logs from a range that changed mid-scan.
                return {"CommitComplete": False, "JobComplete": False}
            for name, found in observed.items():
                state[name] = state[name] or found
            state["next_block"] = end + 1
            state["last_hash"] = end_hash
            with atomic_output(path) as output:
                output.write(json.dumps(state, indent=2) + "\n")
        return {name: state[name] is True for name in ("CommitComplete", "JobComplete")}
