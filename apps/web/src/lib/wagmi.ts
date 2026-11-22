import { defineChain } from "viem";
import { foundry, sepolia } from "viem/chains";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

// wagmi demands these be hardcoded
const rpcUrl = process.env.NEXT_PUBLIC_NET_URL ?? "http://127.0.0.1:8545";
const foundryChain = defineChain({
  ...foundry,
  name: "JMAC Local (Anvil)",
  rpcUrls: { default: { http: [rpcUrl] } },
});
const sepoliaChain = defineChain({
  ...sepolia,
  name: "JMAC Sepolia",
  rpcUrls: { default: { http: [rpcUrl] } },
});

export const wagmiConfig =
  process.env.NEXT_PUBLIC_CHAIN === "sepolia"
    ? createConfig({
        chains: [sepoliaChain],
        connectors: [injected()],
        transports: {
          [sepoliaChain.id]: http(process.env.NEXT_PUBLIC_NET_URL),
        },
        ssr: true,
      })
    : createConfig({
        chains: [foundryChain],
        connectors: [injected()],
        transports: {
          [foundryChain.id]: http(process.env.NEXT_PUBLIC_NET_URL),
        },
        ssr: true,
      });

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
