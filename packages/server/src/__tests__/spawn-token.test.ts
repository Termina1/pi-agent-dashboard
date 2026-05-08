/**
 * Tests for spawn correlation token primitives.
 *
 * Covers:
 *   - `mintSpawnToken()` returns distinct UUIDv4 strings.
 *   - `buildSpawnEnv(env, { spawnToken })` injects `PI_DASHBOARD_SPAWN_TOKEN`.
 *   - Without `spawnToken`, env is unchanged (no leakage).
 *
 * See change: spawn-correlation-token.
 */
import { describe, expect, it } from "vitest";
import { mintSpawnToken, SPAWN_TOKEN_ENV_VAR } from "../spawn-token.js";
import { buildSpawnEnv } from "../process-manager.js";

describe("mintSpawnToken", () => {
	it("returns a UUIDv4 string", () => {
		const t = mintSpawnToken();
		expect(typeof t).toBe("string");
		// UUIDv4: 8-4-4-4-12 hex with version=4 nibble
		expect(t).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
	});

	it("returns distinct tokens on each call", () => {
		const tokens = new Set<string>();
		for (let i = 0; i < 50; i++) tokens.add(mintSpawnToken());
		expect(tokens.size).toBe(50);
	});
});

describe("buildSpawnEnv: spawnToken injection", () => {
	it("sets PI_DASHBOARD_SPAWN_TOKEN when spawnToken is provided", () => {
		const env = buildSpawnEnv({ HOME: "/tmp" }, { spawnToken: "tok_test_123" });
		expect(env[SPAWN_TOKEN_ENV_VAR]).toBe("tok_test_123");
	});

	it("does not set PI_DASHBOARD_SPAWN_TOKEN when spawnToken is omitted", () => {
		const env = buildSpawnEnv({ HOME: "/tmp" });
		expect(env[SPAWN_TOKEN_ENV_VAR]).toBeUndefined();
	});

	it("does not set PI_DASHBOARD_SPAWN_TOKEN when opts is empty", () => {
		const env = buildSpawnEnv({ HOME: "/tmp" }, {});
		expect(env[SPAWN_TOKEN_ENV_VAR]).toBeUndefined();
	});

	it("preserves baseEnv variables unchanged when injecting", () => {
		const env = buildSpawnEnv(
			{ HOME: "/tmp", FOO: "bar", PATH: "/usr/bin" },
			{ spawnToken: "tok_xyz" },
		);
		expect(env.HOME).toBe("/tmp");
		expect(env.FOO).toBe("bar");
		expect(env[SPAWN_TOKEN_ENV_VAR]).toBe("tok_xyz");
		// PATH may be mutated by managed-node prepend, but the raw value should still appear in it.
		expect(env.PATH).toContain("/usr/bin");
	});
});
