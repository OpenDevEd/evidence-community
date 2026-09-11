import {createServer, type Socket} from "node:net";
import {randomUUID} from "node:crypto";
import {expect, it, vi} from "vitest";
import {consumeConfiguredRateLimit, AI_RATE_LIMIT_CLIENT_WINDOWS, AI_RATE_LIMIT_NETWORK_WINDOW} from "@/lib/ai/rate-limit";
import {libraryConfigSchema} from "@/config/library-config/schema";
import {maximalLibraryConfig} from "../fixtures/library-config";

vi.mock("server-only", () => ({}));

it.each(["reject", "stall"])("ends a Redis handshake that will %s and lets the next request reconnect", async mode => {
  let connections = 0;
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", () => { if (mode === "reject") socket.write("-NOAUTH Authentication required\r\n"); });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test listener");
  const config = libraryConfigSchema.parse({...maximalLibraryConfig, revision: randomUUID(), updatedAt: new Date().toISOString(), services: {...maximalLibraryConfig.services, redis: {url: `redis://127.0.0.1:${address.port}`}}});
  const identity = {clientId: randomUUID(), clientIp: "127.0.0.1", persistentClient: true};
  const policy = {clientWindows: AI_RATE_LIMIT_CLIENT_WINDOWS, networkWindow: AI_RATE_LIMIT_NETWORK_WINDOW, keyPrefix: "test"};
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(consumeConfiguredRateLimit(identity, config, policy)).rejects.toThrow("unavailable");
    expect(connections).toBe(1);
    await expect(consumeConfiguredRateLimit(identity, config, policy)).rejects.toThrow("unavailable");
    expect(connections).toBe(2);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}, 10_000);
