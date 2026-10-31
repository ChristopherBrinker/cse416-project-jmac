"""Sign score commitments and reconcile durable transactions before resubmission."""

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from .output import atomic_output
from .provider_api import validate_deployment_url

ENCODING = "keccak256-abi-bool-array-v1"
ZERO_COMMIT = bytes(32)


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


def score_commitment(scores: object) -> bytes:
    from eth_abi import encode
    from web3 import Web3

    if (
        not isinstance(scores, list)
        or not scores
        or any(type(score) is not bool for score in scores)
    ):
        raise ValueError("Commitment requires a nonempty ordered boolean score array")
    return bytes(Web3.keccak(encode(["bool[]"], [scores])))


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
        from eth_account import Account
        from web3 import Web3
        from web3.exceptions import TransactionNotFound

        if self.web3.eth.chain_id != self.config.chain_id:
            raise ValueError("RPC chain ID does not match JMAC_CHAIN_ID")
        if not self.web3.eth.get_code(self.contract_address):
            raise ValueError("No contract deployed at JMAC_CONTRACT_ADDRESS")
        result = json.loads(result_path.read_bytes())
        assignment = result["assignment"]
        digest = score_commitment(result["scores"])
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
        if bytes(provider[2]) != ZERO_COMMIT:
            if bytes(provider[2]) != digest:
                raise ValueError("On-chain commitment conflicts with saved scores")
            return True

        journal_path = result_path.with_suffix(".commit.json")
        identity = {
            "chain_id": self.config.chain_id,
            "contract_address": self.contract_address,
            "wallet_address": self.address,
            "job_id": assignment["job_id"],
            "provider_id": assignment["provider_id"],
            "commitment": Web3.to_hex(digest),
            "encoding": ENCODING,
        }
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
            transaction = self.contract.functions.commitResult(
                assignment["job_id"], digest
            ).build_transaction(
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
                "Commit transaction reverted; inspect its journal before retrying"
            )
        # Confirm contract state on the next pass rather than equating a receipt
        # alone with successful settlement.
        return False
