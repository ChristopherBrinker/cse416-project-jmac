/*
  TEST-ONLY browser wallet for verifying the dashboard without MetaMask.

  Inject this into a page (e.g. via the browser devtools console or an
  automation tool's "evaluate"). It announces an EIP-6963 wallet named
  "Anvil Test Wallet" that forwards requests to a local Anvil node, which
  signs with its unlocked development accounts. The app itself never loads
  this file and never sees a key.

  Controls (window.anvilTestWallet):
    rejectNext()      the next signature/transaction/switch request fails
                      with EIP-1193 error 4001 (user rejected)
    useAccount(i)     switch to Anvil account i and emit accountsChanged
    setChain(id)      pretend the wallet moved to chain id (wrong network)
    disconnect()      emit accountsChanged([]) as if the user disconnected
*/
(() => {
  const RPC_URL = "http://127.0.0.1:8545";
  const ANVIL_CHAIN_ID = 31_337;
  const USER_REJECTED = 4001;
  const UNRECOGNIZED_CHAIN = 4902;
  const PROMPTED_METHODS = new Set([
    "eth_requestAccounts",
    "eth_sendTransaction",
    "personal_sign",
    "eth_signTypedData_v4",
    "wallet_switchEthereumChain",
  ]);

  const listeners = new Map();
  const state = {
    accountIndex: 1,
    accounts: [],
    connected: false,
    chainId: ANVIL_CHAIN_ID,
    rejectNext: false,
    log: [],
  };

  const emit = (event, payload) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(payload);
    }
  };

  const rpc = async (method, params = []) => {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    const body = await response.json();
    if (body.error) {
      throw Object.assign(new Error(body.error.message), body.error);
    }
    return body.result;
  };

  const rejection = () =>
    Object.assign(new Error("User rejected the request."), {
      code: USER_REJECTED,
    });

  const currentAccounts = () =>
    state.connected ? [state.accounts[state.accountIndex]] : [];

  const handlers = {
    eth_requestAccounts: async () => {
      state.accounts = await rpc("eth_accounts");
      state.connected = true;
      return currentAccounts();
    },
    eth_accounts: async () => currentAccounts(),
    eth_chainId: async () => `0x${state.chainId.toString(16)}`,
    net_version: async () => String(state.chainId),
    wallet_switchEthereumChain: async ([{ chainId }]) => {
      const id = Number.parseInt(chainId, 16);
      if (id !== ANVIL_CHAIN_ID) {
        throw Object.assign(new Error("Unrecognized chain"), {
          code: UNRECOGNIZED_CHAIN,
        });
      }
      state.chainId = id;
      emit("chainChanged", chainId);
      return null;
    },
    wallet_addEthereumChain: async () => null,
    wallet_requestPermissions: async () => [
      { parentCapability: "eth_accounts" },
    ],
    wallet_getPermissions: async () =>
      state.connected ? [{ parentCapability: "eth_accounts" }] : [],
    wallet_revokePermissions: async () => {
      state.connected = false;
      return null;
    },
  };

  const provider = {
    isAnvilTestWallet: true,
    request: async ({ method, params }) => {
      state.log.push(method);
      if (PROMPTED_METHODS.has(method) && state.rejectNext) {
        state.rejectNext = false;
        throw rejection();
      }
      const handler = handlers[method];
      if (handler) {
        return handler(params ?? []);
      }
      if (
        (method === "eth_sendTransaction" || method === "personal_sign") &&
        state.chainId !== ANVIL_CHAIN_ID
      ) {
        throw Object.assign(new Error("Wallet is on another chain"), {
          code: 4901,
        });
      }
      return rpc(method, params ?? []);
    },
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    removeListener: (event, listener) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((item) => item !== listener)
      );
    },
  };

  const info = {
    uuid: "6f5d1b52-6f7f-4d5b-9e0a-anviltest0001",
    name: "Anvil Test Wallet",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23888'/%3E%3C/svg%3E",
    rdns: "dev.jmac.anvil-test-wallet",
  };
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider }),
      })
    );
  window.addEventListener("eip6963:requestProvider", announce);
  announce();

  window.anvilTestWallet = {
    state,
    rejectNext: () => {
      state.rejectNext = true;
    },
    useAccount: (index) => {
      state.accountIndex = index;
      emit("accountsChanged", currentAccounts());
    },
    setChain: (id) => {
      state.chainId = id;
      emit("chainChanged", `0x${id.toString(16)}`);
    },
    disconnect: () => {
      state.connected = false;
      emit("accountsChanged", []);
    },
  };
})();
