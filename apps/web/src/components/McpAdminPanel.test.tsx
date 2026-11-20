import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { McpAdminPanel } from './McpAdminPanel';

test('mostra il registry account MCP globali', () => {
  const markup = renderToStaticMarkup(<McpAdminPanel />);
  expect(markup).toContain('Account globali');
  expect(markup).toContain('Nuovo account');
  expect(markup).toContain('Notion');
  expect(markup).toContain('Todoist');
});
