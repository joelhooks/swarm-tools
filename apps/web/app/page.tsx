import type { Metadata } from 'next';
import { BookOpen, Zap, Brain, Repeat, Github } from 'lucide-react';

/**
 * Marketing landing page for Swarm Tools.
 * 
 * Structure:
 * - Hero with ASCII art
 * - Problem statement
 * - Solution
 * - How it Works diagram
 * - Key differentiators (3 cards)
 * - Install + CTA
 */

export const metadata: Metadata = {
	title: 'Swarm Tools - Multi-Agent Coordination for AI Coding',
	description: 'Break big tasks into small ones. Spawn agents to work in parallel. Learn from what works. Multi-agent coordination that survives context death.',
	alternates: {
		canonical: 'https://swarmtools.ai',
	},
};

const jsonLd = {
	'@context': 'https://schema.org',
	'@type': 'SoftwareApplication',
	name: 'Swarm Tools',
	alternateName: 'opencode-swarm-plugin',
	description: 'Multi-agent coordination for AI coding. Break tasks into pieces, spawn parallel workers, learn from outcomes.',
	applicationCategory: 'DeveloperApplication',
	applicationSubCategory: 'AI Development Tools',
	operatingSystem: 'Any',
	offers: {
		'@type': 'Offer',
		price: '0',
		priceCurrency: 'USD',
		availability: 'https://schema.org/InStock',
	},
	author: {
		'@type': 'Person',
		name: 'Joel Hooks',
		url: 'https://github.com/joelhooks',
	},
	url: 'https://swarmtools.ai',
	downloadUrl: 'https://github.com/joelhooks/opencode-swarm-plugin',
	installUrl: 'https://www.npmjs.com/package/opencode-swarm-plugin',
	codeRepository: 'https://github.com/joelhooks/opencode-swarm-plugin',
	programmingLanguage: 'TypeScript',
	license: 'https://opensource.org/licenses/MIT',
};

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
				<section className="relative overflow-hidden px-4 py-16 md:py-24">
					{/* Background glow */}
					<div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-yellow-500/10 blur-3xl" aria-hidden="true" />
					
					<div className="relative mx-auto max-w-6xl">
						{/* ASCII Art Hero */}
						<div className="mb-8 overflow-x-auto">
							<pre 
								className="font-mono text-[0.4rem] leading-tight text-amber-500/90 sm:text-[0.5rem] md:text-xs lg:text-sm select-none"
								aria-hidden="true"
							>
{`
 ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
 ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
 ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
 ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
 ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
 ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝

    \ ` + "`" + ` - ' /
   - .(o o). -
    (  >.<  )        Break big tasks into small ones.
     /|   |\\         Spawn agents to work in parallel.
    (_|   |_)        Learn from what works.
      bzzzz...
`}
							</pre>
						</div>

						<h1 className="text-4xl font-bold text-neutral-100 md:text-5xl lg:text-6xl">
							Multi-agent coordination for AI coding
						</h1>
						
						<p className="mt-6 text-lg text-neutral-400 md:text-xl max-w-3xl">
							Break big tasks into small ones. Spawn agents to work in parallel. 
							Learn from what works.
						</p>

						{/* CTA Buttons */}
						<div className="mt-10 flex flex-wrap gap-4">
							<a
								href="/docs"
								className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-amber-500 px-8 py-3 font-semibold text-neutral-950 transition-all hover:bg-amber-400 hover:scale-105"
							>
								<BookOpen className="relative z-10 h-5 w-5" />
								<span className="relative z-10">Read the Docs</span>
								<div className="absolute inset-0 bg-gradient-to-r from-amber-400 to-orange-500 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
							</a>
							<a
								href="https://github.com/joelhooks/opencode-swarm-plugin"
								target="_blank"
								rel="noopener noreferrer"
								className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg border-2 border-amber-500/30 bg-neutral-800 px-8 py-3 font-semibold text-amber-500 transition-all hover:border-amber-500 hover:scale-105"
							>
								<Github className="relative z-10 h-5 w-5" />
								<span className="relative z-10">View on GitHub</span>
								<div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 to-orange-500/10 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
							</a>
						</div>
					</div>
				</section>

				{/* Problem Section */}
				<section className="px-4 py-16 md:py-24">
					<div className="mx-auto max-w-4xl">
						<div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-8 md:p-12">
							<h2 className="text-2xl font-bold text-neutral-100 md:text-3xl">
								The Problem
							</h2>
							
							<p className="mt-6 text-lg text-neutral-300">
								You're working with an AI coding agent. You ask it to "add OAuth authentication." 
								Five minutes later, you realize it's going down the wrong path.
							</p>

							<p className="mt-4 text-xl font-semibold text-amber-500">
								The fundamental issue: AI agents are single-threaded, context-limited, 
								and have no memory of what worked before.
							</p>
						</div>
					</div>
				</section>

				{/* Solution Section */}
				<section className="px-4 py-16">
					<div className="mx-auto max-w-4xl">
						<h2 className="text-3xl font-bold text-neutral-100 md:text-4xl">
							What if the agent could:
						</h2>

						<ul className="mt-8 space-y-4">
							{[
								'Break the task into pieces that can be worked on simultaneously',
								'Spawn parallel workers that don\'t step on each other',
								'Remember what worked and avoid patterns that failed',
								'Survive context compaction without losing progress'
							].map((item, i) => (
								<li key={`solution-${i}`} className="flex items-start gap-4">
									<span className="mt-1 text-2xl text-amber-500">•</span>
									<span className="text-lg text-neutral-300">{item}</span>
								</li>
							))}
						</ul>

						<p className="mt-8 text-2xl font-bold text-amber-500">
							That's what Swarm does.
						</p>
					</div>
				</section>

				{/* How It Works Section */}
				<section className="px-4 py-16 md:py-24">
					<div className="mx-auto max-w-6xl">
						<h2 className="text-3xl font-bold text-neutral-100 md:text-4xl mb-12">
							How It Works
						</h2>

						{/* ASCII Diagram */}
						<div className="overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 md:p-8">
							<pre 
								className="font-mono text-[0.5rem] leading-tight text-amber-500/90 sm:text-[0.6rem] md:text-xs whitespace-pre"
								aria-label="Swarm coordination flow diagram"
							>
{`                            "Add OAuth"
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │      COORDINATOR       │
                    │                        │
                    │  1. Query CASS:        │
                    │     "How did we solve  │
                    │      this before?"     │
                    │                        │
                    │  2. Pick strategy:     │
                    │     file-based?        │
                    │     feature-based?     │
                    │     risk-based?        │
                    │                        │
                    │  3. Break into pieces  │
                    └────────────────────────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           ▼                     ▼                     ▼
    ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
    │  Worker A   │       │  Worker B   │       │  Worker C   │
    │             │       │             │       │             │
    │ auth/oauth  │       │ auth/session│       │ auth/tests  │
    │   🔒 files  │       │   🔒 files  │       │   🔒 files  │
    │             │       │             │       │             │
    │ "I need     │──────►│ "Got it,    │       │ "Running    │
    │  session    │       │  here's the │       │  tests..."  │
    │  types"     │       │  interface" │       │             │
    └─────────────┘       └─────────────┘       └─────────────┘
           │                     │                     │
           └─────────────────────┼─────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │    LEARNING SYSTEM     │
                    │                        │
                    │  "File-based split     │
                    │   worked well for      │
                    │   auth - 3 workers,    │
                    │   15 min, 0 conflicts" │
                    │                        │
                    │  Next time: use this   │
                    │  pattern again         │
                    └────────────────────────┘`}
							</pre>
						</div>
					</div>
				</section>

				{/* Key Differentiators */}
				<section className="px-4 py-16 md:py-24">
					<div className="mx-auto max-w-6xl">
						<h2 className="text-3xl font-bold text-neutral-100 md:text-4xl mb-12">
							What Makes It Different
						</h2>

						<div className="grid gap-8 md:grid-cols-3">
							{/* Card 1: Survives Context Death */}
							<div className="group rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-900/80 to-neutral-900/40 p-8 transition-all hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-500/10">
								<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-amber-500/10">
									<Zap className="h-6 w-6 text-amber-500" />
								</div>
								<h3 className="text-xl font-bold text-neutral-100">
									Survives Context Death
								</h3>
								<p className="mt-4 text-neutral-400">
									Checkpoints at 25%, 50%, 75%. When OpenCode compacts context, 
									swarms resume from the last checkpoint. No more lost progress.
								</p>
								<div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-950/50 p-4">
									<code className="text-xs text-amber-500/90">
										swarm_recover() → resume at 75%
									</code>
								</div>
							</div>

							{/* Card 2: Learns From Outcomes */}
							<div className="group rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-900/80 to-neutral-900/40 p-8 transition-all hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-500/10">
								<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-amber-500/10">
									<Brain className="h-6 w-6 text-amber-500" />
								</div>
								<h3 className="text-xl font-bold text-neutral-100">
									Learns From Outcomes
								</h3>
								<p className="mt-4 text-neutral-400">
									Pattern maturity tracking. Fast + success = proven pattern. 
									Slow + errors = anti-pattern. Patterns with &gt;60% failure rate auto-invert.
								</p>
								<div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-950/50 p-4">
									<code className="text-xs text-amber-500/90">
										candidate → established → proven
									</code>
								</div>
							</div>

							{/* Card 3: Has Skills */}
							<div className="group rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-900/80 to-neutral-900/40 p-8 transition-all hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-500/10">
								<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-amber-500/10">
									<Repeat className="h-6 w-6 text-amber-500" />
								</div>
								<h3 className="text-xl font-bold text-neutral-100">
									Has Skills
								</h3>
								<p className="mt-4 text-neutral-400">
									Knowledge packages agents can load. Testing patterns, 
									swarm coordination, CLI building. Teach once, use everywhere.
								</p>
								<div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-950/50 p-4">
									<code className="text-xs text-amber-500/90">
										skills_use(name="testing-patterns")
									</code>
								</div>
							</div>
						</div>
					</div>
				</section>

				{/* Install Section */}
				<section className="px-4 py-16 md:py-24">
					<div className="mx-auto max-w-4xl text-center">
						<h2 className="text-3xl font-bold text-neutral-100 md:text-4xl">
							Get Started
						</h2>
						
						<div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-8">
							<pre className="overflow-x-auto text-left">
								<code className="text-sm text-amber-500 md:text-base">
{`npm install -g opencode-swarm-plugin@latest
swarm setup`}
								</code>
							</pre>
						</div>

						<div className="mt-12 flex flex-wrap justify-center gap-4">
							<a
								href="/docs"
								className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-amber-500 px-8 py-3 font-semibold text-neutral-950 transition-all hover:bg-amber-400 hover:scale-105"
							>
								<BookOpen className="relative z-10 h-5 w-5" />
								<span className="relative z-10">Read the Docs</span>
							</a>
							<a
								href="https://github.com/joelhooks/opencode-swarm-plugin"
								target="_blank"
								rel="noopener noreferrer"
								className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg border-2 border-amber-500/30 bg-neutral-800 px-8 py-3 font-semibold text-amber-500 transition-all hover:border-amber-500 hover:scale-105"
							>
								<Github className="relative z-10 h-5 w-5" />
								<span className="relative z-10">View on GitHub</span>
							</a>
						</div>
					</div>
				</section>

				{/* Footer */}
				<footer className="border-t border-neutral-800 px-4 py-8">
					<div className="mx-auto max-w-6xl text-center">
						<p className="text-sm text-neutral-600">
							Built by{' '}
							<a 
								href="https://github.com/joelhooks" 
								target="_blank" 
								rel="noopener noreferrer author"
								className="text-neutral-500 hover:text-amber-500 transition-colors"
							>
								Joel Hooks
							</a>
							{' '}• Open source under MIT License
						</p>
					</div>
				</footer>

				{/* Decorative bees */}
				<div className="pointer-events-none fixed top-20 left-10 text-4xl animate-bounce opacity-20" aria-hidden="true">
					🐝
				</div>
				<div className="pointer-events-none fixed bottom-32 right-16 text-3xl animate-bounce opacity-20" aria-hidden="true" style={{ animationDelay: '500ms' }}>
					🐝
				</div>
				<div className="pointer-events-none fixed top-40 right-24 text-2xl animate-bounce opacity-10" aria-hidden="true" style={{ animationDelay: '1000ms' }}>
					🐝
				</div>
			</main>
		</>
	);
}
