import {
  ArrowDownUp,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  EllipsisVertical,
  ExternalLink,
  History,
  House,
  List,
  MonitorSpeaker,
  Pause,
  PenLine,
  Pin,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Settings,
  SkipForward,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';

/** App-level icon names, mapped to lucide icons in one place. */
const ICONS = {
  play: Play,
  pause: Pause,
  check: Check,
  skip: SkipForward,
  external: ExternalLink,
  more: EllipsisVertical,
  refresh: RefreshCw,
  pin: Pin,
  back: ArrowLeft,
  search: Search,
  home: House,
  list: List,
  history: History,
  settings: Settings,
  rewind: RotateCcw,
  forward: RotateCw,
  device: MonitorSpeaker,
  close: X,
  undo: Undo2,
  up: ChevronUp,
  down: ChevronDown,
  sort: ArrowDownUp,
  calendar: CalendarDays,
  note: PenLine,
  plus: Plus,
  clock: Clock,
  trash: Trash2,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** Solid shapes read better for the transport controls. */
const FILLED = new Set<IconName>(['play', 'pause']);

/** A decorative icon; the element around it carries the accessible name. */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const Component = ICONS[name];
  return (
    <Component
      size={size}
      className="icon"
      strokeWidth={2}
      fill={FILLED.has(name) ? 'currentColor' : 'none'}
      aria-hidden
    />
  );
}
