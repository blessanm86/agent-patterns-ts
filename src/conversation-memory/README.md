# Your Agent Has Amnesia — How Conversation Memory Actually Works

> **Concept #1 of 20** — [Agent Patterns — TypeScript](../../README.md)

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

Strategies for managing this are covered in **Concept #6: Context Window Management**, which shows how to summarize older messages into a compact representation while preserving key facts.

For most applications — conversations under 20-30 turns — passing the full history is the right default. Don't prematurely optimize for a problem you don't have yet.

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
