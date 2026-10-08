import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: 'puck-remote' },
    links: [
      { text: 'Docs', url: '/docs' },
      { text: 'Decisions', url: '/decisions' },
    ],
  };
}
