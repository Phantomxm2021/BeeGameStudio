import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PortalDescription } from './portalDescription';
import { PublicationMarkdown } from '../components/Common/PublicationMarkdown';

afterEach(cleanup);
describe('published controls presentation', () => {
  it('shows existing device-only lists as accessible icons without rewriting prose', () => {
    render(<PortalDescription title="Game" description={'## 操作\n- 键鼠\n- 手柄\n\n请补充具体按键。\n\n## 玩法\n到达出口。'} />);
    expect(screen.getByRole('img', { name: '键鼠' }).querySelectorAll('svg')).toHaveLength(2);
    expect(screen.getByRole('img', { name: '手柄' }).querySelectorAll('svg')).toHaveLength(1);
    expect(screen.queryByText('键鼠')).not.toBeInTheDocument();
    expect(screen.queryByText('手柄')).not.toBeInTheDocument();
    expect(screen.getByText('请补充具体按键。')).toBeInTheDocument();
    expect(screen.getByText('到达出口。')).toBeInTheDocument();
  });
  it('recognizes generated localized control headings and the controls-scheme label', () => {
    const { rerender } = render(<PortalDescription title="Game" description={'## 操作方法\n- Keyboard/mouse\n- Gamepad'} />);
    expect(screen.getByRole('img', { name: 'Keyboard/mouse' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Gamepad' })).toBeInTheDocument();
    rerender(<PortalDescription title="Game" description={'## 操作方案\n- 手柄'} />);
    expect(screen.getByRole('img', { name: '手柄' })).toBeInTheDocument();
    rerender(<PortalDescription title="Game" description={'## Commandes\n- Touch'} />);
    expect(screen.getByRole('img', { name: 'Touch' })).toBeInTheDocument();
  });
  it('preserves unknown bindings, ordinary lists and fenced code rather than guessing icons', () => {
    const { container } = render(<PortalDescription title="Game" description={'## Introduction\n- Gamepad\n\n## Controls\n- Unmapped device\n- Mystery button: Jump\n\n```text\n- Keyboard/mouse\n```\n\n<script>unsafe</script>'} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Gamepad')).toBeInTheDocument();
    expect(screen.getByText('Unmapped device')).toBeInTheDocument();
    expect(screen.getByText('Mystery button: Jump')).toBeInTheDocument();
    expect(container.querySelector('code')).toHaveTextContent('- Keyboard/mouse');
    expect(container.querySelector('script')).toBeNull();
  });
  it('renders authored key groups and chords beside their actions', () => {
    const { container } = render(<PortalDescription title="Game" description={'## Controls\n- `J` / `L`: move\n- `Space`: interact\n- Ctrl + S: save\n- WASD / 方向键：移动'} />);
    expect([...container.querySelectorAll('kbd')].map(key => key.textContent)).toEqual(['J', 'L', 'Space', 'Ctrl', 'S', 'W', 'A', 'S', 'D', '↑', '↓', '←', '→']);
    expect(screen.getByLabelText('Space')).toHaveAttribute('title', 'Space');
    expect(screen.getByText('interact')).toBeInTheDocument();
    expect(screen.getByText('+')).toBeInTheDocument();
    expect(container.querySelectorAll('.control-bindings > li')).toHaveLength(4);
  });
  it('distinguishes mouse buttons and explicit gamepad buttons', () => {
    const { container } = render(<PortalDescription title="Game" description={'## 操作\n- 鼠标左键：攻击\n- 鼠标右键：瞄准\n- 鼠标滚轮：缩放\n- 手柄 A：跳跃\n- R1：攻击\n- A：左移'} />);
    expect(screen.getByRole('img', { name: '鼠标左键' }).querySelector('path[fill="currentColor"]')).toHaveAttribute('d', 'M3 11V8a7 7 0 0 1 7-7v10Z');
    expect(screen.getByRole('img', { name: '鼠标右键' }).querySelector('path[fill="currentColor"]')).toHaveAttribute('d', 'M10 1a7 7 0 0 1 7 7v3h-7Z');
    expect(screen.getByRole('img', { name: '鼠标滚轮' }).querySelector('svg')).toBeInTheDocument();
    expect(screen.getByLabelText('手柄 A')).toHaveClass('control-face-button');
    expect(screen.getByLabelText('R1')).toHaveClass('control-gamepad');
    expect(screen.getByLabelText('A')).not.toHaveClass('control-gamepad');
    expect(container.querySelectorAll('.control-binding')).toHaveLength(6);
  });
  it('renders explicit bindings from tables and paragraphs, leaving rich links intact', () => {
    const { container } = render(<PortalDescription title="Game" description={'## 操作\nEnter：开始\n\n| 按键 | 动作 |\n|---|---|\n| Esc | 暂停 |\n| Mystery | 保留 |\n\n- Space: [帮助](https://example.com)'} />);
    expect(screen.getByLabelText('Enter')).toHaveTextContent('↵');
    expect(screen.getByLabelText('Esc').closest('td')).toBeInTheDocument();
    expect(screen.getByText('Mystery')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '帮助' })).toHaveAttribute('href', 'https://example.com');
    expect(container.querySelectorAll('kbd')).toHaveLength(2);
  });
  it('keeps the shared publication editor Markdown unchanged unless opted in', () => {
    render(<PublicationMarkdown>{'- 键鼠\n- 手柄'}</PublicationMarkdown>);
    expect(screen.getByText('键鼠')).toBeInTheDocument();
    expect(screen.getByText('手柄')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
