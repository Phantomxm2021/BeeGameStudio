import { Children, cloneElement, isValidElement, type ComponentProps, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { Keyboard, Mouse, Gamepad2, Pointer, PersonStanding, Mic, Hand, type LucideIcon } from 'lucide-react';

const devices: { labels: string[]; icons: LucideIcon[] }[] = [
  { labels: ['Keyboard/mouse', 'Keyboard and mouse', 'Keyboard & mouse', '键鼠', '鍵鼠', '键盘/鼠标', '鍵盤/滑鼠'], icons: [Keyboard, Mouse] },
  { labels: ['Gamepad', 'Controller', '手柄', '手把'], icons: [Gamepad2] },
  { labels: ['Touch', '触屏', '觸控'], icons: [Pointer] },
  { labels: ['Motion', '体感', '體感'], icons: [PersonStanding] },
  { labels: ['Voice', '语音', '語音'], icons: [Mic] },
  { labels: ['Hand tracking', '手势追踪', '手勢追蹤'], icons: [Hand] },
];

type Control = { kind: 'key' | 'mouse' | 'gamepad' | 'separator'; label: string; symbol: string };
const keyNames: Record<string, string> = {
  space: 'Space', spacebar: 'Space', 空格: 'Space', 空格键: 'Space', 空格鍵: 'Space', 空白鍵: 'Space',
  enter: '↵', return: '↵', 回车: '↵', 回车键: '↵', 回車: '↵', 回車鍵: '↵',
  shift: '⇧', ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', tab: 'Tab', esc: 'Esc', escape: 'Esc',
  backspace: '⌫', delete: 'Del', del: 'Del', home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn',
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', up: '↑', down: '↓', left: '←', right: '→',
  上: '↑', 下: '↓', 左: '←', 右: '→', 上方向键: '↑', 下方向键: '↓', 左方向键: '←', 右方向键: '→',
};
const mouseNames: Record<string, string> = {
  'left click': 'left', 'left mouse button': 'left', lmb: 'left', 左键: 'left', 左鍵: 'left', 鼠标左键: 'left', 滑鼠左鍵: 'left',
  'right click': 'right', 'right mouse button': 'right', rmb: 'right', 右键: 'right', 右鍵: 'right', 鼠标右键: 'right', 滑鼠右鍵: 'right',
  'middle click': 'middle', 'middle mouse button': 'middle', mmb: 'middle', 中键: 'middle', 中鍵: 'middle', 鼠标中键: 'middle', 滑鼠中鍵: 'middle',
  'mouse wheel': 'wheel', scroll: 'wheel', 滚轮: 'wheel', 滾輪: 'wheel', 鼠标滚轮: 'wheel', 滑鼠滾輪: 'wheel',
};
const padNames: Record<string, string> = {
  a: 'A', b: 'B', x: 'X', y: 'Y', cross: '×', circle: '○', square: '□', triangle: '△',
  lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', l3: 'L3', r3: 'R3',
  'd-pad': '✚', 十字键: '✚', 十字鍵: '✚', 'left stick': 'LS', 'right stick': 'RS', 左摇杆: 'LS', 右摇杆: 'RS', 左搖桿: 'LS', 右搖桿: 'RS',
};

/** Recognize only authored button names; unknown phrases stay as Markdown. */
function controls(text: string): Control[] | undefined {
  const parts = text.trim().split(/(\s*(?:[+/、,，]|\bor\b|或)\s*)/i);
  const result: Control[] = [];
  for (const part of parts) {
    const label = part.trim();
    if (!label) return undefined;
    if (/^(?:[+/、,，]|or|或)$/i.test(label)) {
      result.push({ kind: 'separator', label, symbol: label });
      continue;
    }
    const name = label.toLowerCase();
    const mouse = mouseNames[name];
    const padPrefix = /^(?:gamepad|controller|xbox|playstation|手柄|手把)\s*[:：]?\s*/i;
    const pad = padNames[name.replace(padPrefix, '').replace(/(?:\s+button|按钮|按鈕|[键鍵])$/, '')];
    if (mouse) result.push({ kind: 'mouse', label, symbol: mouse });
    else if (pad && (padPrefix.test(label) || /^(?:[lr][bt123]|cross|circle|square|triangle|d-pad|left stick|right stick|十字[键鍵]|[左右][摇搖][杆桿])$/i.test(label))) {
      result.push({ kind: 'gamepad', label, symbol: pad });
    } else if (/^(?:wasd|方向键|方向鍵|arrow keys|arrows|[↑↓←→]{2,4})$/i.test(label)) {
      const symbols = /^wasd$/i.test(label) ? ['W', 'A', 'S', 'D'] : [...(label.match(/^[↑↓←→]+$/) ? label : '↑↓←→')];
      result.push(...symbols.map(symbol => ({ kind: 'key' as const, label: symbol, symbol })));
    } else {
      const keyName = name.replace(/(?:\s+key|[键鍵])$/, '');
      const key = keyNames[name] ?? keyNames[keyName] ?? (/^(?:[a-z0-9]|f(?:[1-9]|1[0-9]|2[0-4])|[↑↓←→])$/i.test(keyName) ? keyName.toUpperCase() : undefined);
      if (!key) return undefined;
      result.push({ kind: 'key', label, symbol: key });
    }
  }
  return result;
}

function MouseButton({ button }: { button: string }) {
  return <svg viewBox="0 0 20 24" width="18" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {button === 'left' && <path d="M3 11V8a7 7 0 0 1 7-7v10Z" fill="currentColor" stroke="none" />}
    {button === 'right' && <path d="M10 1a7 7 0 0 1 7 7v3h-7Z" fill="currentColor" stroke="none" />}
    <rect x="3" y="1" width="14" height="22" rx="7" /><path d="M3 11h14M10 1v10" />
    {(button === 'middle' || button === 'wheel') && <rect x="8" y="4" width="4" height="6" rx="2" fill="currentColor" stroke="none" />}
    {button === 'wheel' && <path d="m8 16 2-2 2 2m-4 2 2 2 2-2" />}
  </svg>;
}
function Buttons({ buttons }: { buttons: Control[] }) {
  return <span className="control-buttons">{buttons.map(({ kind, label, symbol }, i) =>
    kind === 'separator' ? <span className="control-separator" key={i}>{symbol}</span> :
      kind === 'mouse' ? <span key={i} className="control-mouse" role="img" aria-label={label} title={label}><MouseButton button={symbol} /></span> :
        <kbd key={i} className={kind === 'gamepad' ? `control-key control-gamepad${/^[ABXY×○□△]$/.test(symbol) ? ' control-face-button' : ''}` : 'control-key'} aria-label={label} title={label}>{symbol}</kbd>,
  )}</span>;
}

// Preserve links, nested lists, code blocks and other rich content verbatim.
function inlineText(children: ReactNode): string | undefined {
  const parts = Children.toArray(children).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    if (isValidElement<{ children?: ReactNode }>(child) && ['code', 'strong', 'em', 'del'].includes(String(child.type))) return inlineText(child.props.children);
    return undefined;
  });
  return parts.every(part => part !== undefined) ? parts.join('') : undefined;
}
function binding(children: ReactNode) {
  const text = inlineText(children);
  const match = text?.match(/^(.+?)\s*(?:[:：]|\s+[–—]\s+)\s*(\S[\s\S]*)$/);
  const buttons = match && controls(match[1]);
  return buttons ? <span className="control-binding"><Buttons buttons={buttons} /><span>{match[2]}</span></span> : undefined;
}
function ControlList({ children, className }: ComponentProps<'ul'>) {
  const items = Children.toArray(children).filter(child => typeof child !== 'string' || child.trim());
  const rendered = items.map(child => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return undefined;
    const label = inlineText(child.props.children)?.trim();
    const device = devices.find(device => device.labels.some(name => name.toLowerCase() === label?.toLowerCase()));
    if (device) return <span className="input-device-chip" role="img" aria-label={label} title={label}>{device.icons.map((Icon, i) => <Icon key={i} size={18} aria-hidden="true" />)}</span>;
    return binding(child.props.children);
  });
  const complete = rendered.length > 0 && rendered.every(item => item !== undefined);
  return <ul className={complete ? 'control-bindings' : className}>{items.map((child, i) => rendered[i] ? <li key={i}>{rendered[i]}</li> : child)}</ul>;
}
function ControlRow({ children, ...props }: ComponentProps<'tr'>) {
  let firstCell = true;
  return <tr {...props}>{Children.map(children, child => {
    if (!isValidElement<{ children?: ReactNode }>(child) || child.type !== 'td') return child;
    if (!firstCell) return child;
    firstCell = false;
    const text = inlineText(child.props.children);
    const buttons = text && controls(text);
    return buttons ? cloneElement(child, {}, <Buttons buttons={buttons} />) : child;
  })}</tr>;
}
export const portalControlComponents: Components = {
  ul: ControlList,
  li: ({ children }) => <li>{binding(children) ?? children}</li>,
  p: ({ children }) => <p>{binding(children) ?? children}</p>,
  tr: ({ children }) => <ControlRow>{children}</ControlRow>,
};
