import fs from 'fs';
import path from 'path';

const docs = {
  'getting-started/overview.md': 'Overview',
  'getting-started/quickstart.md': 'Quickstart',
  'getting-started/changelog.md': 'Changelog',
  'getting-started/how-liteai-works.md': 'How LiteAI works',
  'getting-started/extend-liteai.md': 'Extend LiteAI',
  'getting-started/explore-liteai-directory.md': 'Explore the .liteai directory',
  'getting-started/context-window.md': 'Explore the context window',
  'getting-started/memory.md': 'Store instructions and memories',
  'getting-started/permission-modes.md': 'Permission modes',
  'getting-started/common-workflows.md': 'Common workflows',
  'getting-started/best-practices.md': 'Best practices',
  
  'build/custom-subagents.md': 'Create custom subagents',
  'build/agent-teams.md': 'Run agent teams',
  'build/mcp.md': 'Model Context Protocol (MCP)',
  'build/discover-plugins.md': 'Discover and install prebuilt plugins',
  'build/create-plugins.md': 'Create plugins',
  'build/skills.md': 'Extend LiteAI with skills',
  'build/hooks.md': 'Automate with hooks',
  'build/external-events.md': 'Push external events to LiteAI',
  'build/scheduled-prompts.md': 'Run prompts on a schedule',
  'build/programmatic-usage.md': 'Programmatic usage',
  'build/session-links.md': 'Launch sessions from links',
  'build/troubleshoot-installation.md': 'Troubleshoot installation and login',
  'build/troubleshoot-performance.md': 'Troubleshoot performance and stability',
  'build/debug-configuration.md': 'Debug configuration',
  'build/error-reference.md': 'Error reference',

  'configuration/settings.md': 'Settings',
  'configuration/project-setup.md': 'Project setup',

  'reference/cli-reference.md': 'CLI reference',
  'reference/commands.md': 'Commands',
  'reference/environment-variables.md': 'Environment variables',
  'reference/tools-reference.md': 'Tools reference',
  'reference/interactive-mode.md': 'Interactive mode',
  'reference/checkpointing.md': 'Checkpointing',
  'reference/hooks-reference.md': 'Hooks reference',
  'reference/plugins-reference.md': 'Plugins reference',
  'reference/channels-reference.md': 'Channels reference',
  'reference/glossary.md': 'Glossary',

  'platforms/overview.md': 'Overview',
  'platforms/remote-control.md': 'Remote Control',
  'platforms/cli.md': 'CLI',
  'platforms/web.md': 'Web UI (Coming Soon)',
  'platforms/vscode.md': 'VS Code (Coming Soon)',
};

const baseDir = 'src/content/docs';

for (const [file, title] of Object.entries(docs)) {
  const fullPath = path.join(baseDir, file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `---\ntitle: ${title}\n---\n\n# ${title}\n\nContent coming soon...\n`);
}
console.log('Stubs created successfully!');
