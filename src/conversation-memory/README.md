# Your Agent Has Amnesia — How Conversation Memory Actually Works

> [Agent Patterns — TypeScript](../../README.md)

Every time you send a message to an LLM API, you start from zero. The model has no recollection of the last request. It doesn't know what you said a turn ago, what restrictions the user mentioned, or what it already found.

And yet, a well-built agent acts like it remembers everything. How?

The answer is simple enough to fit in one line:

```ts
history = await runAgent(trimmed, history);
```

You hold the state. You pass it back in. That's all of it.

---

## The Core Idea

LLM APIs are stateless HTTP endpoints. Each request is independent. The "conversation" exists only on the client side — as an array of message objects you accumulate and re-send with every turn.

```
Turn 1:  [system, user1]                    → response1
Turn 2:  [system, user1, assistant1, user2] → response2
Turn 3:  [system, user1, assistant1, user2, assistant2, user3] → response3
```

The model sees the full history on every call. It knows what was said earlier because you told it — by including those messages in the request.

Here's the complete agent — there's no hidden state machinery, no session ID, no magic:

```ts
export async function runAgent(userMessage: string, history: Message[]): Promise<Message[]> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  const response = await ollama.chat({
    model: MODEL,
    system: SYSTEM_PROMPT,
    messages,
  });

  messages.push(response.message);
  return messages;
}
```

The function receives history, adds the new user message, calls the API, appends the response, and returns the updated array. The caller stores it and passes it back next time.

---

## The Bug That Causes Amnesia

`broken.ts` has one intentional mistake. Here it is:

```ts
// broken.ts
const messages = await runAgent(trimmed, []); // ← fresh [] every turn
```

```ts
// index.ts (working)
history = await runAgent(trimmed, history); // ← accumulated history
```

That's the entire diff. One passes accumulated history; the other throws it away.

The broken version still works on the first turn — the LLM gets the user's message and responds helpfully. But by the second turn, it has forgotten everything. Ask "What am I allergic to?" after saying "I'm allergic to nuts" and it will say something like _"I don't have information about your allergies."_

---

## Role Labels

Every message in the history has a `role` field. There are four:

| Role        | Who wrote it   | Purpose                                                                                                                   |
| ----------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `system`    | Developer      | Sets the agent's behavior, persona, and constraints. Sent once per API call (not as part of the message array in Ollama). |
| `user`      | Human          | The user's input.                                                                                                         |
| `assistant` | LLM            | The model's response. Must alternate with `user` messages.                                                                |
| `tool`      | Tool execution | The result of a tool call. You'll see this in later concepts.                                                             |

The order matters. Most APIs require `user` and `assistant` to alternate — you can't have two `user` messages in a row without an `assistant` message between them.

---

## Running the Demo

```bash
# Working version — agent remembers across turns
pnpm dev:memory

# Broken version — agent forgets every turn
pnpm dev:memory-broken
```

Try this sequence in both:

```
You: I'm allergic to nuts. What's a good snack?
You: What about something chocolatey?
You: What am I allergic to?
```

In the working version, the agent will reference your nut allergy naturally — "since you're allergic to nuts, here are some nut-free chocolate options." In the broken version, the third question gets a blank response or a generic answer about checking with a doctor, because it has no record of what you told it.

---

## The Growing Context Problem

There's a tradeoff hidden in this pattern: every turn sends more tokens to the API. A 10-turn conversation sends ~10x the tokens of a 1-turn conversation. At 100 turns, you're re-sending a lot of text — and eventually you'll hit the model's context limit.

Strategies for managing this are covered in **[Context Window Management](../context-management/README.md)**, which shows how to summarize older messages into a compact representation while preserving key facts.

For most applications — conversations under 20-30 turns — passing the full history is the right default. Don't prematurely optimize for a problem you don't have yet.

---

## In the Wild: Coding Agent Harnesses

The demo in this folder stores conversation state as a plain array of messages, passed into each `runAgent()` call. Production coding agents start from the same idea — the message array _is_ the state — but layer on persistence, compaction, and rollback that turn a simple list into something closer to a version-controlled document.

**Claude Code** treats the conversation transcript as the single source of truth: there is no hidden session database, no separate state object. The entire agent state _is_ the messages array. When a conversation grows long enough to approach the context limit, Claude Code [compacts the history](https://platform.claude.com/cookbook/misc-session-memory-compaction) into a structured summary that preserves user intent, completed work, errors and corrections, and key references (file paths, IDs, URLs) while discarding pleasantries and filler. Since late 2025, a background "session memory" thread writes these summaries continuously, so when the context window fills, the swap is instant rather than blocking the user for 30-40 seconds. Sessions are persisted locally, which enables `--resume` (pick up where you left off) and `--fork-session` (clone a conversation into a new branch for parallel exploration). Sub-agent transcripts persist independently from the parent conversation, so spawning a sub-agent to research something doesn't bloat the main history.

**Manus** takes a radically different approach to the same problem. Their [context engineering blog post](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) describes an _append-only_ context design: the harness never edits or removes prior messages, because even a single-token change invalidates the KV-cache from that point forward. With Claude Sonnet, cached input tokens cost $0.30/MTok versus $3.00/MTok uncached — a 10x difference — and Manus reports an average input-to-output ratio around 100:1, making cache hits the dominant cost lever. The tradeoff is accepting suboptimal earlier steps in the history rather than cleaning them up. To compensate for the ever-growing context, Manus treats the sandbox filesystem as externalized memory: web page content can be dropped from the context while preserving the file path, and the agent can re-read the file when needed. This "restorable compression" avoids permanent information loss without polluting the message array.

**Cline** extends conversation memory into workspace state with its [checkpoint system](https://docs.cline.bot/features/checkpoints). After every tool call — each file write, terminal command, or web request — Cline commits the current project state to a shadow Git repository (separate from the user's actual repo). When the user edits a previous message, Cline offers three restore options: _Restore Files_ (revert the workspace but keep the full conversation), _Restore Task Only_ (trim conversation messages but leave files alone), or _Restore Files & Task_ (rewind both to that exact moment). This is a fundamentally different model from Claude Code's compaction-based approach: instead of summarizing old messages to free space, Cline lets you _branch back in time_ and replay from a known-good state. The insight is that conversation memory and file state are coupled — rewinding one without the other leads to incoherent agent behavior.

**OpenAI Codex** formalizes session state with three explicit primitives in its [App Server protocol](https://www.infoq.com/news/2026/02/opanai-codex-app-server/): an _Item_ is the atomic unit (a message, tool execution, approval request, or diff) with a lifecycle of "started," streaming "deltas," and "completed"; a _Turn_ groups all items from a single unit of agent work; and a _Thread_ is the durable container that supports creation, resumption, forking, and archival. Threads persist their full event history, so clients can reconnect after a disconnection without losing state. Thread forking clones the conversation into a new thread ID, leaving the original untouched — similar in spirit to Claude Code's `--fork-session`, but built into the wire protocol rather than being a CLI flag.

The pattern that emerges across all these harnesses is that "conversation memory" in production means far more than `history.push(message)`. Every harness must answer three questions that a simple array does not: _How do you survive the context limit?_ (Claude Code compacts; Manus externalizes to the filesystem; Cline branches back in time). _How do you persist across sessions?_ (Codex threads with durable event history; Claude Code local session files; OpenCode git tree snapshots). And _how do you recover from a wrong turn?_ (Cline checkpoints both messages and files; Codex forks threads; Claude Code forks sessions). The simple demo in this folder is the kernel all of them share — but each harness has built a distinct memory architecture around it, shaped by whether they optimize for cost (Manus), continuity (Codex), or recoverability (Cline).

---

## Key Takeaways

1. **LLM APIs are stateless.** Memory doesn't exist on the server — you create it by accumulating messages on the client.

2. **The message array is the state.** Pass it in, get an updated copy back. One line determines whether your agent remembers.

3. **Role labels are structure, not decoration.** The model interprets `system`, `user`, `assistant`, and `tool` differently. Mixing them up causes unpredictable behavior.

4. **The fix is always the same.** Wherever you see an agent that forgets, look for the place where history is being thrown away or not threaded through.

---

## Further Reading

- [OpenAI Conversation State guide](https://platform.openai.com/docs/guides/conversation-state) — explains why each request is stateless and how to manage history client-side
- [Anthropic Messages API — multi-turn conversations](https://docs.anthropic.com/en/api/messages) — alternating user/assistant turns, `system` as a top-level parameter
- [The Dialog State Tracking Challenge](https://aclanthology.org/W13-4065/) — Williams et al., 2013 — the academic foundation for tracking conversation state across turns
