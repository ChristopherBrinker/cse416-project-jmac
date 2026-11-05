#!/usr/bin/env bash
# Chain-level acceptance run on a throwaway Anvil node: success, disagreement, missing provider,
# and replayed/duplicate settlement calls. Records transaction hashes and balances as evidence.
#
#   contracts/script/e2e-settlement.sh [evidence.md]
#
# Uses only Anvil's public development accounts; never point this at a real network.
set -euo pipefail

EVIDENCE=${1:-/dev/stdout}
# Resolve a relative evidence path against the caller's directory before changing into contracts/.
case "$EVIDENCE" in
/*) ;;
*) EVIDENCE="$PWD/$EVIDENCE" ;;
esac
cd "$(dirname "$0")/.."
PORT=${ANVIL_PORT:-8546}
RPC="http://127.0.0.1:$PORT"
: >"$EVIDENCE" 2>/dev/null || true

# Anvil's well-known development keys (accounts 0-3). Public test values only.
BACKEND_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
CREATOR_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
A_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
B_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6

fail() {
    echo "e2e: $*" >&2
    exit 1
}

# Never settle against a node we did not start: refuse a port that already answers.
if cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
    fail "port $PORT already serves an RPC node; set ANVIL_PORT to a free port"
fi
anvil --port "$PORT" --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
READY=
for _ in $(seq 50); do
    kill -0 "$ANVIL_PID" 2>/dev/null || fail "anvil exited (could it bind port $PORT?)"
    if cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 0.2
done
[ -n "$READY" ] || fail "anvil did not start on port $PORT"
kill -0 "$ANVIL_PID" 2>/dev/null || fail "anvil exited (could it bind port $PORT?)"
log() { printf '%s\n' "$*" >>"$EVIDENCE"; }
# json_field <name>: first string value of that field in pretty or compact JSON on stdin
json_field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" | head -n 1; }

BACKEND=$(cast wallet address "$BACKEND_KEY")
CREATOR=$(cast wallet address "$CREATOR_KEY")
A=$(cast wallet address "$A_KEY")
B=$(cast wallet address "$B_KEY")
CHAIN_ID=$(cast chain-id --rpc-url "$RPC")

forge build --silent
CONTRACT=$(forge create src/Evaluation.sol:Evaluation --rpc-url "$RPC" --private-key "$BACKEND_KEY" \
    --broadcast --json --constructor-args "$BACKEND" | json_field deployedTo)
[ -n "$CONTRACT" ] || fail "deployment failed"

PRICE=1000001 # odd on purpose: provider B must receive the extra wei
ITEMS=3
CONTENT_HASH=$(printf 'a%.0s' $(seq 64))
SPEC=$(cast keccak "$(cast abi-encode 'f(string,string)' "$CONTENT_HASH" model1)")
# Stands in for the benchmark-derived output key that only providers and the creator hold.
OUTPUT_KEY=$(cast keccak "e2e output key")
JOB_TUPLE='jobs(string)(address,string,uint256,(address,string,bytes32,bytes32,bool,bool,bool,uint256),(address,string,bytes32,bytes32,bool,bool,bool,uint256),bool,uint8,uint256,bytes32,uint256)'

# send <key> <signature> <args...>: prints the transaction hash; fails unless it succeeded
send() {
    local key=$1 output hash
    shift
    output=$(cast send "$CONTRACT" "$@" --rpc-url "$RPC" --private-key "$key" --json) || return 1
    grep -q '"status": *"0x1"' <<<"$output" || return 1
    hash=$(json_field transactionHash <<<"$output")
    [ -n "$hash" ] || return 1
    printf '%s\n' "$hash"
}

# step <label> <key> <signature> <args...>: sends and records the transaction hash
step() {
    local label=$1 hash
    shift
    hash=$(send "$@") || fail "transaction failed: $label"
    log "| $label | \`$hash\` |"
}

# expect_revert <label> <reason> <key> <signature> <args...>
expect_revert() {
    local label=$1 reason=$2 key=$3 output
    shift 3
    if output=$(cast send "$CONTRACT" "$@" --rpc-url "$RPC" --private-key "$key" 2>&1); then
        fail "expected '$reason' but '$label' succeeded"
    fi
    grep -q "$reason" <<<"$output" || fail "'$label' reverted for another reason: $output"
    log "| $label | reverted: $reason |"
}

balance() { cast balance "$1" --rpc-url "$RPC"; }
status() { cast call "$CONTRACT" "$JOB_TUPLE" "$1" --rpc-url "$RPC" | sed -n 7p; }
digest() { cast keccak "$(cast abi-encode 'f(bytes32,string,uint256[])' "$OUTPUT_KEY" "$1" "$2")"; }
salt() { cast keccak "$1 salt $2"; }
commitment() { # job provider digest count salt
    cast call "$CONTRACT" 'resultCommitment(string,address,bytes32,uint256,bytes32)(bytes32)' "$@" --rpc-url "$RPC"
}

fund_and_assign() {
    step "fundJob" "$CREATOR_KEY" 'fundJob(string)' "$1" --value "$PRICE"
    step "assignProviders" "$BACKEND_KEY" 'assignProviders(string,address,string,address,string,bytes32,uint256)' \
        "$1" "$A" providerA "$B" providerB "$SPEC" "$ITEMS"
}

commit_and_reveal() { # job digestA countA digestB countB
    step "commit A" "$A_KEY" 'commitResult(string,bytes32)' "$1" "$(commitment "$1" "$A" "$2" "$3" "$(salt "$1" A)")"
    step "commit B" "$B_KEY" 'commitResult(string,bytes32)' "$1" "$(commitment "$1" "$B" "$4" "$5" "$(salt "$1" B)")"
    step "reveal A" "$A_KEY" 'revealResult(string,bytes32,uint256,bytes32)' "$1" "$2" "$3" "$(salt "$1" A)"
    step "reveal B" "$B_KEY" 'revealResult(string,bytes32,uint256,bytes32)' "$1" "$4" "$5" "$(salt "$1" B)"
}

table() {
    log ""
    log "## $1"
    log ""
    log "| Step | Transaction / result |"
    log "| --- | --- |"
}

log "# Settlement acceptance evidence"
log ""
log "Chain $CHAIN_ID, contract \`$CONTRACT\`, backend \`$BACKEND\`, creator \`$CREATOR\`,"
log "provider A \`$A\`, provider B \`$B\`. Price $PRICE wei, $ITEMS items, spec \`$SPEC\`."

# --- 1. success: matching ordered predictions, both claims, odd wei to B ---------------------
table "1. Matching results are accepted and paid"
AGREED=$(digest success "[0,1,0]")
fund_and_assign success
commit_and_reveal success "$AGREED" 2 "$AGREED" 2
[ "$(status success)" = 1 ] || fail "success job is not Complete"
A_BEFORE=$(balance "$A")
B_BEFORE=$(balance "$B")
CLAIM_A=$(send "$A_KEY" 'claimPayment(string)' success) || fail "claim A failed"
log "| claim A | \`$CLAIM_A\` |"
CLAIM_B=$(send "$B_KEY" 'claimPayment(string)' success) || fail "claim B failed"
log "| claim B | \`$CLAIM_B\` |"
expect_revert "claim A again" "Already claimed" "$A_KEY" 'claimPayment(string)' success
expect_revert "refund completed job" "Job not refundable" "$CREATOR_KEY" 'refund(string)' success
expect_revert "reveal A again" "Already revealed" "$A_KEY" 'revealResult(string,bytes32,uint256,bytes32)' \
    success "$AGREED" 2 "$(salt success A)"

# Balance change plus each claimant's own gas recovers the exact contract transfer.
gas_cost() {
    local receipt used price
    receipt=$(cast receipt "$1" --rpc-url "$RPC" --json)
    used=$(cast to-dec "$(json_field gasUsed <<<"$receipt")")
    price=$(cast to-dec "$(json_field effectiveGasPrice <<<"$receipt")")
    echo $((used * price))
}
PAID_A=$(($(balance "$A") - A_BEFORE + $(gas_cost "$CLAIM_A")))
PAID_B=$(($(balance "$B") - B_BEFORE + $(gas_cost "$CLAIM_B")))
[ "$PAID_A" = $((PRICE / 2)) ] || fail "provider A was paid $PAID_A"
[ "$PAID_B" = $((PRICE - PRICE / 2)) ] || fail "provider B was paid $PAID_B"
[ "$(balance "$CONTRACT")" = 0 ] || fail "funds left in contract after claims"
log ""
log "Status Complete. Accepted digest \`$AGREED\` with a provider-claimed score of 2/$ITEMS"
log "(no answer key is involved; the contract only checks that the count does not exceed the item count)."
log "Contract transfers (balance change plus the claimant's own gas): A $PAID_A wei, B $PAID_B wei"
log "(B takes the odd wei). Each account's balance rose by its transfer minus claim gas. Contract balance 0 wei."

# --- 2. disagreement: same accuracy, different order -> no payment, refund ------------------
table "2. Disagreement (same claimed 2/3 score, different order) refunds the creator"
fund_and_assign disagree
commit_and_reveal disagree "$(digest disagree "[0,1,0]")" 2 "$(digest disagree "[1,1,2]")" 2
[ "$(status disagree)" = 2 ] || fail "disagreement job is not Failed"
expect_revert "claim A" "Job not complete" "$A_KEY" 'claimPayment(string)' disagree
C_BEFORE=$(balance "$CREATOR")
REFUND=$(send "$CREATOR_KEY" 'refund(string)' disagree) || fail "refund failed"
log "| refund | \`$REFUND\` |"
expect_revert "refund again" "Job not refundable" "$CREATOR_KEY" 'refund(string)' disagree
expect_revert "claim B after refund" "Job not complete" "$B_KEY" 'claimPayment(string)' disagree
REFUNDED=$(($(balance "$CREATOR") - C_BEFORE + $(gas_cost "$REFUND")))
[ "$REFUNDED" = "$PRICE" ] || fail "creator was refunded $REFUNDED"
[ "$(status disagree)" = 3 ] || fail "disagreement job is not Refunded"
log ""
log "Status Refunded. Refund transfer $REFUNDED wei (balance change plus refund gas); no provider was paid."

# --- 3. missing provider: B never commits -> refund after commit deadline ------------------
table "3. Missing provider: refund after the commit deadline"
fund_and_assign missing
step "commit A" "$A_KEY" 'commitResult(string,bytes32)' missing \
    "$(commitment missing "$A" "$(digest missing "[0,1,0]")" 2 "$(salt missing A)")"
expect_revert "refund before deadline" "Job not refundable" "$CREATOR_KEY" 'refund(string)' missing
WINDOW=$(cast call "$CONTRACT" 'COMMIT_WINDOW()(uint256)' --rpc-url "$RPC")
cast rpc evm_increaseTime "$((WINDOW + 1))" --rpc-url "$RPC" >/dev/null
cast rpc evm_mine --rpc-url "$RPC" >/dev/null
log "| advance time $((WINDOW + 1)) s | commit window closed |"
expect_revert "late commit B" "Commit deadline passed" "$B_KEY" 'commitResult(string,bytes32)' missing "$(cast keccak late)"
C_BEFORE=$(balance "$CREATOR")
REFUND=$(send "$CREATOR_KEY" 'refund(string)' missing) || fail "timeout refund failed"
log "| refund | \`$REFUND\` |"
expect_revert "refund again" "Job not refundable" "$CREATOR_KEY" 'refund(string)' missing
expect_revert "claim A" "Job not complete" "$A_KEY" 'claimPayment(string)' missing
REFUNDED=$(($(balance "$CREATOR") - C_BEFORE + $(gas_cost "$REFUND")))
[ "$REFUNDED" = "$PRICE" ] || fail "creator was refunded $REFUNDED"
[ "$(status missing)" = 3 ] || fail "missing-provider job is not Refunded"
log ""
log "Status Refunded. Refund transfer $REFUNDED wei (balance change plus refund gas); provider A was not paid."

[ "$(balance "$CONTRACT")" = 0 ] || fail "funds left in contract"
log ""
log "All scenarios passed; the contract holds 0 wei."
echo "settlement e2e passed" >&2
