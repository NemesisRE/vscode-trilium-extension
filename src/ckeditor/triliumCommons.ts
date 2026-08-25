export const NONE_STATE_NAME = 'none';
export const DONE_STATE_NAME = 'done';

export interface TaskStateDef {
  name: string;
  title: string;
  markdownSymbol: string;
  isCompleted: boolean;
  isHidden: boolean;
  icon: string;
  /** Raw SVG for `icon`, resolved by the extension host from the bundled Boxicons assets. */
  iconSvg?: string;
  color: string;
}

export const DEFAULT_TASK_STATES: TaskStateDef[] = [
  {
    name: NONE_STATE_NAME,
    title: 'Open',
    markdownSymbol: ' ',
    isCompleted: false,
    isHidden: false,
    icon: '',
    color: '',
  },
  {
    name: DONE_STATE_NAME,
    title: 'Done',
    markdownSymbol: 'x',
    isCompleted: true,
    isHidden: false,
    icon: '',
    color: '',
  },
];

export function isAnchorState(name: string): boolean {
  return name === NONE_STATE_NAME || name === DONE_STATE_NAME;
}