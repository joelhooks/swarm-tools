---
"opencode-swarm-plugin": minor
---

## 🐝 Add Synthetic LLM Provider Support

Adds support for **Synthetic** as a first-class LLM provider in swarm-tools.

**New Models Available:**

**Coordinator Models (Complex Tasks):**
- `synthetic/hf:moonshotai/Kimi-K2.5` - Strong reasoning model
- `synthetic/hf:deepseek-ai/DeepSeek-V3.2` - Advanced reasoning

**Worker Models (Parallel Tasks):**
- `synthetic/hf:moonshotai/Kimi-K2.5` - Strong reasoning
- `synthetic/hf:MiniMaxAI/MiniMax-M2.1` - Fast and cost-effective
- `synthetic/hf:Qwen/Qwen3-Coder-480B-A35B-Instruct` - Powerful coding model

**Lite Models (Docs, Tests, Simple Edits):**
- `synthetic/hf:MiniMaxAI/MiniMax-M2.1` - Fast and cost-effective
- `synthetic/hf:Qwen/Qwen3-Coder-480B-A35B-Instruct` - Powerful coding model

**Why it matters:**
- Synthetic provides OpenAI-compatible API at `https://api.synthetic.new/openai/v1`
- Enables users already configured with Synthetic in OpenCode to use swarm-tools
- Cost-effective alternative for multi-agent workflows
- Qwen3-Coder specialized for coding tasks

**Usage:**
```bash
swarm setup  # Select Synthetic models during setup
```

**Requirements:**
- Synthetic API access configured in OpenCode
- No additional configuration needed in swarm-tools

Refs: #148, #150
