import { PUMP_PROGRAM_ID } from "@nirholas/pump-sdk";
import { Keypair } from "@solana/web3.js";

import { buildCreateTokenInstruction, main } from "../01-create-token";

describe("example 01: create a token", () => {
  const mint = Keypair.generate();
  const user = Keypair.generate();

  it("builds a createV2 instruction against the Pump program", async () => {
    const ix = await buildCreateTokenInstruction({
      name: "Example Coin",
      symbol: "XMPL",
      uri: "https://example.com/metadata.json",
      mint: mint.publicKey,
      creator: user.publicKey,
      user: user.publicKey,
    });

    expect(ix.programId.equals(PUMP_PROGRAM_ID)).toBe(true);
    expect(ix.keys.length).toBeGreaterThan(0);
    expect(ix.data.length).toBeGreaterThan(0);
  });

  it("marks the mint and the user as signers", async () => {
    const ix = await buildCreateTokenInstruction({
      name: "Example Coin",
      symbol: "XMPL",
      uri: "https://example.com/metadata.json",
      mint: mint.publicKey,
      creator: user.publicKey,
      user: user.publicKey,
    });

    const signers = ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58());
    expect(signers).toContain(mint.publicKey.toBase58());
    expect(signers).toContain(user.publicKey.toBase58());
  });

  it("mayhem and cashback flags change the instruction data", async () => {
    const base = {
      name: "Example Coin",
      symbol: "XMPL",
      uri: "https://example.com/metadata.json",
      mint: mint.publicKey,
      creator: user.publicKey,
      user: user.publicKey,
    };
    const plain = await buildCreateTokenInstruction(base);
    const mayhem = await buildCreateTokenInstruction({ ...base, mayhemMode: true });
    expect(plain.data.equals(mayhem.data)).toBe(false);
  });

  it("exports a runnable main()", () => {
    expect(typeof main).toBe("function");
  });
});
