import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Swarm Tools - Framework-agnostic primitives for agentic systems';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
	// Use Google Fonts API - IBM Plex Mono has box-drawing chars
	const fontUrl = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@700&display=swap';
	const css = await (await fetch(fontUrl)).text();
	
	// Get the font URL (truetype format)
	const match = css.match(/src: url\(([^)]+)\) format\('truetype'\)/);
	if (!match) {
		throw new Error('Could not find font URL in: ' + css.slice(0, 200));
	}
	
	const fontData = await fetch(match[1]).then((res) => res.arrayBuffer());

	// ASCII art matching home page
	const asciiLines = [
		'███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗',
		'██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║',
		'███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║',
		'╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║',
		'███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║',
		'╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝',
		'',
		'████████╗ ██████╗  ██████╗ ██╗     ███████╗',
		'╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝',
		'   ██║   ██║   ██║██║   ██║██║     ███████╗',
		'   ██║   ██║   ██║██║   ██║██║     ╚════██║',
		'   ██║   ╚██████╔╝╚██████╔╝███████╗███████║',
		'   ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝',
	];

	return new ImageResponse(
		(
			<div
				style={{
					background: 'linear-gradient(135deg, #0a0a0a 0%, #171717 50%, #0a0a0a 100%)',
					width: '100%',
					height: '100%',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					position: 'relative',
				}}
			>
				{/* Glow effect */}
				<div
					style={{
						position: 'absolute',
						width: '800px',
						height: '400px',
						background: 'radial-gradient(ellipse, rgba(245, 158, 11, 0.15) 0%, transparent 70%)',
						top: '50%',
						left: '50%',
						transform: 'translate(-50%, -50%)',
					}}
				/>

				{/* ASCII Art */}
				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						color: '#f59e0b',
						fontSize: '20px',
						lineHeight: 1.15,
						textShadow: '0 0 40px rgba(245, 158, 11, 0.5)',
						fontFamily: 'IBM Plex Mono',
						fontWeight: 700,
					}}
				>
					{asciiLines.map((line, i) => (
						<div key={`l${i}`} style={{ display: 'flex', whiteSpace: 'pre' }}>
							{line || '\u00A0'}
						</div>
					))}
				</div>

				{/* Tagline */}
				<div
					style={{
						display: 'flex',
						flexDirection: 'row',
						marginTop: '48px',
						fontSize: '28px',
						fontFamily: 'IBM Plex Mono',
					}}
				>
					<span style={{ color: '#a3a3a3' }}>Framework-agnostic primitives for</span>
					<span style={{ color: '#a3a3a3', marginLeft: '8px', marginRight: '8px' }}> </span>
					<span style={{ color: '#f59e0b', fontWeight: 700 }}>agentic systems</span>
				</div>

				{/* Bees */}
				<span style={{ position: 'absolute', top: '60px', left: '100px', fontSize: '64px', opacity: 0.4 }}>
					🐝
				</span>
				<span style={{ position: 'absolute', bottom: '80px', right: '120px', fontSize: '48px', opacity: 0.35 }}>
					🐝
				</span>
				<span style={{ position: 'absolute', top: '120px', right: '200px', fontSize: '36px', opacity: 0.25 }}>
					🐝
				</span>
			</div>
		),
		{
			...size,
			fonts: [
				{
					name: 'IBM Plex Mono',
					data: fontData,
					style: 'normal' as const,
					weight: 700 as const,
				},
			],
		}
	);
}
