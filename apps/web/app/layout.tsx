import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { Geist, Geist_Mono } from 'next/font/google';
import { IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const geist = Geist({
	subsets: ['latin'],
	variable: '--font-geist',
});

const geistMono = Geist_Mono({
	subsets: ['latin'],
	variable: '--font-geist-mono',
});

const ibmPlexMono = IBM_Plex_Mono({
	weight: ['400', '700'],
	subsets: ['latin'],
	variable: '--font-ibm-plex-mono',
});

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

   🐝 framework-agnostic primitives for agentic systems
   
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
			<body className={`flex min-h-screen flex-col ${geist.variable} ${geistMono.variable} ${ibmPlexMono.variable} font-sans`}>
				<RootProvider>{children}</RootProvider>
			</body>
		</html>
	);
}
