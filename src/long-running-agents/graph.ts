// ─── Checkpointable State Graph ──────────────────────────────────────────────
//
// Extends the StateGraph pattern from src/state-graph/graph.ts with:
//   1. Checkpoint hooks — onNodeStart/onNodeEnd callbacks around each node
//   2. AbortSignal support — check signal.aborted before each node for
//      graceful cancellation
//
// The graph runtime itself is generic — the agent code provides checkpoint
// behavior via the hooks, keeping the graph reusable.

// ─── State Schema Types ─────────────────────────────────────────────────────

type Reducer<T> = (existing: T, incoming: T) => T;

export interface ChannelConfig<T> {
  default: () => T;
  reducer?: Reducer<T>;
}

// biome-ignore lint: `any` is intentional — ChannelConfig<T> is invariant in T
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StateSchema = Record<string, ChannelConfig<any>>;

export type StateFromSchema<S extends StateSchema> = {
  [K in keyof S]: S[K] extends ChannelConfig<infer T> ? T : never;
};

// ─── Hooks + Options ────────────────────────────────────────────────────────

export interface CheckpointHooks<S> {
  onNodeStart?: (nodeName: string, state: S) => void;
  onNodeEnd?: (nodeName: string, state: S) => void;
}

export interface RunOptions<S> {
  signal?: AbortSignal;
  hooks?: CheckpointHooks<S>;
}

// ─── Node + Edge Types ──────────────────────────────────────────────────────

type NodeFn<S> = (state: S) => Promise<Partial<S>>;
type RouterFn<S> = (state: S) => string;

interface NormalEdge {
  type: "normal";
  to: string;
}

interface ConditionalEdge<S> {
  type: "conditional";
  router: RouterFn<S>;
  targets: string[];
}

type Edge<S> = NormalEdge | ConditionalEdge<S>;

// ─── Sentinel ───────────────────────────────────────────────────────────────

export const END = "__end__";

// ─── Compiled Graph ─────────────────────────────────────────────────────────

export interface GraphResult<S> {
  state: S;
  trace: string[];
  aborted: boolean;
}

class CompiledCheckpointableGraph<S extends StateSchema> {
  constructor(
    private schema: S,
    private nodes: Map<string, NodeFn<StateFromSchema<S>>>,
    private edges: Map<string, Edge<StateFromSchema<S>>>,
    private entryPoint: string,
  ) {}

  async run(
    initialOverrides: Partial<StateFromSchema<S>> = {},
    options: RunOptions<StateFromSchema<S>> = {},
  ): Promise<GraphResult<StateFromSchema<S>>> {
    const { signal, hooks } = options;

    // Build initial state from schema defaults
    let state = {} as StateFromSchema<S>;
    for (const [key, config] of Object.entries(this.schema)) {
      (state as Record<string, unknown>)[key] = config.default();
    }

    // Apply initial overrides
    state = this.applyUpdate(state, initialOverrides);

    const trace: string[] = [];
    let current = this.entryPoint;

    while (current !== END) {
      // Check for cancellation before each node
      if (signal?.aborted) {
        return { state, trace, aborted: true };
      }

      const nodeFn = this.nodes.get(current);
      if (!nodeFn) {
        throw new Error(`[graph] Node "${current}" not found`);
      }

      trace.push(current);
      hooks?.onNodeStart?.(current, state);

      // Execute node and apply its partial update
      const update = await nodeFn(state);
      state = this.applyUpdate(state, update);

      hooks?.onNodeEnd?.(current, state);

      // Resolve next node via edge
      const edge = this.edges.get(current);
      if (!edge) {
        throw new Error(`[graph] No outgoing edge from "${current}"`);
      }

      if (edge.type === "normal") {
        current = edge.to;
      } else {
        const target = edge.router(state);
        if (!edge.targets.includes(target) && target !== END) {
          throw new Error(
            `[graph] Router from "${current}" returned "${target}", expected one of: ${edge.targets.join(", ")}`,
          );
        }
        current = target;
      }
    }

    trace.push(END);
    return { state, trace, aborted: false };
  }

  private applyUpdate(
    state: StateFromSchema<S>,
    update: Partial<StateFromSchema<S>>,
  ): StateFromSchema<S> {
    const next = { ...state };

    for (const [key, value] of Object.entries(update)) {
      if (value === undefined) continue;

      const config = this.schema[key];
      if (config?.reducer) {
        (next as Record<string, unknown>)[key] = config.reducer(
          (state as Record<string, unknown>)[key],
          value,
        );
      } else {
        (next as Record<string, unknown>)[key] = value;
      }
    }

    return next;
  }
}

// ─── Graph Builder ──────────────────────────────────────────────────────────

export class CheckpointableGraph<S extends StateSchema> {
  private nodes = new Map<string, NodeFn<StateFromSchema<S>>>();
  private edges = new Map<string, Edge<StateFromSchema<S>>>();
  private entry: string | null = null;

  constructor(private schema: S) {}

  addNode(name: string, fn: NodeFn<StateFromSchema<S>>): this {
    if (name === END) {
      throw new Error(`[graph] Cannot use reserved name "${END}" as a node name`);
    }
    this.nodes.set(name, fn);
    return this;
  }

  addEdge(from: string, to: string): this {
    this.edges.set(from, { type: "normal", to });
    return this;
  }

  addConditionalEdge(from: string, router: RouterFn<StateFromSchema<S>>, targets: string[]): this {
    this.edges.set(from, { type: "conditional", router, targets });
    return this;
  }

  setEntryPoint(name: string): this {
    this.entry = name;
    return this;
  }

  compile(): CompiledCheckpointableGraph<S> {
    if (!this.entry) {
      throw new Error("[graph] No entry point set — call setEntryPoint()");
    }
    if (!this.nodes.has(this.entry)) {
      throw new Error(`[graph] Entry point "${this.entry}" is not a registered node`);
    }

    for (const name of this.nodes.keys()) {
      if (!this.edges.has(name)) {
        throw new Error(`[graph] Node "${name}" has no outgoing edge`);
      }
    }

    for (const [from, edge] of this.edges) {
      if (edge.type === "normal") {
        if (edge.to !== END && !this.nodes.has(edge.to)) {
          throw new Error(`[graph] Edge from "${from}" targets unknown node "${edge.to}"`);
        }
      } else {
        for (const target of edge.targets) {
          if (target !== END && !this.nodes.has(target)) {
            throw new Error(
              `[graph] Conditional edge from "${from}" targets unknown node "${target}"`,
            );
          }
        }
      }
    }

    return new CompiledCheckpointableGraph(this.schema, this.nodes, this.edges, this.entry);
  }
}
