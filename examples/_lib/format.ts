/**
 * Output helpers shared by the runnable examples.
 *
 * Amounts in the Pump protocol are integer base units: lamports for SOL
 * (1 SOL = 1e9 lamports) and 6-decimal base units for Pump tokens
 * (1 token = 1e6 units). These helpers render them for humans without
 * ever doing financial math in floating point: BN stays authoritative,
 * floats appear only at the final display step.
 */
import BN from "bn.js";

const LAMPORTS = new BN(1_000_000_000);
const TOKEN_UNITS = new BN(1_000_000);

export function formatSol(lamports: BN, decimals = 4): string {
  return `${divToDecimalString(lamports, LAMPORTS, decimals)} SOL`;
}

export function formatTokens(units: BN, decimals = 2): string {
  return `${divToDecimalString(units, TOKEN_UNITS, decimals)} tokens`;
}

/** Integer division with a fixed number of decimal places, no floats. */
export function divToDecimalString(
  amount: BN,
  divisor: BN,
  decimals: number,
): string {
  const scale = new BN(10).pow(new BN(decimals));
  const scaled = amount.mul(scale).div(divisor);
  const text = scaled.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, text.length - decimals);
  const frac = text.slice(text.length - decimals);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimals > 0 ? `${grouped}.${frac}` : grouped;
}

/** Section header for example output. */
export function heading(title: string): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

/** Aligned key/value line for example output. */
export function row(label: string, value: unknown): void {
  console.log(`${label.padEnd(28)} ${String(value)}`);
}
