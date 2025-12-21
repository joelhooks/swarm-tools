import {
	BookOpen,
	Brain,
	CheckCircle2,
	GitBranch,
	Github,
	MessageSquare,
	Terminal,
	Zap,
} from "lucide-react";
import type { Metadata } from "next";

/**
 * Quickstart landing page for Swarm Tools.
 *
 * Structure:
 * - Hero with ASCII art
 * - Install + Setup (one command)
 * - First swarm
 * - What happens under the hood
 * - Key tools reference
 * - Session workflow
 * - Links to docs
 */

export const metadata: Metadata = {
	title: "Swarm Tools - Multi-Agent Coordination for AI Coding",
	description:
		"Break big tasks into small ones. Spawn agents to work in parallel. Learn from what works. Install with npm, run /swarm, watch it go.",
	alternates: {
		canonical: "https://swarmtools.ai",
	},
};

const jsonLd = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: "Swarm Tools",
	alternateName: "opencode-swarm-plugin",
	description:
		"Multi-agent coordination for AI coding. Break tasks into pieces, spawn parallel workers, learn from outcomes.",
	applicationCategory: "DeveloperApplication",
	applicationSubCategory: "AI Development Tools",
	operatingSystem: "Any",
	offers: {
		"@type": "Offer",
		price: "0",
		priceCurrency: "USD",
		availability: "https://schema.org/InStock",
	},
	author: {
		"@type": "Person",
		name: "Joel Hooks",
		url: "https://github.com/joelhooks",
	},
	url: "https://swarmtools.ai",
	downloadUrl: "https://github.com/joelhooks/opencode-swarm-plugin",
	installUrl: "https://www.npmjs.com/package/opencode-swarm-plugin",
	codeRepository: "https://github.com/joelhooks/opencode-swarm-plugin",
	programmingLanguage: "TypeScript",
	license: "https://opensource.org/licenses/MIT",
};

type Feature = {
	icon: React.ReactNode;
	title: string;
	description: string;
};

const features: Feature[] = [
	{
		icon: <Zap className="h-6 w-6" />,
		title: "Parallel Execution",
		description:
			"Break tasks into subtasks, spawn workers that run simultaneously",
	},
	{
		icon: <GitBranch className="h-6 w-6" />,
		title: "Git-Backed Tracking",
		description:
			"Cells stored in .hive/, synced with git, survives sessions",
	},
	{
		icon: <MessageSquare className="h-6 w-6" />,
		title: "Agent Coordination",
		description:
			"File reservations prevent conflicts, agents communicate via Swarm Mail",
	},
	{
		icon: <Brain className="h-6 w-6" />,
		title: "Learning System",
		description:
			"Patterns that work get promoted, failures become anti-patterns",
	},
];

type Tool = {
	name: string;
	purpose: string;
	category: string;
};

const essentialTools: Tool[] = [
	{
		name: '/swarm "task"',
		purpose: "Decompose and parallelize a task",
		category: "command",
	},
	{
		name: "hive_ready()",
		purpose: "Get next unblocked cell",
		category: "hive",
	},
	{
		name: "hive_sync()",
		purpose: "Sync to git (MANDATORY before ending)",
		category: "hive",
	},
	{
		name: "swarmmail_reserve()",
		purpose: "Reserve files before editing",
		category: "mail",
	},
	{
		name: "skills_use()",
		purpose: "Load domain expertise into context",
		category: "skills",
	},
	{
		name: "semantic-memory_store()",
		purpose: "Save learnings for future sessions",
		category: "memory",
	},
];

export default function Home() {
	return (
		<>
			{/* JSON-LD Structured Data */}
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>

			<main className="min-h-screen bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950">
				{/* Hero Section */}
				<section className="relative overflow-hidden px-4 py-12 md:py-20">
					{/* Background glow */}
					<div
						className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-yellow-500/10 blur-3xl"
						aria-hidden="true"
					/>

					<div className="relative mx-auto max-w-6xl">
						{/* ASCII Art Hero */}
						<div className="mb-6 overflow-x-auto">
							<pre
								className="font-mono text-[0.35rem] leading-tight text-amber-500/90 sm:text-[0.45rem] md:text-xs select-none"
								aria-hidden="true"
							>
								{`
 ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
 ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
 ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
 ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
 ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
 ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
`}
							</pre>
						</div>

						<h1 className="text-3xl font-bold text-neutral-100 md:text-4xl lg:text-5xl">
							Multi-agent coordination for AI coding
						</h1>

						<p className="mt-4 text-lg text-neutral-400 md:text-xl max-w-3xl">
							Break big tasks into small ones. Spawn agents to work in parallel.
							Learn from what works.
						</p>

						{/* CTA Buttons */}
						<div className="mt-8 flex flex-wrap gap-4">
							<a
								href="#install"
								className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-amber-500 px-6 py-3 font-semibold text-neutral-950 transition-all hover:bg-amber-400 hover:scale-105"
							>
								<Terminal className="relative z-10 h-5 w-5" />
								<span className="relative z-10">Get Started</span>
							</a>
							<a
								href="/docs"
								className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg border-2 border-amber-500/30 bg-neutral-800 px-6 py-3 font-semibold text-amber-500 transition-all hover:border-amber-500 hover:scale-105"
							>
								<BookOpen className="relative z-10 h-5 w-5" />
								<span className="relative z-10">Documentation</span>
							</a>
							<a
								href="https://github.com/joelhooks/opencode-swarm-plugin"
								target="_blank"
								rel="noopener noreferrer"
								className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg border-2 border-neutral-700 bg-neutral-800 px-6 py-3 font-semibold text-neutral-300 transition-all hover:border-neutral-500 hover:scale-105"
							>
								<Github className="relative z-10 h-5 w-5" />
								<span className="relative z-10">GitHub</span>
							</a>
						</div>
					</div>
				</section>

				{/* Epigraph Section */}
				<section className="px-4 py-12 border-t border-neutral-800">
					<div className="mx-auto max-w-4xl">
						<blockquote className="border-l-4 border-amber-500/50 pl-6 py-2">
							<p className="text-neutral-400 italic text-lg">
								"With event sourcing, you can design an event such that it is a
								self-contained description of a user action."
							</p>
							<footer className="mt-2 text-sm text-neutral-500">
								— Martin Kleppmann,{" "}
								<cite className="font-normal">
									Designing Data-Intensive Applications
								</cite>
							</footer>
						</blockquote>
					</div>
				</section>

				{/* The Problem / Solution Section */}
				<section className="px-4 py-16 border-t border-neutral-800">
					<div className="mx-auto max-w-4xl">
						<div className="grid gap-8 md:grid-cols-2">
							{/* The Problem */}
							<div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8">
								<h2 className="text-xl font-bold text-red-400 mb-4">
									The Problem
								</h2>
								<p className="text-neutral-300 leading-relaxed">
									You ask your AI agent to "add OAuth authentication." Five
									minutes later, it's going down the wrong path. Or touching
									files it shouldn't. Or making changes that conflict with your
									other session.
								</p>
								<p className="mt-4 text-neutral-400 text-sm">
									AI agents are{" "}
									<span className="text-red-400 font-medium">
										single-threaded
									</span>
									,{" "}
									<span className="text-red-400 font-medium">
										context-limited
									</span>
									, and have{" "}
									<span className="text-red-400 font-medium">
										no memory of what worked before
									</span>
									.
								</p>
							</div>

							{/* The Solution */}
							<div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8">
								<h2 className="text-xl font-bold text-amber-400 mb-4">
									The Solution
								</h2>
								<ul className="space-y-2 text-neutral-300">
									<li className="flex items-start gap-2">
										<span className="text-amber-500 mt-1">→</span>
										<span>
											<strong className="text-amber-400">
												Break tasks into pieces
											</strong>{" "}
											that can be worked on simultaneously
										</span>
									</li>
									<li className="flex items-start gap-2">
										<span className="text-amber-500 mt-1">→</span>
										<span>
											<strong className="text-amber-400">
												Spawn parallel workers
											</strong>{" "}
											that don't step on each other
										</span>
									</li>
									<li className="flex items-start gap-2">
										<span className="text-amber-500 mt-1">→</span>
										<span>
											<strong className="text-amber-400">
												Remember what worked
											</strong>{" "}
											and avoid patterns that failed
										</span>
									</li>
									<li className="flex items-start gap-2">
										<span className="text-amber-500 mt-1">→</span>
										<span>
											<strong className="text-amber-400">
												Survive context death
											</strong>{" "}
											without losing progress
										</span>
									</li>
								</ul>
								<p className="mt-6 text-amber-400 font-semibold">
									That's what Swarm does.
								</p>
							</div>
						</div>
					</div>
				</section>

				{/* Features Grid */}
				<section className="px-4 py-12 border-t border-neutral-800">
					<div className="mx-auto max-w-6xl">
						{/* Honeycomb ASCII Art */}
						<div className="mb-8 overflow-x-auto">
							<pre
								className="font-mono text-[0.5rem] leading-tight text-amber-500/40 sm:text-xs text-center select-none"
								aria-hidden="true"
							>
								{`    ___       ___       ___       ___   
   /   \\     /   \\     /   \\     /   \\  
  /  🐝 \\___/  ⚡ \\___/  💬 \\___/  🧠 \\
  \\     /   \\     /   \\     /   \\     /
   \\___/     \\___/     \\___/     \\___/ 
   /   \\     /   \\     /   \\     /   \\  
  / PAR \\___/ GIT \\___/ MSG \\___/ LRN \\
  \\ ALL /   \\ BCK /   \\ ING /   \\ ING /
   \\___/     \\___/     \\___/     \\___/`}
							</pre>
						</div>

						<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
							{features.map((feature) => (
								<div
									key={feature.title}
									className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6"
								>
									<div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
										{feature.icon}
									</div>
									<h3 className="text-lg font-semibold text-neutral-100">
										{feature.title}
									</h3>
									<p className="mt-2 text-sm text-neutral-400">
										{feature.description}
									</p>
								</div>
							))}
						</div>
					</div>
				</section>

				{/* Install Section */}
				<section
					id="install"
					className="px-4 py-16 md:py-20 border-t border-neutral-800"
				>
					<div className="mx-auto max-w-4xl">
						<div className="flex items-center gap-3 mb-6">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-neutral-950 font-bold">
								1
							</div>
							<h2 className="text-2xl font-bold text-neutral-100 md:text-3xl">
								Install & Setup
							</h2>
						</div>

						<div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 md:p-8">
							<pre className="overflow-x-auto">
								<code className="text-sm text-amber-500 md:text-base">
									{`npm install -g opencode-swarm-plugin@latest
swarm setup`}
								</code>
							</pre>
							<p className="mt-4 text-sm text-neutral-500">
								Setup configures OpenCode, checks dependencies, and migrates any
								existing data automatically.
							</p>
						</div>

						<div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/30 p-6">
							<h3 className="text-lg font-semibold text-neutral-200 mb-3">
								Optional: Semantic Memory
							</h3>
							<p className="text-sm text-neutral-400 mb-4">
								For persistent learning across sessions, install Ollama (uses
								libSQL for embedded storage):
							</p>
							<pre className="overflow-x-auto rounded-lg bg-neutral-950 p-4">
								<code className="text-sm text-neutral-300">
									{`brew install ollama
ollama serve &
ollama pull mxbai-embed-large`}
								</code>
							</pre>
						</div>
					</div>
				</section>

				{/* First Swarm Section */}
				<section className="px-4 py-16 border-t border-neutral-800">
					<div className="mx-auto max-w-4xl">
						<div className="flex items-center gap-3 mb-6">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-neutral-950 font-bold">
								2
							</div>
							<h2 className="text-2xl font-bold text-neutral-100 md:text-3xl">
								Run Your First Swarm
							</h2>
						</div>

						<p className="text-lg text-neutral-300 mb-6">
							In any OpenCode session, use the{" "}
							<code className="text-amber-500 bg-neutral-800 px-2 py-0.5 rounded">
								/swarm
							</code>{" "}
							command:
						</p>

						<div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 md:p-8">
							<pre className="overflow-x-auto">
								<code className="text-lg text-amber-500 md:text-xl">
									{`/swarm "add user authentication with OAuth"`}
								</code>
							</pre>
						</div>

						<p className="mt-6 text-neutral-400">
							That's it. The coordinator analyzes the task, breaks it into
							subtasks, spawns parallel workers, and tracks everything in
							git-backed work items.
						</p>
					</div>
				</section>

				{/* What Happens Section */}
				<section className="px-4 py-16 border-t border-neutral-800">
					<div className="mx-auto max-w-4xl">
						<div className="flex items-center gap-3 mb-6">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-neutral-950 font-bold">
								3
							</div>
							<h2 className="text-2xl font-bold text-neutral-100 md:text-3xl">
								What Happens Under the Hood
							</h2>
						</div>

						{/* Flow Diagram */}
						<div className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 overflow-x-auto">
							<pre
								className="font-mono text-[0.6rem] leading-tight text-amber-500/80 sm:text-xs"
								aria-hidden="true"
							>
								{`
┌─────────────────────────────────────────────────────────────────┐
│                     /swarm "add auth"                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  COORDINATOR 👑  │
                    │  - Query CASS    │
                    │  - Pick strategy │
                    │  - Decompose     │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼─────┐ ┌─────▼──────┐ ┌────▼──────┐
       │ WORKER 🐝  │ │ WORKER 🐝  │ │ WORKER 🐝 │
       │ auth.ts    │ │ schema.ts  │ │ tests     │
       │ [RESERVED] │ │ [RESERVED] │ │ [RESERVED]│
       └──────┬─────┘ └─────┬──────┘ └────┬──────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼─────────┐
                    │   HIVE (.git)    │
                    │  📝 Event Log    │
                    │  🧠 Learnings    │
                    └──────────────────┘
`}
							</pre>
						</div>

						<div className="space-y-4">
							{[
								{
									step: "Task Analyzed",
									detail:
										"Coordinator queries past solutions (CASS), picks a strategy (file-based, feature-based, or risk-based)",
								},
								{
									step: "Cells Created",
									detail:
										"Epic + subtask cells created atomically in .hive/, tracked in git",
								},
								{
									step: "Workers Spawn",
									detail:
										"Parallel agents start, each gets a subtask + shared context",
								},
								{
									step: "Files Reserved",
									detail:
										"Workers reserve files before editing, preventing conflicts",
								},
								{
									step: "Work Completed",
									detail:
										"Workers finish, auto-release reservations, store learnings",
								},
								{
									step: "Learning Recorded",
									detail:
										"Outcome tracked: fast + success = proven pattern, slow + errors = anti-pattern",
								},
							].map((item) => (
								<div
									key={item.step}
									className="flex gap-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-5"
								>
									<div className="flex-shrink-0">
										<CheckCircle2 className="h-6 w-6 text-amber-500" />
									</div>
									<div>
										<h3 className="text-lg font-semibold text-neutral-100">
											{item.step}
										</h3>
										<p className="mt-1 text-neutral-400">{item.detail}</p>
									</div>
								</div>
							))}
						</div>
					</div>
				</section>

				{/* Essential Tools Section */}
				<section className="px-4 py-16 border-t border-neutral-800">
					<div className="mx-auto max-w-4xl">
						<div className="flex items-center gap-3 mb-6">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-neutral-950 font-bold">
								4
							</div>
							<h2 className="text-2xl font-bold text-neutral-100 md:text-3xl">
								Essential Tools
							</h2>
						</div>

						<div className="overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-900/50">
							<table className="w-full">
								<thead className="border-b border-neutral-800">
									<tr>
										<th className="px-6 py-4 text-left text-sm font-semibold text-amber-500">
											Tool
										</th>
										<th className="px-6 py-4 text-left text-sm font-semibold text-amber-500">
											Purpose
										</th>
									</tr>
								</thead>
								<tbody>
									{essentialTools.map((tool, idx) => (
										<tr
											key={tool.name}
											className={
												idx !== essentialTools.length - 1
													? "border-b border-neutral-800"
													: ""
											}
										>
											<td className="px-6 py-4">
												<code className="text-sm text-amber-500 bg-neutral-950/50 px-2 py-1 rounded">
													{tool.name}
												</code>
											</td>
											<td className="px-6 py-4 text-neutral-300">
												{tool.purpose}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						<p className="mt-4 text-sm text-neutral-500">
							40+ tools available. See{" "}
							<a
								href="/docs/packages/opencode-plugin"
								className="text-amber-500 hover:underline"
							>
								full reference
							</a>
							.
						</p>
					</div>
				</section>

				{/* Session Workflow Section */}
				<section className="px-4 py-16 border-t border-neutral-800">
					<div className="mx-auto max-w-4xl">
						<div className="flex items-center gap-3 mb-6">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-neutral-950 font-bold">
								5
							</div>
							<h2 className="text-2xl font-bold text-neutral-100 md:text-3xl">
								Session Workflow
							</h2>
						</div>

						<div className="grid gap-6 md:grid-cols-3">
							<div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
								<div className="text-2xl mb-3">🚀</div>
								<h3 className="text-lg font-semibold text-neutral-100 mb-2">
									Start
								</h3>
								<code className="text-sm text-amber-500 bg-neutral-950/50 px-2 py-1 rounded block">
									hive_ready()
								</code>
								<p className="mt-3 text-sm text-neutral-400">
									What's next? Get the highest priority unblocked cell.
								</p>
							</div>

							<div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
								<div className="text-2xl mb-3">⚡</div>
								<h3 className="text-lg font-semibold text-neutral-100 mb-2">
									Work
								</h3>
								<code className="text-sm text-amber-500 bg-neutral-950/50 px-2 py-1 rounded block">
									/swarm "task"
								</code>
								<p className="mt-3 text-sm text-neutral-400">
									Use tools, reserve files, coordinate with other agents.
								</p>
							</div>

							<div className="rounded-xl border border-amber-500/50 bg-amber-500/5 p-6">
								<div className="text-2xl mb-3">✅</div>
								<h3 className="text-lg font-semibold text-amber-500 mb-2">
									End (MANDATORY)
								</h3>
								<code className="text-sm text-amber-500 bg-neutral-950/50 px-2 py-1 rounded block">
									hive_sync() + git push
								</code>
								<p className="mt-3 text-sm text-neutral-400">
									The plane is not landed until git push succeeds.
								</p>
							</div>
						</div>
					</div>
				</section>

				{/* CLI Commands Section */}
				<section className="px-4 py-16 border-t border-neutral-800">
					<div className="mx-auto max-w-4xl">
						<h2 className="text-2xl font-bold text-neutral-100 mb-6 md:text-3xl">
							CLI Commands
						</h2>

						<div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 md:p-8">
							<pre className="overflow-x-auto">
								<code className="text-sm text-neutral-300">
									{`swarm setup     # Install and configure (run once)
swarm doctor    # Check dependencies and health
swarm init      # Initialize hive in current project
swarm config    # Show config file paths
swarm migrate   # Migrate legacy databases`}
								</code>
							</pre>
						</div>
					</div>
				</section>

				{/* Deeper Dives Section */}
				<section className="px-4 py-16 border-t border-neutral-800">
					<div className="mx-auto max-w-4xl">
						<h2 className="text-2xl font-bold text-neutral-100 mb-8 md:text-3xl">
							Deeper Dives
						</h2>

						<div className="grid gap-6 md:grid-cols-3">
							{[
								{
									title: "Hive",
									href: "/docs/packages/opencode-plugin/hive",
									description: "Git-backed work item tracking",
								},
								{
									title: "Swarm",
									href: "/docs/packages/opencode-plugin/swarm",
									description: "Parallel task coordination",
								},
								{
									title: "Skills",
									href: "/docs/packages/opencode-plugin/skills",
									description: "Knowledge injection system",
								},
							].map((link) => (
								<a
									key={link.href}
									href={link.href}
									className="group rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 transition-all hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-500/10"
								>
									<h3 className="text-xl font-bold text-neutral-100 group-hover:text-amber-500 transition-colors">
										{link.title}
									</h3>
									<p className="mt-3 text-neutral-400">{link.description}</p>
								</a>
							))}
						</div>

						<div className="mt-10 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-8 text-center">
							<p className="text-lg text-neutral-300">
								<span className="font-semibold text-amber-500">
									Full documentation:
								</span>{" "}
								<a
									href="/docs"
									className="text-amber-500 hover:text-amber-400 underline underline-offset-4"
								>
									swarmtools.ai/docs
								</a>
							</p>
						</div>
					</div>
				</section>

				{/* Footer */}
				<footer className="border-t border-neutral-800 px-4 py-8">
					<div className="mx-auto max-w-6xl text-center">
						<p className="text-sm text-neutral-600">
							Built by{" "}
							<a
								href="https://github.com/joelhooks"
								target="_blank"
								rel="noopener noreferrer author"
								className="text-neutral-500 hover:text-amber-500 transition-colors"
							>
								Joel Hooks
							</a>{" "}
							• Open source under MIT License
						</p>
					</div>
				</footer>

				{/* Decorative bees */}
				<div
					className="pointer-events-none fixed top-20 left-10 text-4xl animate-bounce opacity-20"
					aria-hidden="true"
				>
					🐝
				</div>
				<div
					className="pointer-events-none fixed bottom-32 right-16 text-3xl animate-bounce opacity-20"
					aria-hidden="true"
					style={{ animationDelay: "500ms" }}
				>
					🐝
				</div>
			</main>
		</>
	);
}
