import { NextResponse } from "next/server";
import { databaseConfigured } from "@/src/lib/db";

export async function GET() {
  return NextResponse.json({
    database: databaseConfigured(),
    mainnetRpc: Boolean(process.env.ROBINHOOD_MAINNET_RPC),
    fallbackRpc: Boolean(process.env.ROBINHOOD_MAINNET_RPC_FALLBACK),
    testnetRpc: Boolean(process.env.ROBINHOOD_TESTNET_RPC),
    automationEncryption: Boolean(process.env.AUTOPILOT_ENCRYPTION_KEY),
    autopilotGate: process.env.AUTOPILOT_ENABLED === "true",
    notifications: {
      webhook: Boolean(process.env.ALERT_WEBHOOK_URL),
      discord: Boolean(process.env.DISCORD_WEBHOOK_URL),
      telegram: Boolean(
        process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
      ),
      email: Boolean(process.env.SMTP_URL && process.env.ALERT_EMAIL_TO),
    },
  });
}
