// ─── Eval Dataset ─────────────────────────────────────────────────────────────
//
// Structured test cases for dataset-driven evals.
//
// The key insight: separate test CASES from eval LOGIC.
// Define what inputs to test and what to expect — as data.
// The eval code runs the same scoring logic over every row.
//
// Benefits:
//   - Add new scenarios without touching eval code
//   - Measure coverage across categories with tags
//   - Export this dataset to Braintrust, LangSmith, or any eval platform
//   - See per-case pass/fail in the evalite UI

export interface EvalCase {
  id: string;
  input: string;
  // Tools the agent MUST call for this case to pass
  expectedTools: string[];
  // Tools the agent must NOT call (optional — undefined means no restriction)
  expectedNotTools?: string[];
  // Categories for filtering and coverage analysis
  tags: string[];
  // Human-readable description for the evalite UI
  description: string;
}

export const evalDataset: EvalCase[] = [
  {
    id: "happy-path-full-booking",
    input: "My name is Sarah Lee. Book a double room from 2026-07-01 to 2026-07-04.",
    expectedTools: ["check_availability", "get_room_price", "create_reservation"],
    tags: ["happy-path", "booking", "double"],
    description: "Full booking: all three tools called in sequence",
  },
  {
    id: "browse-only-availability",
    input: "What rooms do you have available from 2026-08-10 to 2026-08-12? Just browsing.",
    expectedTools: ["check_availability"],
    expectedNotTools: ["create_reservation"],
    tags: ["browsing", "no-booking"],
    description: "Browsing: check availability, do not create reservation",
  },
  {
    id: "price-inquiry",
    input: "How much does a suite cost for 5 nights? I want to compare before deciding.",
    expectedTools: ["get_room_price"],
    expectedNotTools: ["create_reservation"],
    tags: ["pricing", "no-booking", "suite"],
    description: "Price inquiry: get_room_price called, no reservation",
  },
  {
    id: "direct-booking-suite",
    input: "I'm David Kim. Book me a suite from 2026-09-20 to 2026-09-22.",
    expectedTools: ["check_availability", "create_reservation"],
    tags: ["happy-path", "booking", "suite"],
    description: "Suite booking: availability checked, reservation created",
  },
  {
    id: "availability-with-type-filter",
    input: "Are there any single rooms free on June 5th to June 8th, 2026?",
    expectedTools: ["check_availability"],
    expectedNotTools: ["create_reservation"],
    tags: ["browsing", "single"],
    description: "Filtered availability check by room type — no booking",
  },
  {
    id: "multi-info-full-booking",
    input: "Maria Garcia here. Single room please. Check-in June 15, check-out June 18, 2026.",
    expectedTools: ["check_availability", "create_reservation"],
    tags: ["happy-path", "booking", "single"],
    description: "Full name + dates in one message → expect availability + reservation",
  },
];
