// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'LiteAI',
			customCss: ['./src/styles/custom.css'],
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
								{ label: 'Overview', slug: 'getting-started/overview' },
								{ label: 'Quickstart', slug: 'getting-started/quickstart' },
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
								{ label: 'Launch sessions from links', slug: 'build/session-links' },
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
								{ label: 'Remote Control', slug: 'platforms/remote-control' },
								{ label: 'CLI', slug: 'platforms/cli' },
								{ label: 'Web UI', slug: 'platforms/web' },
								{ label: 'VS Code', slug: 'platforms/vscode' },
							],
						},
					],
				},
			],
		}),
	],
});
