import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

import { evaluationChain } from "./blockchain";

export const wagmiConfig = createConfig({
  chains: [evaluationChain],
  connectors: [injected()],
  transports: {
    [evaluationChain.id]: http(process.env.NEXT_PUBLIC_NET_URL),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
