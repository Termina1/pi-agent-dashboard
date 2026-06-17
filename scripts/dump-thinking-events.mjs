#!/usr/bin/env node
/**
 * Connect to dashboard WebSocket, subscribe + send message,
 * and dump all message_update events with thinking_* types.
 */
import WebSocket from "ws";

const WS_URL = process.env.DASHBOARD_WS_URL || "ws://localhost:8000/ws";
const SESSION_ID = process.env.SESSION_ID || "019ecd05-a4c4-70e7-9118-5bd588c87f3c";

console.log(`[dump-thinking] Connecting to ${WS_URL}...`);

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log(`[dump-thinking] Connected. Subscribing + sending message to ${SESSION_ID}...`);
  // Subscribe
  ws.send(JSON.stringify({ type: "subscribe", sessionId: SESSION_ID }));
  // Send prompt (right after subscribe, without waiting for replay)
  setTimeout(() => {
    console.log("[dump-thinking] Sending prompt...");
    ws.send(JSON.stringify({
      type: "send_prompt",
      sessionId: SESSION_ID,
      text: "Reply with exactly one word: hello or goodbye. No explanation.",
    }));
  }, 2000);
});

let capturedCount = 0;
let otherCount = 0;

ws.on("message", (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    
    if (msg.type === "event_forward") {
      const event = msg.event;
      if (!event) return;
      
      // Log first 5 non-thinking event types to understand what's flowing
      if (event.eventType !== "message_update" || !event.data?.assistantMessageEvent) {
        if (otherCount < 5) {
          otherCount++;
          console.log(`[other #${otherCount}] eventType: ${event.eventType}`);
        }
        return;
      }
      
      const data = event.data;
      const ame = data.assistantMessageEvent;
      const t = ame.type;
      
      if (!t || !t.startsWith("thinking_")) return;
      
      capturedCount++;
      
      console.log(`\n=== THINKING #${capturedCount} ${t} ===`);
      console.log(`keys:`, Object.keys(ame).sort());
      console.log(`delta: ${JSON.stringify(ame.delta)} (type: ${typeof ame.delta})`);
      console.log(`contentIndex: ${ame.contentIndex}`);
      
      if (capturedCount <= 3) {
        const { partial, ...rest } = ame;
        console.log(`FULL (no partial):`, JSON.stringify(rest, null, 2).slice(0, 1500));
      }
      
      if (capturedCount >= 30) {
        console.log("\n[dump-thinking] Done.");
        ws.close();
        process.exit(0);
      }
    }
  } catch {}
});

ws.on("close", () => {
  console.log(`\n[dump-thinking] Closed. Captured ${capturedCount} thinking events, ${otherCount} other events.`);
  process.exit(0);
});

ws.on("error", (err) => {
  console.error(`[dump-thinking] Error: ${err.message}`);
  process.exit(1);
});

setTimeout(() => {
  console.log(`\n[dump-thinking] Timeout. Captured ${capturedCount} thinking events.`);
  ws.close();
  process.exit(0);
}, 45_000);
