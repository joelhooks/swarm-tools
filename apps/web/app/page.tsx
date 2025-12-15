import { Github } from 'lucide-react';

export default function Home() {
	return (
		<main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 px-4">
			<div className="relative">
				{/* Glow effect */}
				<div className="absolute -inset-4 bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-yellow-500/20 blur-3xl opacity-50" />
				
				{/* ASCII Art */}
				<pre className="relative font-mono text-[0.5rem] leading-tight sm:text-xs md:text-sm lg:text-base text-amber-500/90 select-none">
{`
   ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
   ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
   ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
   ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
   ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
   ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
                                                 
   ████████╗ ██████╗  ██████╗ ██╗     ███████╗   
   ╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝   
      ██║   ██║   ██║██║   ██║██║     ███████╗   
      ██║   ██║   ██║██║   ██║██║     ╚════██║   
      ██║   ╚██████╔╝╚██████╔╝███████╗███████║   
      ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝   
`}
				</pre>
			</div>

			{/* Tagline */}
			<p className="mt-8 text-lg sm:text-xl text-neutral-400 text-center max-w-xl">
				🐝 framework-agnostic primitives for{' '}
				<span className="text-amber-500 font-semibold">agentic systems</span>
			</p>

			{/* Subtitle */}
			<p className="mt-4 text-sm text-neutral-500 text-center max-w-lg">
				Event sourcing, multi-agent coordination, and durable execution patterns
				for AI coding assistants.
			</p>

			{/* CTA Button */}
			<div className="mt-10">
				<a
					href="https://github.com/joelhooks/opencode-swarm-plugin"
					target="_blank"
					rel="noopener noreferrer"
					className="group relative px-8 py-3 bg-amber-500 text-neutral-950 font-semibold rounded-lg overflow-hidden transition-all hover:bg-amber-400 hover:scale-105 inline-flex items-center gap-2"
				>
					<Github size={20} className="relative z-10" />
					<span className="relative z-10">View on GitHub</span>
					<div className="absolute inset-0 bg-gradient-to-r from-amber-400 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
				</a>
			</div>

			{/* Feature pills */}
			<div className="mt-16 flex flex-wrap justify-center gap-3">
				{[
					'🐝 Swarm Mail',
					'📦 Event Sourcing',
					'🔒 File Reservations',
					'🧠 Semantic Memory',
					'⚡ Effect-TS',
				].map((feature) => (
					<span
						key={feature}
						className="px-4 py-2 bg-neutral-800/50 border border-neutral-700/50 rounded-full text-sm text-neutral-400"
					>
						{feature}
					</span>
				))}
			</div>

			{/* Decorative bees */}
			<div className="absolute top-20 left-10 text-4xl animate-bounce opacity-20">
				🐝
			</div>
			<div className="absolute bottom-32 right-16 text-3xl animate-bounce opacity-20 animation-delay-500">
				🐝
			</div>
			<div className="absolute top-40 right-24 text-2xl animate-bounce opacity-10 animation-delay-1000">
				🐝
			</div>
		</main>
	);
}
