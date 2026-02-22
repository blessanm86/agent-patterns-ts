# 🏨 Hotel ReAct Agent

A minimal ReAct (Reason + Act) agent built in TypeScript, using a local model via Ollama.

No frameworks. No LangChain. Just the loop.

Based on the Python original: [smaameri/basic-react-agent](https://github.com/smaameri/basic-react-agent)

---

## What is a ReAct Agent?

ReAct = **Re**ason + **Act**

The agent loops like this:

```
User message
    │
    ▼
┌─────────────────────────────────────────┐
│           THE REACT LOOP                │
│                                         │
│  Model reasons about the conversation   │
│              │                          │
│     Does it need more info?             │
│         YES │           NO              │
│             ▼            │              │
│     Call a tool          │              │
│     Get result           │              │
│     Feed back in         │              │
│     Loop again           │              │
│                          ▼              │
└──────────────────── Reply to user ──────┘
```

The "agent" is just this loop — the model deciding when to call tools and what to do with the results.

---

## What does this agent do?

It's a hotel reservation assistant that:

1. Greets the guest and collects their name
2. Asks for check-in/check-out dates
3. **Calls `check_availability`** → shows available rooms and prices
4. Asks which room type they want
5. **Calls `get_room_price`** → confirms total cost
6. Asks for confirmation
7. **Calls `create_reservation`** → books the room and returns a reservation ID

The multi-step tool usage is what makes this a good ReAct demo — the model genuinely
has to reason between calls (e.g. "rooms are available, now I should show options and ask preference").

---

## Setup

### 1. Install Ollama

```bash
brew install ollama
```

Or download from [ollama.com](https://ollama.com)

### 2. Pull the model

```bash
ollama pull qwen2.5:7b
```

> Swap to `qwen2.5:14b` anytime for better reasoning — just update `.env`

### 3. Start Ollama

```bash
ollama serve
```

### 4. Install dependencies

```bash
pnpm install
```

### 5. Configure environment

```bash
cp .env.example .env
# Edit .env if you want to change the model
```

### 6. Run

```bash
pnpm dev
```

---

## Project Structure

```
src/
├── index.ts    # CLI loop — handles user input and conversation history
├── agent.ts    # The ReAct loop — the heart of the agent
├── tools.ts    # Tool definitions (what the model can call) + implementations
└── types.ts    # Shared TypeScript types
```

### Key concept: two parts to every tool

In `tools.ts` you'll notice two distinct things:

- **Tool definitions** (`tools` array) — JSON schema describing what the tool does and its parameters. This is what gets sent to the model so it knows what's available.
- **Tool implementations** (the functions) — the actual code that runs. The model never sees this.

The model decides *when* and *how* to call a tool based on the definition. You decide *what actually happens* in the implementation.

---

## Swapping the model

Just change `MODEL` in your `.env`:

```bash
MODEL=qwen2.5:14b   # smarter, still fast on M1
MODEL=llama3.1:8b   # alternative with good tool support
MODEL=mistral:7b    # fast, lighter weight
```

No code changes needed.
