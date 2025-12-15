import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import './globals.css';

export const metadata: Metadata = {
	title: 'Swarm Tools',
	description: 'Framework-agnostic primitives for agentic systems',
};

const consoleArt = `
%c
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

   🐝 Framework-agnostic primitives for agentic systems
   
   https://github.com/joelhooks/opencode-swarm-plugin
`;

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script
					dangerouslySetInnerHTML={{
						__html: `console.log(\`${consoleArt}\`, "color: #f59e0b; font-family: monospace; font-size: 10px;");`,
					}}
				/>
			</head>
			<body className="flex min-h-screen flex-col">
				<RootProvider>{children}</RootProvider>
			</body>
		</html>
	);
}
