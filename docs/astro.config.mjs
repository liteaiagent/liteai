// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'LiteAI',
			customCss: [
				'./src/styles/tokens.css',
				'./src/styles/layout.css',
				'./src/styles/content.css',
			],
			components: {
				Header: './src/components/Header.astro',
			},
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/liteaiagent/liteai' }],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{
							label: 'Getting started',
							items: [
								{ label: 'Quickstart', slug: '' },
								{ label: 'Overview', slug: 'getting-started/overview' },
								{ label: 'Reading paths', slug: 'getting-started/reading-paths' },
								{ label: 'Changelog', slug: 'getting-started/changelog' },
							],
						},
						{
							label: 'Core concepts',
							items: [
								{ label: 'How LiteAI works', slug: 'getting-started/how-liteai-works' },
								{ label: 'Extend LiteAI', slug: 'getting-started/extend-liteai' },
								{ label: 'Explore the .liteai directory', slug: 'getting-started/explore-liteai-directory' },
								{ label: 'Explore the context window', slug: 'getting-started/context-window' },
							],
						},
						{
							label: 'Use LiteAI',
							items: [
								{ label: 'Store instructions and memories', slug: 'getting-started/memory' },
								{ label: 'Permission modes', slug: 'getting-started/permission-modes' },
								{ label: 'Common workflows', slug: 'getting-started/common-workflows' },
								{ label: 'Best practices', slug: 'getting-started/best-practices' },
							],
						},
					],
				},
				{
					label: 'Build with LiteAI',
					items: [
						{
							label: 'Agents',
							items: [
								{ label: 'Create custom subagents', slug: 'build/custom-subagents' },
								{ label: 'Run agent teams', slug: 'build/agent-teams' },
							],
						},
						{
							label: 'Tools and plugins',
							items: [
								{ label: 'Model Context Protocol (MCP)', slug: 'build/mcp' },
								{ label: 'Discover and install prebuilt plugins', slug: 'build/discover-plugins' },
								{ label: 'Create plugins', slug: 'build/create-plugins' },
								{ label: 'Extend LiteAI with skills', slug: 'build/skills' },
							],
						},
						{
							label: 'Automation',
							items: [
								{ label: 'Automate with hooks', slug: 'build/hooks' },
								{ label: 'Push external events to LiteAI', slug: 'build/external-events' },
								{ label: 'Run prompts on a schedule', slug: 'build/scheduled-prompts' },
								{ label: 'Programmatic usage', slug: 'build/programmatic-usage' },
							],
						},
						{
							label: 'Troubleshooting',
							items: [
								{ label: 'Troubleshoot installation and login', slug: 'build/troubleshoot-installation' },
								{ label: 'Troubleshoot performance and stability', slug: 'build/troubleshoot-performance' },
								{ label: 'Debug configuration', slug: 'build/debug-configuration' },
								{ label: 'Error reference', slug: 'build/error-reference' },
							],
						},
					],
				},
				{
					label: 'Architecture',
					items: [
						{
							label: 'Technical deep dives',
							items: [
								{ label: 'System overview', slug: 'architecture/system-overview' },
								{ label: 'Session engine & loop', slug: 'architecture/session-engine' },
								{ label: 'Provider system', slug: 'architecture/provider-system' },
								{ label: 'Transport channels', slug: 'architecture/transport-channels' },
								{ label: 'Coordinator & swarms', slug: 'architecture/coordinator-swarms' },
								{ label: 'Context & memory pipeline', slug: 'architecture/context-memory' },
								{ label: 'Telemetry & observability', slug: 'architecture/telemetry' },
								{ label: 'Security model', slug: 'architecture/security-model' },
							],
						},
					],
				},
				{
					label: 'Configuration',
					items: [
						{
							label: 'Configuration',
							items: [
								{ label: 'Settings', slug: 'configuration/settings' },
								{ label: 'Project setup', slug: 'configuration/project-setup' },
							],
						},
					],
				},
				{
					label: 'Reference',
					items: [
						{
							label: 'Reference',
							items: [
								{ label: 'CLI reference', slug: 'reference/cli-reference' },
								{ label: 'Commands', slug: 'reference/commands' },
								{ label: 'Environment variables', slug: 'reference/environment-variables' },
								{ label: 'Tools reference', slug: 'reference/tools-reference' },
								{ label: 'Interactive mode', slug: 'reference/interactive-mode' },
								{ label: 'Checkpointing', slug: 'reference/checkpointing' },
								{ label: 'Hooks reference', slug: 'reference/hooks-reference' },
								{ label: 'Plugins reference', slug: 'reference/plugins-reference' },
								{ label: 'Channels reference', slug: 'reference/channels-reference' },
							],
						},
						{
							label: 'Glossary',
							items: [
								{ label: 'Glossary', slug: 'reference/glossary' },
							],
						},
					],
				},
				{
					label: 'Platforms',
					items: [
						{
							label: 'Platforms and integrations',
							items: [
								{ label: 'Overview', slug: 'platforms/overview' },
								{ label: 'CLI', slug: 'platforms/cli' },
								{ label: 'Web UI', slug: 'platforms/web' },
								{ label: 'VS Code', slug: 'platforms/vscode' },
								{ label: 'Remote Control', slug: 'platforms/remote-control' },
							],
						},
					],
				},
				{
					label: 'Roadmap',
					items: [
						{
							label: 'Feature roadmap',
							items: [
								{ label: 'Feature status overview', slug: 'roadmap/feature-status' },
								{ label: 'Engine & session', slug: 'roadmap/engine-session' },
								{ label: 'Addons & configuration', slug: 'roadmap/addons-configuration' },
								{ label: 'Context & memory', slug: 'roadmap/context-memory-roadmap' },
							],
						},
					],
				},
			],
		}),
	],
});
