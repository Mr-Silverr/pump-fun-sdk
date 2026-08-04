/**
 * Example 27: Decode Trade Events by Hand
 *
 * Category: Accounts & Events
 *
 * Decodes the four bonding curve lifecycle events (trade, create, complete,
 * migration) straight off a transaction's log buffers. The decoders take
 * the BARE payload, so the 8-byte anchor discriminator that routes the
 * buffer has to be split off first; feeding them the whole buffer is the
 * mistake this example exists to prevent.
 *
 * Run: npm run example 27
 */
import {
  PUMP_SDK,
  PUMP_PROGRAM_ID,
  PumpIdl,
  type CompleteEvent,
  type CompletePumpAmmMigrationEvent,
  type CreateEvent,
  type TradeEvent,
} from "@nirholas/pump-sdk";

import { getConnection } from "./_lib/connection";
import { collectStreamSignatures } from "./_lib/discovery";
import { formatSol, formatTokens, heading, row } from "./_lib/format";
import { withRpcRetry } from "./25-decode-pool";

/** Every anchor event buffer starts with an 8-byte discriminator. */
export const EVENT_DISCRIMINATOR_BYTES = 8;

/** The four bonding curve lifecycle events, tagged by IDL name. */
export type CurveLifecycleEvent =
  | { name: "TradeEvent"; data: TradeEvent }
  | { name: "CreateEvent"; data: CreateEvent }
  | { name: "CompleteEvent"; data: CompleteEvent }
  | {
      name: "CompletePumpAmmMigrationEvent";
      data: CompletePumpAmmMigrationEvent;
    };

interface IdlEvents {
  events: Array<{ name: string; discriminator: number[] }>;
}

/** Hex discriminator of a Pump program event, read from the shipped IDL. */
export function pumpEventDiscriminator(name: string): string {
  const event = (PumpIdl as IdlEvents).events.find((e) => e.name === name);
  if (!event) {
    throw new Error(`The Pump IDL has no event named "${name}"`);
  }
  return Buffer.from(event.discriminator).toString("hex");
}

/**
 * Discriminator (hex) to decoder, for the four lifecycle events.
 *
 * Each decoder receives the payload AFTER the discriminator. The SDK's
 * `decode*Event` methods are thin wrappers over the anchor type coder, and
 * the type coder never sees the discriminator: that byte range is the
 * routing key, not part of the borsh struct.
 */
export const CURVE_EVENT_DECODERS: ReadonlyMap<
  string,
  (payload: Buffer) => CurveLifecycleEvent
> = new Map([
  [
    pumpEventDiscriminator("TradeEvent"),
    (payload: Buffer): CurveLifecycleEvent => ({
      name: "TradeEvent",
      data: PUMP_SDK.decodeTradeEvent(payload),
    }),
  ],
  [
    pumpEventDiscriminator("CreateEvent"),
    (payload: Buffer): CurveLifecycleEvent => ({
      name: "CreateEvent",
      data: PUMP_SDK.decodeCreateEvent(payload),
    }),
  ],
  [
    pumpEventDiscriminator("CompleteEvent"),
    (payload: Buffer): CurveLifecycleEvent => ({
      name: "CompleteEvent",
      data: PUMP_SDK.decodeCompleteEvent(payload),
    }),
  ],
  [
    pumpEventDiscriminator("CompletePumpAmmMigrationEvent"),
    (payload: Buffer): CurveLifecycleEvent => ({
      name: "CompletePumpAmmMigrationEvent",
      data: PUMP_SDK.decodeCompletePumpAmmMigrationEvent(payload),
    }),
  ],
]);

/**
 * Split a raw `Program data:` buffer into its routing key and its payload.
 * This is the step every hand-rolled decoder forgets.
 */
export function splitProgramData(buffer: Buffer): {
  discriminator: string;
  payload: Buffer;
} {
  if (buffer.length < EVENT_DISCRIMINATOR_BYTES) {
    throw new Error(
      `Event buffer is ${buffer.length} bytes; an anchor event needs at least ${EVENT_DISCRIMINATOR_BYTES}`,
    );
  }
  return {
    discriminator: buffer
      .subarray(0, EVENT_DISCRIMINATOR_BYTES)
      .toString("hex"),
    payload: buffer.subarray(EVENT_DISCRIMINATOR_BYTES),
  };
}

/**
 * Decode one raw log buffer as a bonding curve lifecycle event, or return
 * null when it is one of the protocol's other events.
 */
export function decodeCurveEvent(buffer: Buffer): CurveLifecycleEvent | null {
  const { discriminator, payload } = splitProgramData(buffer);
  const decode = CURVE_EVENT_DECODERS.get(discriminator);
  return decode ? decode(payload) : null;
}

/** The base64 `Program data:` payloads carried by a transaction's logs. */
export function programDataBuffers(logs: readonly string[]): Buffer[] {
  const prefix = "Program data: ";
  return logs
    .filter((line) => line.startsWith(prefix))
    .map((line) => Buffer.from(line.slice(prefix.length), "base64"));
}

function describe(event: CurveLifecycleEvent): void {
  switch (event.name) {
    case "TradeEvent":
      row("  mint", event.data.mint.toBase58());
      row("  side", event.data.isBuy ? "buy" : "sell");
      row("  sol", formatSol(event.data.solAmount));
      row("  tokens", formatTokens(event.data.tokenAmount));
      row("  fee + creator fee", formatSol(event.data.fee.add(event.data.creatorFee), 6));
      row("  instruction", event.data.ixName);
      break;
    case "CreateEvent":
      row("  mint", event.data.mint.toBase58());
      row("  name / symbol", `${event.data.name} / ${event.data.symbol}`);
      row("  creator", event.data.creator.toBase58());
      row("  virtual SOL", formatSol(event.data.virtualSolReserves));
      break;
    case "CompleteEvent":
      row("  mint", event.data.mint.toBase58());
      row("  bonding curve", event.data.bondingCurve.toBase58());
      row("  completed by", event.data.user.toBase58());
      break;
    case "CompletePumpAmmMigrationEvent":
      row("  mint", event.data.mint.toBase58());
      row("  pool", event.data.pool.toBase58());
      row("  SOL migrated", formatSol(event.data.solAmount));
      row("  tokens migrated", formatTokens(event.data.mintAmount));
      break;
  }
}

export async function main(): Promise<void> {
  const connection = getConnection();

  heading("The four discriminators (from src/idl/pump.json)");
  for (const name of [
    "TradeEvent",
    "CreateEvent",
    "CompleteEvent",
    "CompletePumpAmmMigrationEvent",
  ]) {
    row(name, pumpEventDiscriminator(name));
  }

  heading("Finding a recent Pump transaction");
  const override = process.env.SIGNATURE;
  const signatures = override
    ? [override]
    : await collectStreamSignatures(connection, PUMP_PROGRAM_ID, 3);

  let signature = "";
  let buffers: Buffer[] = [];
  for (const candidate of signatures) {
    const tx = await withRpcRetry(`fetch ${candidate.slice(0, 8)}`, () =>
      connection.getTransaction(candidate, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      }),
    );
    const logs = tx?.meta?.logMessages ?? [];
    const found = programDataBuffers(logs);
    if (found.length > 0) {
      signature = candidate;
      buffers = found;
      break;
    }
  }

  if (buffers.length === 0) {
    throw new Error(
      "No `Program data:` log lines found in the sampled transactions. Retry, " +
        "set PUMP_RPC_URL, or pass SIGNATURE=<signature>.",
    );
  }

  row("Signature", signature);
  row("Event buffers", buffers.length);

  heading("Decoded lifecycle events");
  let decodedCount = 0;
  for (const buffer of buffers) {
    const { discriminator, payload } = splitProgramData(buffer);
    const event = decodeCurveEvent(buffer);
    if (!event) {
      row(`${discriminator} (other event)`, `${payload.length} payload bytes`);
      continue;
    }
    decodedCount += 1;
    row(event.name, `${buffer.length} bytes = 8 + ${payload.length} payload`);
    describe(event);
  }

  heading("The trap");
  const sample = buffers[0]!;
  console.log(
    "A `Program data:` buffer is discriminator + payload. Handing the whole",
  );
  console.log("buffer to a decoder shifts every field by 8 bytes:");
  try {
    PUMP_SDK.decodeTradeEvent(sample);
    console.log(
      "  decodeTradeEvent(wholeBuffer) returned without throwing, and every",
    );
    console.log(
      "  field it produced is misaligned. Borsh cannot tell you that.",
    );
  } catch (error) {
    console.log(
      `  decodeTradeEvent(wholeBuffer) threw: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  console.log(
    `\nDecoded ${decodedCount} of ${buffers.length} buffers as curve lifecycle events;`,
  );
  console.log(
    "the rest belong to the protocol's other events and were routed away by",
  );
  console.log("their discriminator, not by guessing at their length.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
