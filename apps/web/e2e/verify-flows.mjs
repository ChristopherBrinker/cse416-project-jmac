/*
  Browser verification for the wallet, funding, result, and refund flows.

  Drives the local Google Chrome with playwright-core and injects the
  TEST-ONLY Anvil wallet (anvil-test-wallet.js) before the app loads, so no
  private key is ever typed into the site. Requires the local stack from
  docs/demo.md: Anvil, the deployed contract, Convex, the scheduler, the web
  app on :7346, and `bun run demo:providers` in the mode a phase needs.

  Usage (from apps/web):
    node e2e/verify-flows.mjs wallet    # connect, account change, wrong network, rejection
    node e2e/verify-flows.mjs success   # providers in "agree" mode
    node e2e/verify-flows.mjs refund    # providers in "disagree" mode
    node e2e/verify-flows.mjs expiry    # providers in "silent" mode (advances Anvil time)
    node e2e/verify-flows.mjs sandbox

  Env: E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD (a disposable demo account),
  E2E_OUT (screenshot/video directory), E2E_RPC_URL.
*/
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright-core";

const here = import.meta.dirname;
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:7346";
const RPC_URL = process.env.E2E_RPC_URL ?? "http://127.0.0.1:8545";
const EMAIL = process.env.E2E_EMAIL ?? "demo.developer@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "demo-password-416";
const OUT = process.env.E2E_OUT ?? path.join(here, "output");
const SETTLE_TIMEOUT_MS = 120_000;
const EXPIRY_SECONDS = 600;
const BENCHMARK = "Worker scoring example v1.0.0";
const MODEL = "SmolLM2-135M-Instruct";

const phase = process.argv[2] ?? "wallet";

const shot = async (page, name) => {
  const file = path.join(OUT, `${phase}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  screenshot ${file}`);
};

const detail = (page) => page.locator('section[aria-label="Job details"]');

const step = (label) => console.log(`- ${label}`);

const anvil = async (method, params = []) => {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  return body.result;
};

const signIn = async (page) => {
  await page.goto(`${BASE_URL}/sign-in`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  await page.getByText("Backend connected").waitFor();
};

const connectWallet = async (page) => {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Connect Anvil Test Wallet" }).click();
  await page.getByRole("button", { name: /0x7099/u }).waitFor();
};

const createJob = async (page) => {
  await page.getByRole("button", { name: "New evaluation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText(BENCHMARK).first().click();
  await dialog.getByText(MODEL).first().click();
  await dialog.getByRole("button", { name: "Create evaluation" }).click();
  await dialog.waitFor({ state: "hidden" });
  await detail(page).getByText("Fund this evaluation").waitFor();
};

const fundSelectedJob = async (page) => {
  await detail(page)
    .getByRole("button", { name: /Fund job/u })
    .click();
  await detail(page)
    .getByText(/Funding confirmed|Assigning providers/u)
    .first()
    .waitFor();
};

const phases = {
  async wallet(page) {
    step("connect browser wallet (no private key field exists)");
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await shot(page, "01-connect-dialog");
    await page
      .getByRole("button", { name: "Connect Anvil Test Wallet" })
      .click();
    await page.getByRole("button", { name: /0x7099/u }).waitFor();
    await shot(page, "02-connected");

    step("wallet switches account underneath the page");
    await page.evaluate(() => window.anvilTestWallet.useAccount(2));
    await page.getByText(/Wallet account changed to 0x3C44/u).waitFor();
    await shot(page, "03-account-changed");
    await page.evaluate(() => window.anvilTestWallet.useAccount(1));

    step("wrong network blocks funding until switched");
    await page.evaluate(() => window.anvilTestWallet.setChain(1));
    await page.getByText("Wrong network").first().waitFor();
    await shot(page, "04-wrong-network");
    await page
      .getByRole("button", { name: "Switch to JMAC Local (Anvil)" })
      .first()
      .click();
    await page.getByText("Wrong network").first().waitFor({ state: "hidden" });

    step("rejected funding transaction leaves the job unfunded");
    if ((await detail(page).getByText("Fund this evaluation").count()) === 0) {
      await createJob(page);
    }
    await page.evaluate(() => window.anvilTestWallet.rejectNext());
    await detail(page)
      .getByRole("button", { name: /Fund job/u })
      .click();
    await detail(page)
      .getByText(/You rejected the request/u)
      .waitFor();
    await shot(page, "05-funding-rejected");

    step("disconnect");
    await page.evaluate(() => window.anvilTestWallet.disconnect());
    await page.getByRole("button", { name: "Connect wallet" }).waitFor();
    await shot(page, "06-disconnected");
  },

  async success(page) {
    await connectWallet(page);
    if ((await detail(page).getByText("Fund this evaluation").count()) === 0) {
      await createJob(page);
    }
    step("fund from the browser wallet");
    await fundSelectedJob(page);
    await shot(page, "01-funding-confirmed");
    step("wait for providers to commit and reveal matching results");
    await detail(page)
      .getByText("Evaluation receipt")
      .waitFor({ timeout: SETTLE_TIMEOUT_MS });
    await detail(page)
      .getByText("2 of 2 providers have claimed")
      .waitFor({ timeout: SETTLE_TIMEOUT_MS });
    await shot(page, "02-accepted-receipt");
  },

  async refund(page) {
    await connectWallet(page);
    await createJob(page);
    step("fund a job whose providers will disagree");
    await fundSelectedJob(page);
    await detail(page)
      .getByText("Refund available")
      .first()
      .waitFor({ timeout: SETTLE_TIMEOUT_MS });
    await shot(page, "01-disagreement-refund-available");

    step("a different wallet cannot refund");
    await page.evaluate(() => window.anvilTestWallet.useAccount(2));
    await detail(page)
      .getByText(/Only the funding wallet/u)
      .waitFor();
    await shot(page, "02-wrong-account");
    await page.evaluate(() => window.anvilTestWallet.useAccount(1));

    step("rejected refund keeps the job refundable (not refunded)");
    await page.evaluate(() => window.anvilTestWallet.rejectNext());
    await detail(page).getByRole("button", { name: "Refund job" }).click();
    await detail(page)
      .getByText(/You rejected the request/u)
      .waitFor();
    await detail(page).getByText("Refund available").first().waitFor();
    await shot(page, "03-refund-rejected");

    step("creator-signed refund");
    await detail(page).getByRole("button", { name: "Refund job" }).click();
    await detail(page)
      .getByText("Refund confirmed")
      .first()
      .waitFor({ timeout: SETTLE_TIMEOUT_MS });
    await shot(page, "04-refund-confirmed");
  },

  async expiry(page) {
    await connectWallet(page);
    await createJob(page);
    step("fund a job whose providers never commit");
    await fundSelectedJob(page);
    // Wait for on-chain assignment so the deadline that passes is the
    // providers' commit deadline, not the scheduler's assignment window
    await detail(page)
      .getByText("Providers assigned")
      .waitFor({ timeout: SETTLE_TIMEOUT_MS });
    await detail(page)
      .getByText(/Commits 0\/2/u)
      .waitFor();
    await shot(page, "01-evaluation-pending");

    step("refund is blocked before the deadline");
    const tooEarly = await detail(page)
      .getByRole("button", { name: "Refund job" })
      .count();
    if (tooEarly !== 0) {
      throw new Error("Refund offered before the deadline");
    }

    step(`advance Anvil time ${EXPIRY_SECONDS}s past the commit deadline`);
    await anvil("evm_increaseTime", [EXPIRY_SECONDS]);
    await anvil("evm_mine");
    await detail(page)
      .getByText(/Expired/u)
      .first()
      .waitFor({ timeout: SETTLE_TIMEOUT_MS });
    await shot(page, "02-expired-refund-available");
    await detail(page).getByRole("button", { name: "Refund job" }).click();
    await detail(page)
      .getByText("Refund confirmed")
      .first()
      .waitFor({ timeout: SETTLE_TIMEOUT_MS });
    await shot(page, "03-refund-confirmed");
  },

  async sandbox(page) {
    await page.goto(`${BASE_URL}/dev-sandbox`);
    await page.getByText(/Private keys are never entered/u).waitFor();
    const keyInputs = await page.locator("#privateKey").count();
    if (keyInputs !== 0) {
      throw new Error("Dev sandbox still has a private key input");
    }
    await shot(page, "01-dev-sandbox");
  },
};

const run = async () => {
  if (!(phase in phases)) {
    throw new Error(`Unknown phase "${phase}"`);
  }
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1700 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 1700 } },
  });
  await context.addInitScript({
    path: path.join(here, "anvil-test-wallet.js"),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  try {
    await signIn(page);
    await phases[phase](page);
    console.log(`PASS ${phase}`);
  } catch (error) {
    await shot(page, "failure");
    console.error(`FAIL ${phase}:`, error);
    process.exitCode = 1;
  } finally {
    const video = page.video();
    await context.close();
    if (video) {
      console.log(`  video ${await video.path()}`);
    }
    await browser.close();
  }
};

await run();
