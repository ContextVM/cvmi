Stop Burning Your Context Window — We Built Context Mode

MCP server that reduces Claude Code context consumption by 98%. 315 KB becomes 5.4 KB.
Feb 20, 2025
MCP
Claude Code
Developer Tools
Open Source
LinkedIn
X

Every MCP tool call in Claude Code dumps raw data into your 200K context window. A Playwright snapshot costs 56 KB. Twenty GitHub issues cost 59 KB. One access log — 45 KB. After 30 minutes, 40% of your context is gone.

Context Mode is an MCP server that sits between Claude Code and these outputs. 315 KB becomes 5.4 KB. 98% reduction.
The Problem

MCP became the standard way for AI agents to use external tools. But there's a tension at its core: every tool interaction fills the context window from both sides — definitions on the way in, raw output on the way out.

With 81+ tools active, 143K tokens (72%) get consumed before your first message. Then the tools start returning data. A single Playwright snapshot burns 56 KB. A gh issue list dumps 59 KB. Run a test suite, read a log file, fetch documentation — each response eats into what remains.

Cloudflare showed that tool definitions can be compressed by 99.9% with Code Mode. We asked: what about the other direction?
How the Sandbox Works

Each execute call spawns an isolated subprocess with its own process boundary. Scripts can't access each other's memory or state. The subprocess runs your code, captures stdout, and only that stdout enters the conversation context. The raw data — log files, API responses, snapshots — never leaves the sandbox.

Ten language runtimes are available: JavaScript, TypeScript, Python, Shell, Ruby, Go, Rust, PHP, Perl, R. Bun is auto-detected for 3-5x faster JS/TS execution.

Authenticated CLIs (gh, aws, gcloud, kubectl, docker) work through credential passthrough — the subprocess inherits environment variables and config paths without exposing them to the conversation.
How the Knowledge Base Works

The index tool chunks markdown content by headings while keeping code blocks intact, then stores them in a SQLite FTS5 (Full-Text Search 5) virtual table. Search uses BM25 ranking — a probabilistic relevance algorithm that scores documents based on term frequency, inverse document frequency, and document length normalization. Porter stemming is applied at index time so "running", "runs", and "ran" match the same stem.

When you call search, it returns exact code blocks with their heading hierarchy — not summaries, not approximations, the actual indexed content. fetch_and_index extends this to URLs: fetch, convert HTML to markdown, chunk, index. The raw page never enters context.
The Numbers

Validated across 11 real-world scenarios — test triage, TypeScript error diagnosis, git diff review, dependency audit, API response processing, CSV analytics. All under 1 KB output each.

    Playwright snapshot: 56 KB → 299 B
    GitHub issues (20): 59 KB → 1.1 KB
    Access log (500 requests): 45 KB → 155 B
    Analytics CSV (500 rows): 85 KB → 222 B
    Git log (153 commits): 11.6 KB → 107 B
    Repo research (subagent): 986 KB → 62 KB (5 calls vs 37)

Over a full session: 315 KB of raw output becomes 5.4 KB. Session time before slowdown goes from ~30 minutes to ~3 hours. Context remaining after 45 minutes: 99% instead of 60%.
Install

Two ways. Plugin Marketplace gives you auto-routing hooks and slash commands:

/plugin marketplace add mksglu/claude-context-mode
/plugin install context-mode@claude-context-mode

Or MCP-only if you just want the tools:

claude mcp add context-mode -- npx -y context-mode

Restart Claude Code. Done.
What Actually Changes

You don't change how you work. Context Mode includes a PreToolUse hook that automatically routes tool outputs through the sandbox. Subagents learn to use batch_execute as their primary tool. Bash subagents get upgraded to general-purpose so they can access MCP tools.

The practical difference: your context window stops filling up. Sessions that used to hit the wall at 30 minutes now run for 3 hours. The same 200K tokens, used more carefully.
Why We Built This

I run the MCP Directory & Hub. 100K+ daily requests. See every MCP server that ships. The pattern was clear: everyone builds tools that dump raw data into context. Nobody was solving the output side.

Cloudflare's Code Mode blog post crystallized it. They compressed tool definitions. We compress tool outputs. Same principle, other direction.

Built it for my own Claude Code sessions first. Noticed I could work 6x longer before context degradation. Open-sourced it.

Open source. MIT. github.com/mksglu/claude-context-mode