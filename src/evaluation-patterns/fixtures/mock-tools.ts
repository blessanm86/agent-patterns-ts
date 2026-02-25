import { executeTool } from "../../react/tools.js";

// ─── Types ────────────────────────────────────────────────────────────────────

// A mock implementation of a single tool. Receives the same args as the real
// tool and returns a JSON string — same contract as executeTool().
export type MockToolFn = (args: Record<string, string>) => string;

// Override any subset of tools. Tools not in the map fall through to the
// real executeTool() implementation from src/react/tools.ts.
export type MockToolMap = Partial<Record<string, MockToolFn>>;

// ─── createMockExecutor ───────────────────────────────────────────────────────
//
// THE KEY PATTERN: wraps real tool execution with optional mock overrides.
//
// The LLM still sees real tool schemas (so it reasons correctly).
// Only the implementations are swapped — you control what each tool returns.
//
// Why this matters:
//   - No MOCK_ROOMS mutation: src/react/tools.ts mutates module-level state
//     when create_reservation runs. Tests interfere with each other.
//     Mock executor bypasses the real implementation entirely.
//   - Controlled scenarios: force "no rooms", specific errors, exact prices.
//   - Speed: mock tools are instant — no data processing, no state lookups.
//   - Reproducibility: same mock → same output every run.
//
// Usage:
//   const executor = createMockExecutor({ check_availability: () => '{"available":false}' });
//   const history = await runHotelAgent(input, [], { executorFn: executor });

export function createMockExecutor(
  mocks: MockToolMap,
): (name: string, args: Record<string, string>) => string {
  return (name: string, args: Record<string, string>): string => {
    const mock = mocks[name];
    if (mock) return mock(args);
    // Fall back to real implementation for tools not in the map
    return executeTool(name, args);
  };
}

// ─── Preset Scenarios ─────────────────────────────────────────────────────────
//
// Common test situations expressed as MockToolMaps.
// Use these directly or spread-merge them to compose custom scenarios.

export const scenarios = {
  // No rooms available for the requested dates.
  // Agent must inform the guest and suggest alternatives.
  noRoomsAvailable: {
    check_availability: () =>
      JSON.stringify({ available: false, message: "No rooms available for those dates" }),
  } satisfies MockToolMap,

  // Only suite-class rooms available.
  // Agent must offer suites and price them at $350/night.
  onlySuiteAvailable: {
    check_availability: () =>
      JSON.stringify({
        available: true,
        nights: 3,
        rooms: [{ type: "suite", pricePerNight: 350, totalPrice: 1050 }],
      }),
  } satisfies MockToolMap,

  // Booking fails due to a concurrent reservation conflict.
  // Availability returns rooms, but create_reservation fails.
  // Agent must detect the error and communicate it clearly.
  bookingConflict: {
    create_reservation: () =>
      JSON.stringify({ success: false, error: "Reservation conflict: room no longer available" }),
  } satisfies MockToolMap,

  // All tools return service errors.
  // Agent must handle total failure without crashing or fabricating availability.
  serviceUnavailable: {
    check_availability: () => JSON.stringify({ error: "Service temporarily unavailable" }),
    get_room_price: () => JSON.stringify({ error: "Service temporarily unavailable" }),
    create_reservation: () => JSON.stringify({ error: "Service temporarily unavailable" }),
  } satisfies MockToolMap,
};

// ─── makeFailThenSucceed ──────────────────────────────────────────────────────
//
// Returns a MockToolMap where check_availability fails `failCount` times,
// then returns a successful result on the next call.
//
// Each call to makeFailThenSucceed() creates a FRESH counter — safe to use
// in concurrent evals because there is no shared closure state.
//
// This tests that the agent can recover from transient tool failures:
// does it retry, communicate the error, or silently give up?
//
// Usage:
//   const executor = createMockExecutor(makeFailThenSucceed(1));
//   // 1st call to check_availability → transient error
//   // 2nd call to check_availability → success with available rooms

export function makeFailThenSucceed(failCount = 1): MockToolMap {
  let calls = 0;
  return {
    check_availability: () => {
      calls++;
      if (calls <= failCount) {
        return JSON.stringify({ error: "Service temporarily unavailable. Please retry." });
      }
      return JSON.stringify({
        available: true,
        nights: 2,
        rooms: [
          { type: "single", pricePerNight: 120, totalPrice: 240 },
          { type: "double", pricePerNight: 180, totalPrice: 360 },
        ],
      });
    },
  };
}
