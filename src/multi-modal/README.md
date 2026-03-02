# Your Agent Can See Now — Multi-Modal Agents

[Agent Patterns — TypeScript](../../README.md)

---

Text-in, text-out. That's the default mental model for an LLM agent. You send a string, you get a string back. The tools produce text, the reasoning happens over text, and the final answer is text.

But the world isn't text. A user photographs a restaurant menu and asks "what should I order?" A developer pastes a screenshot of a broken UI and asks "what's wrong here?" A home cook photographs their fridge contents and asks "what can I make for dinner?"

A text-only agent has to ask the user to _describe_ what they see — reintroducing the very friction the agent was supposed to eliminate. A multi-modal agent just looks at the image and reasons about it directly.

## The Key Insight: Images Are Input, Not a Tool

The most common mistake when building multi-modal agents is treating vision as a tool — creating an `analyze_image` tool that takes a file path and returns a description. This adds a needless indirection layer:

```
❌  User sends image → Agent calls analyze_image tool → Gets text description → Reasons over description
```

The correct approach: the model sees the image natively, as part of the message. It reasons about what it sees and then decides which tools to call — the same ReAct loop, just with richer input:

```
✅  User sends image → Model sees image directly → Reasons about visual content → Calls tools for structured data
```

The difference is profound. With the tool approach, the description becomes a bottleneck — whatever the description misses is lost forever. With native vision, the model can re-examine the image at any point during reasoning, noticing details that become relevant only after tool results come back.

## How Vision APIs Work

Every major LLM provider supports images, but they do it differently. Understanding the differences matters for cost, quality, and portability.

### Ollama (Local — What This Demo Uses)

Images go in the message's `images` array as base64-encoded strings:

```typescript
const response = await ollama.chat({
  model: "qwen2.5vl:7b",
  messages: [
    {
      role: "user",
      content: "What dish is this?",
      images: ["<base64-encoded-image-data>"],
    },
  ],
});
```

Simple. The model receives the image as part of the message and reasons about it alongside the text content and any tool schemas. No separate vision API, no content blocks — just an `images` field.

### Anthropic Claude API

Images are content blocks within a message, supporting base64, URLs, and file references:

```json
{
  "role": "user",
  "content": [
    {
      "type": "image",
      "source": { "type": "base64", "media_type": "image/jpeg", "data": "<data>" }
    },
    { "type": "text", "text": "What dish is this?" }
  ]
}
```

Best practice: place images _before_ text in the content array. Token cost follows a simple formula: `tokens = (width x height) / 750`. A 1000x1000 image costs ~1,334 tokens. Images larger than ~1568px on the longest edge are automatically downscaled.

### OpenAI API

Uses `image_url` content type with an explicit **detail** parameter that controls the cost/quality tradeoff:

```json
{
  "type": "image_url",
  "image_url": {
    "url": "data:image/jpeg;base64,{data}",
    "detail": "high"
  }
}
```

The detail levels make a massive cost difference:

| Detail | How it works                             | Tokens                 |
| ------ | ---------------------------------------- | ---------------------- |
| `low`  | Fixed-size thumbnail                     | 85 tokens (flat)       |
| `high` | Tiled at 512x512, each tile costs tokens | 85 + (170 x num_tiles) |
| `auto` | Model decides                            | Varies                 |

A 1024x1024 image costs 85 tokens in low detail but 765 tokens in high detail — a 9x difference. Anthropic has no equivalent parameter; it always processes at native resolution (with auto-downscaling above the max).

### Token Cost Comparison

| Provider  | Model                 | Input $/MTok | ~Cost per 1MP image |
| --------- | --------------------- | ------------ | ------------------- |
| Anthropic | Claude Opus 4.6       | $3.00        | ~$0.004             |
| OpenAI    | GPT-4o (high)         | $2.50        | ~$0.002             |
| OpenAI    | GPT-4o (low)          | $2.50        | ~$0.0002            |
| Local     | Qwen2.5-VL via Ollama | $0.00        | Free (compute only) |

Running locally eliminates per-token image costs entirely — one reason this demo uses Ollama.

## Architecture: Same ReAct Loop, Richer Input

The multi-modal agent in this demo is structurally identical to the [ReAct Loop](../react/README.md) agent. The only differences are:

1. **The model** — `qwen2.5vl:7b` instead of `qwen2.5:7b` (a vision-language model from the same family)
2. **User messages can include images** — base64 strings in the `images` array
3. **The system prompt** — food assistant personality instead of hotel concierge

Everything else — the `while(true)` loop, tool execution, message history accumulation — is identical:

```typescript
// agent.ts — the vision ReAct loop

export async function runVisionAgent(
  userMessage: string,
  images: string[], // ← only new parameter
  history: VisionMessage[],
  options: VisionAgentOptions = {},
): Promise<VisionMessage[]> {
  const model = options.textOnly ? MODEL : VISION_MODEL;

  const userMsg: VisionMessage = { role: "user", content: userMessage };
  if (images.length > 0 && !options.textOnly) {
    userMsg.images = images; // ← attach images to the message
  }

  const messages = [...history, userMsg];

  while (true) {
    const response = await ollama.chat({
      model,
      system: FOOD_SYSTEM_PROMPT,
      messages,
      tools, // same tool definitions as any agent
    });

    const assistantMessage = response.message as VisionMessage;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls?.length) break;

    for (const toolCall of assistantMessage.tool_calls) {
      const result = executeTool(toolCall.function.name, toolCall.function.arguments);
      messages.push({ role: "tool", content: result });
    }
  }

  return messages;
}
```

The simplicity is the point. Adding vision to an agent doesn't require a new architecture — it's a model swap and an extra field on the message.

## Image Input: The `[image:path]` Syntax

The CLI accepts inline image references:

```
You: [image:samples/pasta-dish.png] What dish is this?
```

The `image-utils.ts` module parses these tags, loads the files as base64, and strips the tags from the text:

```typescript
// image-utils.ts

export function parseImageReferences(input: string): ParsedInput {
  const imagePaths: string[] = [];
  // Extract [image:path/to/file] tags
  while ((match = IMAGE_TAG_REGEX.exec(input)) !== null) {
    imagePaths.push(match[1].trim());
  }
  const text = input.replace(IMAGE_TAG_REGEX, "").trim();
  return { text: text || "Describe this image.", imagePaths };
}

export function loadImageAsBase64(filePath: string): string {
  const buffer = fs.readFileSync(resolved);
  return buffer.toString("base64");
}
```

Images are resolved relative to the `src/multi-modal/` directory, so `samples/pasta-dish.png` works without an absolute path.

## Text-Only vs. Vision: The Comparison

Run with `--text-only` to see what the agent misses without vision:

```bash
# Vision mode (default) — model sees the image
pnpm dev:multi-modal

# Text-only mode — same agent, same tools, but can't see images
pnpm dev:multi-modal:text-only
```

In text-only mode, image references are stripped with a warning. The agent falls back to whatever text context the user provides — which is exactly the friction multi-modal agents are designed to eliminate.

Consider the difference for "What's on this restaurant menu?":

- **Vision agent**: reads the menu image directly, extracts items and prices, calls `extract_menu_items` with the structured content
- **Text-only agent**: has no idea what's on the menu, must ask the user to type it out

## The Food Domain Tools

Four tools give the agent structured capabilities beyond raw vision:

| Tool                   | What it does                              | Why vision helps                                                          |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `identify_dish`        | Matches a description to known dishes     | Vision describes what it sees; the tool looks up structured data          |
| `extract_menu_items`   | Parses menu text into items with prices   | Vision reads the menu image; the tool structures the extracted text       |
| `get_nutritional_info` | Returns calories, macros for a named dish | Vision identifies the dish; the tool provides nutrition data              |
| `search_recipes`       | Finds recipes by name or ingredients      | Vision identifies ingredients in a photo; the tool finds matching recipes |

The pattern: **vision provides the observation, tools provide the structure.** The model bridges the two by reasoning about what it sees and deciding which tool to call with what arguments.

## When Vision Is Essential vs. When Text Suffices

Not every agent needs vision. The added model size (VL models are larger), slower inference, and higher token costs mean you should be deliberate about when to add it.

**Vision is essential when:**

- The input is inherently visual (photos, screenshots, diagrams, charts)
- Describing the content in text would lose critical information (spatial layout, colors, relationships between elements)
- The user experience depends on not making people transcribe what they see

**Text suffices when:**

- The domain is naturally textual (code, logs, structured data)
- Images can be reliably converted to text upstream (OCR'd documents, scraped web content)
- The vision model's added latency is unacceptable for the use case

**Hybrid approaches work well:**

- Use vision to observe, then hand off to text-only tools for processing
- Pre-process images into structured descriptions, cache them, and use text-only agents downstream
- Let users optionally attach images but don't require them

## Qwen2.5-VL: The Vision Model

This demo uses `qwen2.5vl:7b`, a vision-language model from the same Qwen2.5 family as the text model used in other demos. Key characteristics:

- **Native dynamic resolution** — processes images at their original aspect ratio rather than forcing a fixed square crop
- **Strong OCR** — 95.7% on DocVQA, making it reliable for reading menus, labels, and text in photos
- **Tool calling support** — same function calling interface as the text model, so the agent loop works unchanged
- **Available locally** — `ollama pull qwen2.5vl:7b` (~5GB)

The 7B parameter model is the practical sweet spot: large enough for accurate vision understanding, small enough to run on consumer hardware. The 72B variant matches GPT-4o and Claude Sonnet on document understanding benchmarks but requires serious GPU resources.

## In the Wild: Coding Agent Harnesses

Multi-modal input is a differentiating feature across coding agent harnesses, with each taking a different approach to how agents see.

**Claude Code** treats images as just another file. The same `Read` tool that opens `.ts` files also opens `.png` files — it detects the image format, base64-encodes the bytes, and sends them to Claude as a native image content block. Users can paste screenshots from the clipboard (`Ctrl+V`), drag-and-drop image files into the terminal, or reference them by file path. The system prompt explicitly states "This tool allows Claude Code to read images... the contents are presented visually as Claude Code is a multimodal LLM." This "image-as-input" pattern matches exactly what this demo teaches: the model sees the image directly and reasons about it — there's no intermediate `analyze_image` tool producing a text description.

**Cline and Roo Code** go further with browser vision. They launch headless Chrome via Puppeteer, navigate to URLs, and capture screenshots at each step. The screenshots are sent to the vision model as image content blocks, and the model decides the next browser action (click, type, scroll). This creates a visual feedback loop: act, screenshot, reason, act again — a multi-modal ReAct loop over a browser instead of text tools. Both require vision-capable models (`supportsImages` flag) and Roo Code adds configurable viewport sizes and screenshot quality settings.

**Cursor** supports drag-and-drop and clipboard paste of images into its chat panel. The primary use cases are sketch-to-code (paste a UI mockup, get HTML/CSS) and visual debugging (paste a screenshot of a broken layout). Cursor validates that the selected model supports vision before accepting image input. Its newer Visual Editor feature takes this further — developers drag-and-drop UI elements on a canvas, and the agent translates visual changes into code edits.

**Devin** has the most ambitious vision capability: full desktop computer use. Operating inside a sandboxed Linux environment with a virtual desktop, Devin can launch browsers, Figma, and any GUI application. Screenshots of the desktop state are continuously fed to the model's context. During QA, Devin runs the app, clicks around the UI, captures recordings, and sends edited recordings for human review — a multi-modal agent that spans the entire development workflow from design to testing.

The pattern across all these harnesses is consistent: **images enter the conversation as native content, not as tool outputs.** Whether it's a pasted screenshot, a browser capture, or a desktop recording, the visual data goes directly into the model's context for native reasoning.

## Key Takeaways

1. **Images are input, not a tool.** Don't wrap vision in an `analyze_image` tool. Let the model see images natively so it can re-examine them as reasoning progresses.

2. **Same loop, richer messages.** Adding vision to a ReAct agent is a model swap plus an `images` field on user messages. The architecture doesn't change.

3. **Vision observes, tools structure.** The model describes what it sees; tools provide structured lookups, database queries, and transformations. The bridge between visual understanding and structured action is the model's reasoning.

4. **Cost varies dramatically by provider.** OpenAI's low-detail mode (85 tokens flat) is 9x cheaper than high-detail for the same image. Anthropic auto-scales but offers no manual control. Running locally eliminates per-image costs entirely.

5. **Not every agent needs vision.** The added model size, latency, and cost mean vision should be a deliberate choice, not a default. Text-only agents are faster and cheaper for text-native domains.

## Sources & Further Reading

- [Qwen2.5-VL Blog Post](https://qwenlm.github.io/blog/qwen2.5-vl/) — architecture and benchmark results for the vision model used in this demo
- [Qwen2.5-VL Technical Report (arXiv)](https://arxiv.org/abs/2502.13923) — full paper with training details and ablations
- [Ollama Vision Capabilities](https://docs.ollama.com/capabilities/vision) — how Ollama handles image input in the chat API
- [Anthropic Vision Docs](https://platform.claude.com/docs/en/build-with-claude/vision) — content blocks, token calculation, best practices
- [OpenAI Vision Guide](https://platform.openai.com/docs/guides/images-vision) — detail levels, token costs, and image URL format
- [Claude Code Image Support](https://amanhimself.dev/blog/using-images-in-claude-code/) — how Claude Code handles screenshot paste and image files
- [Cline Browser Integration](https://deepwiki.com/cline/cline/4.3-browser-integration) — Puppeteer-based visual feedback loop
- [Devin 2.2 Computer Use](https://cognition.ai/blog/introducing-devin-2-2) — full desktop vision for coding agents
