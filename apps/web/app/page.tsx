import type { Metadata } from 'next';
import { BookOpen, Github, Terminal, Code, CheckCircle2 } from 'lucide-react';

/**
 * Quickstart landing page for Swarm Tools.
 * 
 * Structure:
 * - Hero with ASCII art
 * - Install
 * - Basic usage
 * - What happens
 * - Key commands
 * - Links to docs
 */

export const metadata: Metadata = {
	title: 'Swarm Tools - Quickstart',
	description: 'Install, run /swarm "your task", watch agents parallelize the work. Git-backed work tracking, multi-agent coordination, persistent learning.',
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

type Command = {
	command: string;
	description: string;
};

const commands: Command[] = [
	{ command: '/swarm "task"', description: 'Decompose and parallelize' },
	{ command: 'hive_query()', description: 'See open work' },
	{ command: 'hive_ready()', description: 'Get next unblocked task' },
	{ command: 'hive_sync()', description: 'Sync to git (mandatory before ending session)' },
];

type DocLink = {
	title: string;
	href: string;
	description: string;
};

const docLinks: DocLink[] = [
	{ title: 'Hive', href: '/docs/packages/opencode-plugin/hive', description: 'Work item tracking' },
	{ title: 'Swarm', href: '/docs/packages/opencode-plugin/swarm', description: 'Parallel coordination' },
	{ title: 'Skills', href: '/docs/packages/opencode-plugin/skills', description: 'Knowledge injection' },
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

    \\\` - ' /
   - .(o o). -
    (  &gt;.&lt;  )        Break big tasks into small ones.
     /|   |\\\\         Spawn agents to work in parallel.
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

				{/* Quickstart: Install */}
				<section className="px-4 py-16 md:py-24">
					<div className="mx-auto max-w-4xl">
						<div className="flex items-center gap-3 mb-6">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
								<Terminal className="h-5 w-5 text-amber-500" />
							</div>
							<h2 className="text-3xl font-bold text-neutral-100">
								1. Install
							</h2>
						</div>
						
						<div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-8">
							<pre className="overflow-x-auto">
								<code className="text-sm text-amber-500 md:text-base">
{`npm install -g opencode-swarm-plugin@latest
swarm setup`}
								</code>
							</pre>
						</div>
					</div>
				</section>

				{/* Quickstart: Basic Usage */}
				<section className="px-4 py-16">
					<div className="mx-auto max-w-4xl">
						<div className="flex items-center gap-3 mb-6">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
								<Code className="h-5 w-5 text-amber-500" />
							</div>
							<h2 className="text-3xl font-bold text-neutral-100">
								2. Basic Usage
							</h2>
						</div>

						<p className="text-lg text-neutral-300 mb-6">
							From any OpenCode session:
						</p>
						
						<div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-8">
							<pre className="overflow-x-auto">
								<code className="text-sm text-amber-500 md:text-base">
{`/swarm "add OAuth authentication"`}
								</code>
							</pre>
						</div>

						<p className="mt-6 text-neutral-400">
							That's it. You're swarming.
						</p>
					</div>
				</section>

				{/* Quickstart: What Happens */}
				<section className="px-4 py-16">
					<div className="mx-auto max-w-4xl">
						<div className="flex items-center gap-3 mb-6">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
								<CheckCircle2 className="h-5 w-5 text-amber-500" />
							</div>
							<h2 className="text-3xl font-bold text-neutral-100">
								3. What Happens
							</h2>
						</div>

						<div className="space-y-6">
							<div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
								<div className="flex items-start gap-4">
									<span className="mt-1 text-2xl text-amber-500">→</span>
									<div>
										<h3 className="text-lg font-semibold text-neutral-100">Task decomposed</h3>
										<p className="mt-2 text-neutral-400">
											Coordinator queries past solutions (CASS), picks a strategy (file/feature/risk-based), 
											breaks into subtasks
										</p>
									</div>
								</div>
							</div>

							<div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
								<div className="flex items-start gap-4">
									<span className="mt-1 text-2xl text-amber-500">→</span>
									<div>
										<h3 className="text-lg font-semibold text-neutral-100">Workers spawn</h3>
										<p className="mt-2 text-neutral-400">
											Parallel agents start, each gets a subtask + shared context
										</p>
									</div>
								</div>
							</div>

							<div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
								<div className="flex items-start gap-4">
									<span className="mt-1 text-2xl text-amber-500">→</span>
									<div>
										<h3 className="text-lg font-semibold text-neutral-100">Files reserved</h3>
										<p className="mt-2 text-neutral-400">
											Workers reserve files before editing, preventing conflicts
										</p>
									</div>
								</div>
							</div>

							<div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
								<div className="flex items-start gap-4">
									<span className="mt-1 text-2xl text-amber-500">→</span>
									<div>
										<h3 className="text-lg font-semibold text-neutral-100">Work done</h3>
										<p className="mt-2 text-neutral-400">
											Workers complete, auto-release reservations, run bug scans
										</p>
									</div>
								</div>
							</div>

							<div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
								<div className="flex items-start gap-4">
									<span className="mt-1 text-2xl text-amber-500">→</span>
									<div>
										<h3 className="text-lg font-semibold text-neutral-100">Learning recorded</h3>
										<p className="mt-2 text-neutral-400">
											Outcome tracked: fast + success = proven pattern, slow + errors = anti-pattern
										</p>
									</div>
								</div>
							</div>
						</div>
					</div>
				</section>

				{/* Quickstart: Key Commands */}
				<section className="px-4 py-16 md:py-24">
					<div className="mx-auto max-w-4xl">
						<h2 className="text-3xl font-bold text-neutral-100 mb-8">
							4. Key Commands
						</h2>

						<div className="overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-900/50">
							<table className="w-full">
								<thead className="border-b border-neutral-800">
									<tr>
										<th className="px-6 py-4 text-left text-sm font-semibold text-amber-500">
											Command
										</th>
										<th className="px-6 py-4 text-left text-sm font-semibold text-amber-500">
											Purpose
										</th>
									</tr>
								</thead>
								<tbody>
									{commands.map((cmd, idx) => (
										<tr 
											key={cmd.command}
											className={idx !== commands.length - 1 ? 'border-b border-neutral-800' : ''}
										>
											<td className="px-6 py-4">
												<code className="text-sm text-amber-500 bg-neutral-950/50 px-2 py-1 rounded">
													{cmd.command}
												</code>
											</td>
											<td className="px-6 py-4 text-neutral-300">
												{cmd.description}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</section>

				{/* Quickstart: Links to Docs */}
				<section className="px-4 py-16">
					<div className="mx-auto max-w-4xl">
						<h2 className="text-3xl font-bold text-neutral-100 mb-8">
							5. Deeper Dives
						</h2>

						<div className="grid gap-6 md:grid-cols-3">
							{docLinks.map((link) => (
								<a
									key={link.href}
									href={link.href}
									className="group rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 transition-all hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-500/10"
								>
									<h3 className="text-xl font-bold text-neutral-100 group-hover:text-amber-500 transition-colors">
										{link.title}
									</h3>
									<p className="mt-3 text-neutral-400">
										{link.description}
									</p>
								</a>
							))}
						</div>

						<div className="mt-12 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-8">
							<p className="text-center text-lg text-neutral-300">
								<span className="font-semibold text-amber-500">Full documentation:</span>{' '}
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
